import type { Logger } from "pino";
import { fetchFeedXml } from "./feedSource";
import { importFeed, type ImportSummary } from "./importFeed";
import { autoEnqueueAfterImport } from "../photo/autoEnqueue";
import { seedOpportunityScores } from "../intelligence/seed";
import { ALPHA_DEALER_ID } from "../lib/dealer";
import { db, dealersTable, feedRunsTable } from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let nextSyncAt: Date | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
let syncInFlight: Promise<InventorySyncResult> | null = null;

export type InventorySyncTrigger = "manual" | "scheduled" | "startup";

export type InventorySyncResult = {
  dealerId: number;
  trigger: InventorySyncTrigger;
  summary: ImportSummary;
};

export function getNextSyncAt(): Date | null {
  return nextSyncAt;
}

function scheduleNextSync(log: Logger, delayMs: number): void {
  if (syncTimer) clearTimeout(syncTimer);
  nextSyncAt = new Date(Date.now() + delayMs);
  syncTimer = setTimeout(() => void runScheduledSync(log), delayMs);
  syncTimer.unref?.();
  log.info({ nextSyncAt }, "Inventory scheduler next auto-sync scheduled");
}

async function latestSuccessfulFeedRun(dealerId: number) {
  const [latestRun] = await db
    .select()
    .from(feedRunsTable)
    .where(
      and(
        eq(feedRunsTable.dealerId, dealerId),
        or(eq(feedRunsTable.status, "success"), eq(feedRunsTable.status, "completed"))!,
      ),
    )
    .orderBy(desc(feedRunsTable.finishedAt))
    .limit(1);

  return latestRun ?? null;
}

async function runScheduledSync(log: Logger): Promise<void> {
  try {
    await runInventorySync(log, { dealerId: ALPHA_DEALER_ID, trigger: "scheduled" });
  } catch (err) {
    log.error({ err }, "Scheduled 24h inventory sync failed");
  } finally {
    scheduleNextSync(log, SYNC_INTERVAL_MS);
  }
}

export async function runInventorySync(
  log: Logger,
  options: { dealerId?: number; trigger: InventorySyncTrigger },
): Promise<InventorySyncResult> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const dealerId = options.dealerId ?? ALPHA_DEALER_ID;
    const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));
    if (!dealer?.xmlFeedUrl) {
      throw new Error(`No inventory feed URL configured for dealer ${dealerId}`);
    }

    log.info({ dealerId, trigger: options.trigger }, "Inventory sync starting");
    const xml = await fetchFeedXml(dealer.xmlFeedUrl);
    const summary = await importFeed(dealer.id, xml, log);

    if (summary.created > 0 || summary.updated > 0) {
      const { enqueued, skipped } = await autoEnqueueAfterImport(dealer.id, log);
      log.info({ dealerId, enqueued, skipped }, "photo:auto-enqueue triggered by inventory sync");
    }

    await seedOpportunityScores(log, { force: true });

    log.info(
      {
        dealerId,
        trigger: options.trigger,
        imported: summary.imported,
        created: summary.created,
        updated: summary.updated,
        removed: summary.removed,
        locations: summary.locationBreakdown,
      },
      options.trigger === "manual" ? "Inventory synced manually" : "Inventory synced automatically",
    );

    if (options.trigger === "manual" && schedulerStarted) {
      scheduleNextSync(log, SYNC_INTERVAL_MS);
    }

    return { dealerId, trigger: options.trigger, summary };
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export function startInventoryScheduler(log: Logger): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  void (async () => {
    const latestRun = await latestSuccessfulFeedRun(ALPHA_DEALER_ID);
    const lastSyncAt = latestRun?.finishedAt ?? latestRun?.startedAt ?? null;
    const ageMs = lastSyncAt ? Date.now() - lastSyncAt.getTime() : Number.POSITIVE_INFINITY;
    const delayMs = Math.max(0, SYNC_INTERVAL_MS - ageMs);

    if (delayMs === 0) {
      nextSyncAt = new Date();
      log.info({ lastSyncAt }, "Inventory scheduler starting startup sync because last sync is older than 24h");
      try {
        await runInventorySync(log, { dealerId: ALPHA_DEALER_ID, trigger: "startup" });
      } catch (err) {
        log.error({ err }, "Startup inventory sync failed");
      } finally {
        scheduleNextSync(log, SYNC_INTERVAL_MS);
      }
      return;
    }

    scheduleNextSync(log, delayMs);
    log.info({ lastSyncAt, nextSyncAt }, "Inventory scheduler started");
  })().catch((err) => {
    log.error({ err }, "Inventory scheduler failed to start");
    scheduleNextSync(log, SYNC_INTERVAL_MS);
  });
}
