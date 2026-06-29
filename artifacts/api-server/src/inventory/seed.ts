import { db, dealersTable, feedsTable, vehiclesTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { importFeed } from "./importFeed";
import { buildSampleFeedV1, buildSampleFeedV2 } from "./sampleFeed";

const ALPHA = "Alpha Motorsport";
const SAMPLE_FEED_URL = "/api/sample-feed";

export async function seedDealerAndInventory(log: Logger): Promise<void> {
  const dealers = await db.select().from(dealersTable);
  let dealer = dealers.find((d) => d.name === ALPHA) ?? null;

  if (!dealer) {
    const [created] = await db
      .insert(dealersTable)
      .values({
        name: ALPHA,
        websiteUrl: "https://www.alphamotorsport.example",
        xmlFeedUrl: SAMPLE_FEED_URL,
        status: "Active",
        notes: "Primary launch dealer. Inventory synced from the sample XML feed.",
      })
      .returning();
    dealer = created!;
    log.info({ dealerId: dealer.id }, "Seeded Alpha Motorsport dealer");
  }

  const feeds = await db
    .select()
    .from(feedsTable)
    .where(eq(feedsTable.dealerId, dealer.id));
  if (feeds.length === 0) {
    await db.insert(feedsTable).values({
      dealerId: dealer.id,
      url: dealer.xmlFeedUrl ?? SAMPLE_FEED_URL,
      format: "xml",
    });
  }

  const [{ value: vehicleCount }] = await db
    .select({ value: count() })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealer.id));

  if ((vehicleCount ?? 0) > 0) {
    log.info({ vehicleCount }, "Inventory already seeded; skipping initial sync");
    return;
  }

  // Two-pass seed: the initial pull creates everything as "New", then the
  // current feed applies real deltas (price drop, mileage bump, a removal, a
  // fresh arrival) so the dashboard has realistic statuses and change history.
  await importFeed(dealer.id, buildSampleFeedV1(), log);
  await importFeed(dealer.id, buildSampleFeedV2(), log);
  log.info({ dealerId: dealer.id }, "Seeded initial inventory");
}
