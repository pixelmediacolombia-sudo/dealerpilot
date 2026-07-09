// Publishing Worker — proactively assigns queued/approved publishing jobs to
// an online extension every 5 minutes. It NEVER publishes anything itself
// (only the Chrome extension, driven by a human-controlled tab, ever clicks
// Publish/Send) — it only performs the same "assign" step a human operator
// would otherwise do manually from the Publishing Queue UI.
//
// Guardrails (all real checks against DB state — nothing fabricated):
//  - Skips entirely if no extension has a recent heartbeat (offline).
//  - Skips vehicles with unknown lot location (lotLocation IS NULL).
//  - Skips vehicles flagged by the Market Agent as a duplicate-listing conflict.
//  - Skips vehicles whose cached GM Coach decision is HOLD or RECONSIDER,
//    unless the job was explicitly approved by a human (approvedByUser=true).
//  - Only jobs already in Queued/Retry with no assignment are touched — jobs
//    created via manual publish-now flows are left exactly as-is.
import { db, pool, publishingJobsTable, vehiclesTable, extensionConnectionsTable } from "@workspace/db";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { getCachedGmDecision } from "../routes/gm";
import { getDuplicateConflictVehicleIds } from "./market.worker";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEALER_ID = 1;
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // heartbeat within last 5 minutes = online
const MAX_ASSIGNMENTS_PER_RUN = 3;

async function findOnlineExtension(): Promise<{ id: string; name: string } | null> {
  const rows = await db.select().from(extensionConnectionsTable);
  const cutoff = Date.now() - ONLINE_THRESHOLD_MS;
  const online = rows.find(
    (r) => r.lastHeartbeatAt && r.lastHeartbeatAt.getTime() >= cutoff && r.status === "online",
  );
  const chromeId = online
    ? await pool.query<{ chrome_extension_id: string | null }>(
        "select chrome_extension_id from extension_connections where id = $1 limit 1",
        [online.id],
      )
    : null;
  const extensionId = chromeId?.rows[0]?.chrome_extension_id ?? online?.name ?? null;
  return extensionId && online ? { id: extensionId, name: online.name } : null;
}

async function run({ log }: { log: import("pino").Logger }): Promise<WorkerRunOutcome> {
  const extension = await findOnlineExtension();
  if (!extension) {
    return { summary: "Publishing worker skipped — no extension online", skipped: true };
  }

  const duplicateConflictIds = await getDuplicateConflictVehicleIds();

  const candidates = await db
    .select({
      job: publishingJobsTable,
      lotLocation: vehiclesTable.lotLocation,
    })
    .from(publishingJobsTable)
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, publishingJobsTable.vehicleId))
    .where(
      and(
        eq(publishingJobsTable.dealerId, DEALER_ID),
        or(eq(publishingJobsTable.status, "Queued"), eq(publishingJobsTable.status, "Retry")),
        isNull(publishingJobsTable.assignedExtensionId),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    )
    .orderBy(desc(publishingJobsTable.priority), asc(publishingJobsTable.createdAt))
    .limit(25);

  let assigned = 0;
  let skippedUnknownLot = 0;
  let skippedDuplicate = 0;
  let skippedGm = 0;

  for (const { job, lotLocation } of candidates) {
    if (assigned >= MAX_ASSIGNMENTS_PER_RUN) break;

    if (!lotLocation) {
      skippedUnknownLot++;
      continue;
    }
    if (duplicateConflictIds.has(job.vehicleId)) {
      skippedDuplicate++;
      continue;
    }
    if (!job.approvedByUser) {
      const gmDecision = getCachedGmDecision(job.vehicleId);
      if (gmDecision && gmDecision.recommendation !== "PUBLISH") {
        skippedGm++;
        continue;
      }
      if (gmDecision?.duplicateConflictWarning) {
        skippedDuplicate++;
        continue;
      }
    }

    const [updated] = await db
      .update(publishingJobsTable)
      .set({ status: "Assigned", assignedExtensionId: extension.id, assignedAt: new Date() })
      .where(
        and(
          eq(publishingJobsTable.id, job.id),
          or(eq(publishingJobsTable.status, "Queued"), eq(publishingJobsTable.status, "Retry")),
        ),
      )
      .returning({ id: publishingJobsTable.id });

    if (updated) assigned++;
  }

  if (assigned === 0) {
    return {
      summary: `No jobs assigned — ${skippedUnknownLot} unknown lot, ${skippedDuplicate} duplicate conflicts, ${skippedGm} GM held`,
      skipped: true,
      detail: { skippedUnknownLot, skippedDuplicate, skippedGm },
    };
  }

  return {
    summary: `Assigned ${assigned} publishing job${assigned === 1 ? "" : "s"} to extension "${extension.id}"`,
    detail: { assigned, skippedUnknownLot, skippedDuplicate, skippedGm },
  };
}

export const publishingWorker: WorkerDefinition = {
  id: "publishing",
  name: "Publishing Agent",
  description: "Assigns approved queued jobs to the online extension within guardrails",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
