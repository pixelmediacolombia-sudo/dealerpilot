import { db, dealersTable, feedsTable, vehiclesTable, type Dealer } from "@workspace/db";
import { count, eq, or } from "drizzle-orm";
import type { Logger } from "pino";
import { importFeed } from "./importFeed";
import { fetchFeedXml } from "./feedSource";
import { ALPHA_MARKETPLACE_KNOWLEDGE } from "../lib/dealer";
import { getLuckiMazdaFeedConfig, LUCKI_MAZDA_DEALER_ID } from "./dealerFeedConfig";
import { runInventorySync } from "./scheduler";
import { getLuckiIncomingValues } from "./luckiMarketplacePolicy";

const ALPHA = "Alpha Motorsport";
const LUCKI_MAZDA = "Lucki Mazda";
const LEGACY_LUCKY_MAZDA = "Lucky Mazda";
const LEGACY_LUCKY_NOTES = "Marketplace-only account. XML inventory feed pending from Lucky Mazda.";
const LUCKI_NOTES_PENDING = "Marketplace-only account. XML inventory feed pending from Lucki Mazda.";
const LUCKI_CONFIGURED_NOTES = "Marketplace-only account. Inventory feed configured through Vincue runtime settings.";
const LUCKI_LOCATION = {
  city: "Woodbridge",
  state: "VA",
  country: "US",
};
const LUCKI_MARKETPLACE_BACKFILL_MARKER = "Lucki Marketplace backfill v1 applied";
const REAL_FEED_URL = "https://www.alphamotorsport.net/facebook-catalog-feed.xml";

async function syncConfiguredLuckiInventory(log: Logger, configured: boolean): Promise<void> {
  if (!configured) return;
  try {
    const { summary } = await runInventorySync(log, {
      dealerId: LUCKI_MAZDA_DEALER_ID,
      trigger: "startup",
    });
    log.info(
      { dealerId: LUCKI_MAZDA_DEALER_ID, ...summary },
      "Lucki Mazda inventory refreshed from Vincue during seed",
    );
  } catch (err) {
    // Keep the API available with the last protected inventory snapshot when
    // Vincue is temporarily unavailable. The next scheduled sync can retry.
    log.warn({ err, dealerId: LUCKI_MAZDA_DEALER_ID }, "Lucki Mazda inventory refresh during seed failed");
  }
}

/**
 * One-time Lucki-only data backfill requested for Marketplace readiness.
 * The marker makes this safe to run from every startup without re-burning
 * values after the initial correction. Future feed runs preserve populated
 * values through importFeed's Lucki policy.
 */
