// Controlled Mode master switch + shared publish guardrails.
//
// Controlled Mode = the Chrome extension uploads photos, fills fields, clicks
// Next, clicks Publish, captures the listing URL, and marks the vehicle
// Published — with NO manual final click from an operator. This is
// inherently higher-risk than Assisted Mode (where a human still clicks
// Publish), so every guardrail below must pass before a job is allowed to run
// in Controlled Mode.
//
// The per-dealer `autoPublishSettings.autoClickPublish` toggle is the
// dashboard's explicit choice for automatic Marketplace publishing. The
// deployment mode remains available for the global full-auto override.
import { and, eq, inArray } from "drizzle-orm";
import { db, extensionConnectionsTable, publishingJobsTable } from "@workspace/db";
import { getCachedGmDecision } from "../routes/gm";
import { getDuplicateConflictVehicleIds } from "../workers/market.worker";

export const LOT_CITY_MAP: Record<string, string> = {
  Manassas: "Manassas, VA",
};

// Alpha Motorsports is now a single-location operation. Existing feed rows may
// still carry a retired non-empty location; normalize those rows to the only
// active destination instead of allowing stale data to strand a publish job.
export function normalizeAlphaLotLocation(lotLocation: string | null): string | null {
  return lotLocation && lotLocation.trim() ? "Manassas" : null;
}

export function resolveAlphaLotCity(lotLocation: string | null): string | undefined {
  const normalized = normalizeAlphaLotLocation(lotLocation);
  return normalized ? LOT_CITY_MAP[normalized] : undefined;
}

const EXTENSION_ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export const QUEUED_PUBLISHING_JOB_STATUSES = ["Queued", "Scheduled", "Retry"] as const;

export const IN_FLIGHT_PUBLISHING_JOB_STATUSES = [
  "Assigned",
  "Claimed",
  "Publishing",
  "Opening Facebook",
  "Filling Form",
  "Auto Publishing",
  "Ready for Review",
  "Downloading Photos",
  "Uploading Photos",
  "Waiting For Thumbnails",
] as const;

export const ACTIVE_PUBLISHING_JOB_STATUSES = [
  "Queued",
  "Retry",
  "Scheduled",
  "Assigned",
  "Claimed",
  "Publishing",
  "Opening Facebook",
  "Filling Form",
  "Auto Publishing",
  "Ready for Review",
  "Downloading Photos",
  "Uploading Photos",
  "Waiting For Thumbnails",
] as const;

const NOT_ELIGIBLE_STATUSES = new Set(["Published", "Sold/Removed", "Sold", "Removed", "Archived"]);

export function isControlledModeEnabled(): boolean {
  return (
    process.env.MARKETPLACE_CONTROLLED_MODE_ENABLED === "true" ||
    process.env.MARKETPLACE_PUBLISH_MODE === "full_auto"
  );
}

/**
 * Full Auto Mode: MARKETPLACE_PUBLISH_MODE=full_auto forces Controlled Mode
 * for every dealer globally, bypassing the per-dealer autoClickPublish toggle.
 */
export function isFullAutoMode(): boolean {
  return process.env.MARKETPLACE_PUBLISH_MODE === "full_auto";
}

/**
 * Resolves the mode a job should actually run in.
 * - Full Auto (MARKETPLACE_PUBLISH_MODE=full_auto): always Controlled, no dealer toggle needed.
 * - Controlled Auto: dealer's autoClickPublish=true is sufficient for automatic execution.
 * - Otherwise: Assisted (human clicks Publish).
 */
export function resolvePublishMode(dealerAutoClickPublish: boolean): "Assisted" | "Controlled" {
  // The saved Controlled Auto setting is the explicit operator choice shown
  // in the dashboard. A missing deployment flag must not silently turn that
  // visible setting into an Assisted job that waits for a human.
  if (isFullAutoMode() || dealerAutoClickPublish) return "Controlled";
  return "Assisted";
}

export async function isExtensionOnline(): Promise<boolean> {
  const rows = await db.select().from(extensionConnectionsTable);
  const cutoff = Date.now() - EXTENSION_ONLINE_THRESHOLD_MS;
  return rows.some(
    (r) => r.status === "online" && r.lastHeartbeatAt != null && r.lastHeartbeatAt.getTime() >= cutoff,
  );
}

export type GuardrailResult =
  | { ok: true }
  | { ok: false; code: string; reason: string };

/**
 * Full guardrail sweep for a single vehicle, run right before a job is
 * created (or immediately dispatched). Every check is a real read against
 * current DB/worker state — nothing is assumed or cached beyond the GM Coach
 * decision cache (which is itself grounded in a real model call).
 */
export async function checkPublishGuardrails(params: {
  vehicle: { id: number; status: string; lotLocation: string | null };
  gmOverride: boolean;
  requireExtensionOnline: boolean;
  duplicateConflictIds?: Set<number>;
}): Promise<GuardrailResult> {
  const { vehicle, gmOverride, requireExtensionOnline } = params;

  // 1. Real inventory — not already Published/Sold/Removed.
  if (NOT_ELIGIBLE_STATUSES.has(vehicle.status)) {
    return {
      ok: false,
      code: "NOT_ELIGIBLE_STATUS",
      reason: `Vehicle status is "${vehicle.status}" — not eligible for publishing.`,
    };
  }

  // 2. Lot location must be the active Alpha Motorsports destination.
  const lotCity = resolveAlphaLotCity(vehicle.lotLocation);
  if (!lotCity) {
    return {
      ok: false,
      code: "UNKNOWN_LOT",
      reason: `Vehicle lot location "${vehicle.lotLocation ?? "unknown"}" is not mapped to Manassas.`,
    };
  }

  // 3. GM Coach — block HOLD/RECONSIDER unless explicitly overridden by an operator.
  const gm = getCachedGmDecision(vehicle.id);
  if (gm && (gm.recommendation === "HOLD" || gm.recommendation === "RECONSIDER") && !gmOverride) {
    return {
      ok: false,
      code: "GM_BLOCKED",
      reason: `GM Coach recommends ${gm.recommendation} — override required to publish.`,
    };
  }

  // 4a. Duplicate conflict — vehicle already has an active publishing job (queue clean).
  const [activeJob] = await db
    .select({ id: publishingJobsTable.id })
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.vehicleId, vehicle.id),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
      ),
    )
    .limit(1);
  if (activeJob) {
    return {
      ok: false,
      code: "DUPLICATE_ACTIVE_JOB",
      reason: "Vehicle already has an active publishing job in the queue.",
    };
  }

  // 4b. Duplicate conflict — Market Agent flagged same year/make/model/lot self-competition.
  const duplicateConflictIds = params.duplicateConflictIds ?? (await getDuplicateConflictVehicleIds());
  if (duplicateConflictIds.has(vehicle.id) && !gmOverride) {
    return {
      ok: false,
      code: "DUPLICATE_LISTING_CONFLICT",
      reason: "Market Agent flagged a duplicate-listing conflict for this vehicle.",
    };
  }

  // 5. Extension must be online for immediate/Controlled dispatch — a job that
  // auto-clicks Publish with nobody able to run it is not safe to create.
  if (requireExtensionOnline) {
    const online = await isExtensionOnline();
    if (!online) {
      return {
        ok: false,
        code: "EXTENSION_OFFLINE",
        reason: "Chrome extension is offline — cannot dispatch a Controlled Mode job.",
      };
    }
  }

  return { ok: true };
}
