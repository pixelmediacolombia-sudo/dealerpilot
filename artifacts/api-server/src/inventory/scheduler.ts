import type { Logger } from "pino";
import { fetchFeedXml } from "./feedSource";
import { importFeed } from "./importFeed";
import { db, dealersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let nextSyncAt: Date | null = null;

export function getNextSyncAt(): Date | null {
  return nextSyncAt;
}

export function startInventoryScheduler(log: Logger): void {
  async function runSync() {
    log.info("Scheduled 24h inventory sync starting");
    try {
      const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, 1));
      if (!dealer?.xmlFeedUrl) {
        log.warn("No feed URL configured for dealer 1 — skipping scheduled sync");
        return;
      }
      const xml = await fetchFeedXml(dealer.xmlFeedUrl);
      const summary = await importFeed(dealer.id, xml, log);
      log.info(
        { imported: summary.imported, created: summary.created, updated: summary.updated },
        "Scheduled 24h inventory sync complete",
      );
    } catch (err) {
      log.error({ err }, "Scheduled 24h inventory sync failed");
    } finally {
      nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS);
      setTimeout(() => void runSync(), SYNC_INTERVAL_MS);
    }
  }

  // The initial seed already runs the first import on startup.
  // Schedule the first auto-sync for 24h from now.
  nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS);
  setTimeout(() => void runSync(), SYNC_INTERVAL_MS);
  log.info({ nextSyncAt }, "Inventory scheduler started — next auto-sync in 24h");
}
