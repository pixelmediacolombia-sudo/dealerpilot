import type { Logger } from "pino";
import { fetchFeedXml } from "./feedSource";
import { importFeed, type ImportSummary } from "./importFeed";
import { autoEnqueueAfterImport } from "../photo/autoEnqueue";
import { seedOpportunityScores } from "../intelligence/seed";
import { db, dealersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Scheduling itself (24h interval, startup catch-up) is owned by the Worker
// Framework (see ../workers/index.ts). This module only tracks the
// next-run timestamp for display in the Connection Center / Feed Health UI.
let nextSyncAt: Date | null = null;

export function getNextSyncAt(): Date | null {
  return nextSyncAt;
}

export function setNextSyncAt(date: Date | null): void {
  nextSyncAt = date;
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