async function applyLuckiMarketplaceBackfill(log: Logger): Promise<void> {
  const [dealer] = await db
    .select({ notes: dealersTable.notes })
    .from(dealersTable)
    .where(eq(dealersTable.id, LUCKI_MAZDA_DEALER_ID))
    .limit(1);
  if (!dealer) return;

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, LUCKI_MAZDA_DEALER_ID));
  if (vehicles.length === 0 || dealer.notes?.includes(LUCKI_MARKETPLACE_BACKFILL_MARKER)) return;

  let updated = 0;
  for (const vehicle of vehicles) {
    const values = getLuckiIncomingValues(vehicle);
    const next = {
      lotLocation: values.lotLocation,
      transmission: values.transmission,
      condition: values.condition,
      description: values.description,
      bodyStyle: vehicle.bodyStyle?.trim() || values.bodyStyle,
      fuelType: vehicle.fuelType?.trim() || values.fuelType,
    };
    const changed =
      vehicle.lotLocation !== next.lotLocation ||
      vehicle.transmission !== next.transmission ||
      vehicle.condition !== next.condition ||
      vehicle.description !== next.description ||
      vehicle.bodyStyle !== next.bodyStyle ||
      vehicle.fuelType !== next.fuelType;
    if (!changed) continue;
    await db.update(vehiclesTable).set(next).where(eq(vehiclesTable.id, vehicle.id));
    updated += 1;
  }

  const notes = [dealer.notes, LUCKI_MARKETPLACE_BACKFILL_MARKER].filter(Boolean).join("\n");
  await db
    .update(dealersTable)
    .set({ notes })
    .where(eq(dealersTable.id, LUCKI_MAZDA_DEALER_ID));
  log.info(
    { dealerId: LUCKI_MAZDA_DEALER_ID, vehicles: vehicles.length, updated, marker: LUCKI_MARKETPLACE_BACKFILL_MARKER },
    "Lucki Mazda Marketplace one-time backfill applied",
  );
}

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

  const ALPHA_ADDRESS = {
    addressLine1: "9120 Euclid Ave",
    city: "Manassas",
    state: "VA",
    country: "US",
    postalCode: "20110",
    latitude: "38.7594",
    longitude: "-77.4753",
  };

  if (!dealer) {
    const [created] = await db
      .insert(dealersTable)
      .values({
        name: ALPHA,
        websiteUrl: "https://www.alphamotorsport.net",
        xmlFeedUrl: REAL_FEED_URL,
        status: "Active",
        hasCleanTitleInventory: true,
        marketplaceKnowledge: ALPHA_MARKETPLACE_KNOWLEDGE,
        notes: "Primary launch dealer — inventory synced from the real Alpha Motorsport XML feed.",
        ...ALPHA_ADDRESS,
      })
      .returning();
    dealer = created!;
    log.info({ dealerId: dealer.id }, "Seeded Alpha Motorsport dealer");
  } else {
    const needsFeedUpdate = dealer.xmlFeedUrl !== REAL_FEED_URL;
    const needsAddressUpdate = !dealer.addressLine1 || !dealer.latitude;
    const needsTitlePolicyUpdate = dealer.hasCleanTitleInventory !== true;
    const needsKnowledgeUpdate = Object.keys(dealer.marketplaceKnowledge?.en ?? {}).length === 0;
    if (needsFeedUpdate || needsAddressUpdate || needsTitlePolicyUpdate || needsKnowledgeUpdate) {
      await db
        .update(dealersTable)
        .set({
          xmlFeedUrl: REAL_FEED_URL,
          websiteUrl: "https://www.alphamotorsport.net",
          hasCleanTitleInventory: true,
          ...(needsKnowledgeUpdate ? { marketplaceKnowledge: ALPHA_MARKETPLACE_KNOWLEDGE } : {}),
          notes: "Primary launch dealer — inventory synced from the real Alpha Motorsport XML feed.",
          ...ALPHA_ADDRESS,
        })
        .where(eq(dealersTable.id, dealer.id));
      dealer = {
        ...dealer,
        xmlFeedUrl: REAL_FEED_URL,
        hasCleanTitleInventory: true,
        ...(needsKnowledgeUpdate ? { marketplaceKnowledge: ALPHA_MARKETPLACE_KNOWLEDGE } : {}),
        ...ALPHA_ADDRESS,
      };
      log.info({ dealerId: dealer.id }, "Updated Alpha Motorsport dealer record");
    }
  }

  if (!dealer) throw new Error("Alpha Motorsport dealer could not be initialized");

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

/**
 * Creates or refreshes Lucki Mazda's dealer-scoped Vincue inventory settings.
 * The API key is read only at runtime and never persisted in dealer metadata.
 */
