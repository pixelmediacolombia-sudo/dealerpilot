import type { Logger } from "pino";
import { fetchFeedXml } from "./feedSource";
import { importFeed, type ImportSummary } from "./importFeed";
import { autoEnqueueAfterImport } from "../photo/autoEnqueue";
import { seedOpportunityScores } from "../intelligence/seed";
import { ALPHA_DEALER_ID } from "../lib/dealer";
import { db, dealersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Scheduling itself (24h interval, startup catch-up) is owned by the Worker
// Framework (see ../workers/index.ts). This module only tracks the
// next-run timestamp for display in the Connection Center / Feed Health UI,
// and exposes the core sync pipeline reused by both the scheduled worker and
// manual API-triggered syncs.
let nextSyncAt: Date | null = null;

export function getNextSyncAt(): Date | null {
  return nextSyncAt;
}

export function setNextSyncAt(date: Date | null): void {
  nextSyncAt = date;
}

export type InventorySyncTrigger = "manual" | "scheduled" | "startup";

export type InventorySyncResult = {
  dealerId: number;
  trigger: InventorySyncTrigger;
  summary: ImportSummary;
};

/**
 * Core sync pipeline for a single dealer:
 * 1. Fetch XML feed
 * 2. Import vehicles (delta detection, no duplicates, preserves status)
 * 3. Scrape Alpha Motorsport lot locations
 * 4. Refresh Opportunity Engine rankings for all vehicles
 * 5. Optionally auto-enqueue AI photo jobs when explicitly enabled
 */
async function syncDealer(
  dealerId: number,
  log: Logger,
  trigger: string,
): Promise<ImportSummary> {
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));
  if (!dealer?.xmlFeedUrl) {
    throw new Error(`No inventory feed URL configured for dealer ${dealerId}`);
  }

  const startedAt = new Date();
  log.info({ trigger, dealerId, startedAt }, "Inventory sync starting");

  const xml = await fetchFeedXml(dealer.xmlFeedUrl);
  const summary = await importFeed(dealer.id, xml, log, {
    trigger: trigger === "manual" ? "manual" : "auto",
  });
  const completedAt = new Date();

  log.info(
    {
      trigger,
      dealerId,
      feedRunId: summary.feedRunId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      vehiclesImported: summary.imported,
      vehiclesCreated: summary.created,
      vehiclesUpdated: summary.updated,
      vehiclesRemoved: summary.removed,
      vehiclesActive: summary.active,
      errors: summary.errors,
      locationScraper: summary.locationBreakdown,
    },
    "Inventory sync complete",
  );

  // Refresh Opportunity Engine rankings for all active vehicles
  try {
    await seedOpportunityScores(log, { forceRefresh: true });
    log.info({ trigger, dealerId }, "Opportunity Engine rankings refreshed after inventory sync");
  } catch (err) {
    log.warn({ trigger, dealerId, err }, "Opportunity Engine refresh failed — non-fatal, sync still succeeded");
  }

  // Disabled by default: photo enhancement is run per selected/publishing vehicle,
  // not across every imported vehicle.
  if (summary.created > 0 || summary.updated > 0) {
    try {
      const { enqueued, skipped } = await autoEnqueueAfterImport(dealer.id, log);
      log.info({ enqueued, skipped, trigger, dealerId }, "photo:auto-enqueue triggered by inventory sync");
    } catch (err) {
      log.warn({ err, dealerId }, "photo:auto-enqueue failed — non-fatal");
    }
  }

  return summary;
}

/**
 * Run a full inventory sync for dealer 1 (Alpha Motorsport). Used by the
 * Inventory Worker's scheduled + manual runs (see
 * ../workers/inventory.worker.ts). Swallows errors and returns null so the
 * worker framework can log a clean failure instead of throwing.
 */
export async function runSyncNow(
  log: Logger,
  trigger: "auto" | "manual" = "auto",
): Promise<ImportSummary | null> {
  try {
    return await syncDealer(ALPHA_DEALER_ID, log, trigger);
  } catch (err) {
    log.error({ trigger, err }, "Inventory sync failed");
    return null;
  }
}

/**
 * Run a full inventory sync for an arbitrary dealer, throwing on failure so
 * API callers can surface a real error response. Used by
 * routes/dealers.ts (per-dealer manual sync) and routes/feed.ts
 * (POST /api/inventory/sync).
 */
export async function runInventorySync(
  log: Logger,
  options: { dealerId?: number; trigger: InventorySyncTrigger },
): Promise<InventorySyncResult> {
  const dealerId = options.dealerId ?? ALPHA_DEALER_ID;
  const summary = await syncDealer(dealerId, log, options.trigger);
  return { dealerId, trigger: options.trigger, summary };
}
