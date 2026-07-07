import type { Logger } from "pino";
import { fetchFeedXml } from "./feedSource";
import { importFeed, type ImportSummary } from "./importFeed";
import { autoEnqueueAfterImport } from "../photo/autoEnqueue";
import { seedOpportunityScores } from "../intelligence/seed";
import { db, dealersTable, feedRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let nextSyncAt: Date | null = null;

export function getNextSyncAt(): Date | null {
  return nextSyncAt;
}

/**
 * Run a full inventory sync:
 * 1. Fetch XML feed
 * 2. Import vehicles (delta detection, no duplicates, preserves status)
 * 3. Scrape Alpha Motorsport lot locations
 * 4. Refresh Opportunity Engine rankings for all vehicles
 * 5. Auto-enqueue AI photo jobs for new/updated vehicles
 *
 * Used by both the 24h scheduler and POST /api/inventory/sync.
 */
export async function runSyncNow(
  log: Logger,
  trigger: "auto" | "manual" = "auto",
): Promise<ImportSummary | null> {
  const startedAt = new Date();
  log.info({ trigger, startedAt }, "Inventory sync starting");

  try {
    const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, 1));
    if (!dealer?.xmlFeedUrl) {
      log.warn({ trigger }, "No feed URL configured for dealer 1 — skipping sync");
      return null;
    }

    const xml = await fetchFeedXml(dealer.xmlFeedUrl);
    const summary = await importFeed(dealer.id, xml, log, { trigger });
    const completedAt = new Date();

    log.info(
      {
        trigger,
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
      log.info({ trigger }, "Opportunity Engine rankings refreshed after inventory sync");
    } catch (err) {
      log.warn({ trigger, err }, "Opportunity Engine refresh failed — non-fatal, sync still succeeded");
    }

    // Auto-enqueue AI photo jobs for new/updated vehicles
    if (summary.created > 0 || summary.updated > 0) {
      try {
        const { enqueued, skipped } = await autoEnqueueAfterImport(dealer.id, log);
        log.info({ enqueued, skipped, trigger }, "photo:auto-enqueue triggered by inventory sync");
      } catch (err) {
        log.warn({ err }, "photo:auto-enqueue failed — non-fatal");
      }
    }

    return summary;
  } catch (err) {
    log.error({ trigger, err }, "Inventory sync failed");
    return null;
  }
}

/**
 * Start the 24-hour inventory scheduler.
 *
 * Startup behaviour:
 * - If the last completed sync is ≥ 24 hours old (or no sync has run yet),
 *   runs a sync immediately and then schedules the next one in 24 hours.
 * - Otherwise, schedules the next sync for 24 hours after the last one completed.
 *
 * This ensures production restarts after downtime catch up immediately,
 * without double-running when the seed already ran on fresh startup.
 */
export function startInventoryScheduler(log: Logger): void {
  async function reschedule() {
    nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS);
    log.info({ nextSyncAt }, "Next auto inventory sync scheduled");
    setTimeout(() => void runAndReschedule(), SYNC_INTERVAL_MS);
  }

  async function runAndReschedule() {
    await runSyncNow(log, "auto");
    await reschedule();
  }

  async function startUp() {
    try {
      const [lastRun] = await db
        .select()
        .from(feedRunsTable)
        .where(eq(feedRunsTable.dealerId, 1))
        .orderBy(desc(feedRunsTable.startedAt))
        .limit(1);

      const lastSyncAt = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;
      const ageMs = lastSyncAt ? Date.now() - lastSyncAt.getTime() : Infinity;
      const ageHours = Math.round(ageMs / 3_600_000);

      if (ageMs >= SYNC_INTERVAL_MS) {
        log.info(
          { ageHours, lastSyncAt: lastSyncAt?.toISOString() ?? "never" },
          "Last inventory sync is stale — running immediately on startup",
        );
        await runSyncNow(log, "auto");
        await reschedule();
      } else {
        const remaining = SYNC_INTERVAL_MS - ageMs;
        nextSyncAt = new Date(Date.now() + remaining);
        log.info(
          { ageHours, nextSyncAt, hoursUntilNext: Math.round(remaining / 3_600_000) },
          "Inventory scheduler started — last sync is fresh",
        );
        setTimeout(() => void runAndReschedule(), remaining);
      }
    } catch (err) {
      log.error({ err }, "Inventory scheduler startup check failed — falling back to 24h schedule");
      await reschedule();
    }
  }

  log.info("Starting inventory scheduler");
  void startUp();
}