export async function seedLuckyMazdaDealer(log: Logger): Promise<Dealer> {
  const [existing] = await db
    .select()
    .from(dealersTable)
    .where(or(eq(dealersTable.name, LUCKI_MAZDA), eq(dealersTable.name, LEGACY_LUCKY_MAZDA)))
    .limit(1);

  if (existing) {
    if (existing.id !== LUCKI_MAZDA_DEALER_ID) {
      throw new Error(`Lucki Mazda must use dealerId=${LUCKI_MAZDA_DEALER_ID}; found dealerId=${existing.id}`);
    }
    const runtime = getLuckiMazdaFeedConfig();
    const configured = Boolean(
      runtime.xmlFeedUrl && runtime.providerDealerId && runtime.feedAuthMode === "x-api-key",
    );
    const configuredNotes = existing.notes?.includes(LUCKI_MARKETPLACE_BACKFILL_MARKER)
      ? `${LUCKI_CONFIGURED_NOTES}\n${LUCKI_MARKETPLACE_BACKFILL_MARKER}`
      : LUCKI_CONFIGURED_NOTES;
    const updates = {
      name: LUCKI_MAZDA,
      ...(existing.notes === LEGACY_LUCKY_NOTES ? { notes: configured ? LUCKI_CONFIGURED_NOTES : LUCKI_NOTES_PENDING } : {}),
      ...(configured
        ? {
            xmlFeedUrl: runtime.xmlFeedUrl,
            providerName: runtime.providerName,
            providerDealerId: runtime.providerDealerId,
            feedAuthMode: "x-api-key",
            notes: configuredNotes,
          }
        : {}),
      ...(existing.hasCleanTitleInventory !== true ? { hasCleanTitleInventory: true } : {}),
      ...LUCKI_LOCATION,
    };
    const changed =
      existing.name !== updates.name ||
      (updates.notes !== undefined && existing.notes !== updates.notes) ||
      (configured && (
        existing.xmlFeedUrl !== updates.xmlFeedUrl ||
        existing.providerName !== updates.providerName ||
        existing.providerDealerId !== updates.providerDealerId ||
        existing.feedAuthMode !== updates.feedAuthMode
      )) || existing.hasCleanTitleInventory !== true;
    const locationChanged =
      existing.city !== LUCKI_LOCATION.city ||
      existing.state !== LUCKI_LOCATION.state ||
      existing.country !== LUCKI_LOCATION.country;
    const hasUpdates = changed || locationChanged;
    const dealer = hasUpdates
      ? (await db.update(dealersTable).set(updates).where(eq(dealersTable.id, existing.id)).returning())[0]!
      : existing;
    if (existing.name !== LUCKI_MAZDA) {
      log.info({ dealerId: existing.id }, "Normalized dealer display name to Lucki Mazda");
    }
    log.info({ dealerId: existing.id, configured }, configured ? "Lucki Mazda dealer feed configuration refreshed" : "Lucki Mazda dealer already exists; inventory remains unconfigured");
    await syncConfiguredLuckiInventory(log, configured);
    await applyLuckiMarketplaceBackfill(log);
    return dealer;
  }

  const runtime = getLuckiMazdaFeedConfig();
  const configured = Boolean(
    runtime.xmlFeedUrl && runtime.providerDealerId && runtime.feedAuthMode === "x-api-key",
  );
  const [created] = await db
    .insert(dealersTable)
    .values({
      id: LUCKI_MAZDA_DEALER_ID,
      name: LUCKI_MAZDA,
      plan: "basic",
      status: "Active",
      hasCleanTitleInventory: true,
      notes: configured ? LUCKI_CONFIGURED_NOTES : LUCKI_NOTES_PENDING,
      ...(configured
        ? {
            xmlFeedUrl: runtime.xmlFeedUrl,
            providerName: runtime.providerName,
            providerDealerId: runtime.providerDealerId,
            feedAuthMode: "x-api-key",
          }
        : {}),
      marketplaceKnowledge: {},
      ...LUCKI_LOCATION,
    })
    .returning();

  if (created!.id !== LUCKI_MAZDA_DEALER_ID) {
    throw new Error(`Lucki Mazda must use dealerId=${LUCKI_MAZDA_DEALER_ID}; created dealerId=${created!.id}`);
  }

  log.info({ dealerId: created!.id, configured }, configured ? "Seeded Lucki Mazda dealer with runtime feed configuration" : "Seeded Lucki Mazda dealer shell without inventory");
  await syncConfiguredLuckiInventory(log, configured);
  await applyLuckiMarketplaceBackfill(log);
  return created!;
}
