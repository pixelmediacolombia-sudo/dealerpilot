import { db, dealersTable, feedsTable, vehiclesTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { importFeed } from "./importFeed";
import { fetchFeedXml } from "./feedSource";

const ALPHA = "Alpha Motorsport";
const REAL_FEED_URL = "https://www.alphamotorsport.net/facebook-catalog-feed.xml";

function isSampleFeedUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return u === "" || u === "sample" || u.includes("sample-feed");
}

export async function seedDealerAndInventory(log: Logger): Promise<void> {
  const dealers = await db.select().from(dealersTable);
  let dealer = dealers.find((d) => d.name === ALPHA) ?? null;

  // Track whether this dealer was previously pointed at the sample feed so we
  // know to force a real-feed sync even if sample vehicles already exist.
  const wasOnSampleFeed = !dealer || isSampleFeedUrl(dealer.xmlFeedUrl);

  if (!dealer) {
    const [created] = await db
      .insert(dealersTable)
      .values({
        name: ALPHA,
        websiteUrl: "https://www.alphamotorsport.net",
        xmlFeedUrl: REAL_FEED_URL,
        status: "Active",
        notes: "Primary launch dealer — inventory synced from the real Alpha Motorsport XML feed.",
      })
      .returning();
    dealer = created!;
    log.info({ dealerId: dealer.id }, "Seeded Alpha Motorsport dealer");
  } else if (dealer.xmlFeedUrl !== REAL_FEED_URL) {
    // Upgrade: point the dealer at the real feed (may have been sample or empty).
    await db
      .update(dealersTable)
      .set({
        xmlFeedUrl: REAL_FEED_URL,
        websiteUrl: "https://www.alphamotorsport.net",
        notes: "Primary launch dealer — inventory synced from the real Alpha Motorsport XML feed.",
      })
      .where(eq(dealersTable.id, dealer.id));
    dealer = { ...dealer, xmlFeedUrl: REAL_FEED_URL };
    log.info({ dealerId: dealer.id }, "Upgraded Alpha Motorsport dealer to real feed URL");
  }

  // Keep the feeds table in sync with the dealer's canonical URL.
  const feeds = await db.select().from(feedsTable).where(eq(feedsTable.dealerId, dealer.id));
  if (feeds.length === 0) {
    await db.insert(feedsTable).values({ dealerId: dealer.id, url: REAL_FEED_URL, format: "xml" });
  } else if (feeds[0]!.url !== REAL_FEED_URL) {
    await db
      .update(feedsTable)
      .set({ url: REAL_FEED_URL })
      .where(eq(feedsTable.id, feeds[0]!.id));
  }

  const [{ value: vehicleCount }] = await db
    .select({ value: count() })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealer.id));

  // Skip only when we know the current vehicles came from the real feed.
  // Sample data has exactly 15 vehicles; the real Alpha feed has 300+.
  // Use a threshold so a partially-completed or interrupted upgrade is retried.
  const REAL_FEED_MIN_VEHICLES = 50;
  if ((vehicleCount ?? 0) >= REAL_FEED_MIN_VEHICLES && !wasOnSampleFeed) {
    log.info({ vehicleCount }, "Inventory already seeded from real feed; skipping initial sync");
    return;
  }

  log.info(
    { dealerId: dealer.id, wasOnSampleFeed, existingVehicles: vehicleCount },
    "Syncing inventory from real Alpha Motorsport feed — this may take a moment",
  );

  const xml = await fetchFeedXml(REAL_FEED_URL);
  const summary = await importFeed(dealer.id, xml, log);

  log.info(
    { dealerId: dealer.id, ...summary },
    "Initial inventory sync complete from real Alpha Motorsport feed",
  );
}
