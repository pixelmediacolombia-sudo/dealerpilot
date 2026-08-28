import {
  db,
  feedIngestionsTable,
  feedRunsTable,
  vehiclesTable,
  vehicleImagesTable,
  vehicleChangesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { parseInventoryXml, type FeedImage } from "./xmlEngine";
import { scrapeAlphaLocationMapping } from "./locationScraper";
import { ALPHA_DEALER_ID, ALPHA_LOT_MANASSAS, markVerifiedFeedLotLocation } from "../lib/dealer";
import { syncSoldMarketplaceState } from "../marketplace/soldState";
import { vehicleOperationalColumns, type VehicleOperationalRow } from "../lib/vehicleColumns";

const ACTIVE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish", "Published"];

type ChangeDraft = {
  changeType: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
};

function replaceImages(vehicleId: number, images: FeedImage[]) {
  return (async () => {
    await db.delete(vehicleImagesTable).where(eq(vehicleImagesTable.vehicleId, vehicleId));
    if (images.length > 0) {
      await db.insert(vehicleImagesTable).values(
        images.map(({ url, category }, position) => ({
          vehicleId,
          url,
          position,
          category: category ?? null,
          isPrimary: position === 0,
        })),
      );
    }
  })();
}

async function getImageUrls(vehicleId: number): Promise<string[]> {
  const rows = await db
    .select({ url: vehicleImagesTable.url, position: vehicleImagesTable.position })
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicleId));
  return rows.sort((a, b) => a.position - b.position).map((r) => r.url);
}

function diffField(
  field: string,
  oldVal: string | number | null,
  newVal: string | number | null,
): ChangeDraft | null {
  const o = oldVal === null || oldVal === undefined ? null : String(oldVal);
  const n = newVal === null || newVal === undefined ? null : String(newVal);
  if (o === n) return null;
  return { changeType: `${field}_change`, field, oldValue: o, newValue: n };
}

export type ImportSummary = {
  feedRunId: number;
  rawCount: number;
  imported: number;
  errors: number;
  created: number;
  updated: number;
  removed: number;
  active: number;
  totalImages: number;
  /** Count of vehicles by lot location (key = location name or "unknown") */
  locationBreakdown: Record<string, number>;
};

export async function importFeed(
  dealerId: number,
  xml: string,
  log: Pick<Logger, "info" | "warn">,
  opts?: { trigger?: "auto" | "manual" | "seed" },
): Promise<ImportSummary> {
  const { vehicles: parsed, rawCount, errors: parseErrors } = parseInventoryXml(xml);
  log.info({ dealerId, rawCount, parsed: parsed.length, parseErrors }, "Parsed inventory feed");

  const [run] = await db
    .insert(feedRunsTable)
    .values({ dealerId, status: "running", vehiclesImported: parsed.length, triggerType: opts?.trigger ?? "auto" })
    .returning();
  const feedRunId = run!.id;

  const [ingestion] = await db
    .insert(feedIngestionsTable)
    .values({ dealerId, vehicleCount: parsed.length, status: "running" })
    .returning();

  const abortIngestion = async (status: "aborted_empty" | "aborted_threshold", reason: string): Promise<never> => {
    await db
      .update(feedIngestionsTable)
      .set({ status, abortReason: reason })
      .where(eq(feedIngestionsTable.id, ingestion!.id));
    await db
      .update(feedRunsTable)
      .set({ status, finishedAt: new Date(), vehiclesImported: 0, errorCount: parseErrors + 1, errorMessage: reason })
      .where(eq(feedRunsTable.id, feedRunId));
    log.warn({ dealerId, feedRunId, ingestionId: ingestion!.id, rawCount, parsed: parsed.length, status }, reason);
    throw new Error(reason);
  };

  if (parsed.length === 0) {
    const message =
      rawCount > 0
        ? `Feed parsed 0 vehicles from ${rawCount} raw entries — aborting to protect inventory`
        : "Feed contained no vehicles — aborting to protect inventory";
    await abortIngestion("aborted_empty", message);
  }

  const previousIngestions = await db
    .select({ vehicleCount: feedIngestionsTable.vehicleCount })
    .from(feedIngestionsTable)
    .where(and(eq(feedIngestionsTable.dealerId, dealerId), eq(feedIngestionsTable.status, "ok")))
    .orderBy(desc(feedIngestionsTable.ingestedAt))
    .limit(7);
  const averageVehicleCount = previousIngestions.length > 0
    ? previousIngestions.reduce((sum, row) => sum + row.vehicleCount, 0) / previousIngestions.length
    : null;
  if (averageVehicleCount !== null && parsed.length < averageVehicleCount * 0.8) {
    await abortIngestion(
      "aborted_threshold",
      `Feed count ${parsed.length} is below 80% of the recent average ${averageVehicleCount.toFixed(1)}; no inventory changes were applied`,
    );
  }

  const existing = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealerId));
  const existingByVin = new Map<string, VehicleOperationalRow>();
  for (const v of existing) existingByVin.set(v.vin, v);

  const now = new Date();
  const seenVins = new Set<string>();
  let created = 0;
  let updated = 0;
  let removed = 0;
  let totalImages = 0;
  const locationBreakdown: Record<string, number> = {};

  for (const n of parsed) {
    const persistedSourceRaw = n.lotLocation === ALPHA_LOT_MANASSAS
      ? markVerifiedFeedLotLocation(n.sourceRaw, ALPHA_LOT_MANASSAS)
      : n.sourceRaw;
    // Track location counts for logging
    const locationKey = n.lotLocation ?? "unknown";
    locationBreakdown[locationKey] = (locationBreakdown[locationKey] ?? 0) + 1;

    seenVins.add(n.vin);
    const prior = existingByVin.get(n.vin);

    if (!prior) {
      const [inserted] = await db
        .insert(vehiclesTable)
        .values({
          dealerId,
          vin: n.vin,
          stockNumber: n.stockNumber,
          year: n.year,
          make: n.make,
          model: n.model,
          trim: n.trim,
          mileage: n.mileage,
          price: n.price,
          exteriorColor: n.exteriorColor,
          interiorColor: n.interiorColor,
          bodyStyle: n.bodyStyle,
          transmission: n.transmission,
          fuelType: n.fuelType,
          description: n.description,
          vdpUrl: n.vdpUrl,
          lotLocation: n.lotLocation,
          sourceRaw: persistedSourceRaw,
          status: "New",
          firstSeenAt: now,
          lastSeenAt: now,
          lastSeenInFeedAt: now,
          missingFeedCount: 0,
          lastSyncAt: now,
        })
        .returning();
      await replaceImages(inserted!.id, n.images);
      totalImages += n.images.length;
      await db.insert(vehicleChangesTable).values({
        vehicleId: inserted!.id,
        feedRunId,
        changeType: "new",
        field: null,
        oldValue: null,
        newValue: `${n.year ?? ""} ${n.make} ${n.model}`.trim(),
      });
      created++;
      continue;
    }

    // Existing vehicle — detect field-level changes.
    const drafts: ChangeDraft[] = [];
    const priceDraft = diffField("price", prior.price, n.price);
    if (priceDraft) drafts.push(priceDraft);
    const mileageDraft = diffField("mileage", prior.mileage, n.mileage);
    if (mileageDraft) drafts.push(mileageDraft);
    const descDraft = diffField("description", prior.description, n.description);
    if (descDraft) drafts.push(descDraft);

    const priorImageUrls = await getImageUrls(prior.id);
    const newImageUrls = n.images.map((i) => i.url);
    const imagesChanged =
      priorImageUrls.length !== newImageUrls.length ||
      priorImageUrls.some((u, i) => u !== newImageUrls[i]);
    if (imagesChanged) {
      drafts.push({
        changeType: "image_change",
        field: "images",
        oldValue: `${priorImageUrls.length} photos`,
        newValue: `${newImageUrls.length} photos`,
      });
    }

    // Status transitions.
    let nextStatus = prior.status;
    if (prior.status === "Archived") {
      nextStatus = "Archived";
    } else {
      if (prior.status === "Sold/Removed" && prior.soldAt) {
        nextStatus = "Active";
        drafts.push({
          changeType: "reactivated",
          field: "status",
          oldValue: "Sold/Removed",
          newValue: "Active",
        });
      } else if (prior.status === "New") {
        nextStatus = "Active";
      }
      if (priceDraft && nextStatus !== "Published" && nextStatus !== "Ready to Publish") {
        nextStatus = "Price Changed";
      }
    }

    await db
      .update(vehiclesTable)
      .set({
        stockNumber: n.stockNumber,
        year: n.year,
        make: n.make,
        model: n.model,
        trim: n.trim,
        mileage: n.mileage,
        price: n.price,
        exteriorColor: n.exteriorColor,
        interiorColor: n.interiorColor,
        bodyStyle: n.bodyStyle,
        transmission: n.transmission,
        fuelType: n.fuelType,
        description: n.description,
        vdpUrl: n.vdpUrl,
        lotLocation: n.lotLocation,
        sourceRaw: persistedSourceRaw,
        status: nextStatus,
        lastSeenAt: now,
        lastSeenInFeedAt: now,
        missingFeedCount: 0,
        soldAt: prior.soldAt ? null : prior.soldAt,
        soldDetectionSource: prior.soldAt ? null : prior.soldDetectionSource,
        lastSyncAt: now,
      })
      .where(eq(vehiclesTable.id, prior.id));

    if (imagesChanged) {
      await replaceImages(prior.id, n.images);
      totalImages += n.images.length;
    } else {
      totalImages += priorImageUrls.length;
    }

    if (drafts.length > 0) {
      await db.insert(vehicleChangesTable).values(
        drafts.map((d) => ({
          vehicleId: prior.id,
          feedRunId,
          changeType: d.changeType,
          field: d.field,
          oldValue: d.oldValue,
          newValue: d.newValue,
        })),
      );
      updated++;
    }
  }

  // Vehicles missing from this feed receive a grace run before they are marked sold.
  const missingCandidates = existing.filter(
    (v) =>
      !seenVins.has(v.vin) &&
      v.status !== "Sold/Removed" &&
      v.status !== "Archived",
  );
  const newlySold: VehicleOperationalRow[] = [];
  for (const v of missingCandidates) {
    const missingFeedCount = v.missingFeedCount + 1;
    if (missingFeedCount < 2) {
      await db
        .update(vehiclesTable)
        .set({ missingFeedCount, lastSyncAt: now })
        .where(eq(vehiclesTable.id, v.id));
      continue;
    }
    await db
      .update(vehiclesTable)
      .set({
        status: "Sold/Removed",
        missingFeedCount,
        soldAt: now,
        soldDetectionSource: "feed_absence",
        lastSyncAt: now,
      })
      .where(eq(vehiclesTable.id, v.id));
    await db.insert(vehicleChangesTable).values({
      vehicleId: v.id,
      feedRunId,
      changeType: "removed",
      field: "status",
      oldValue: v.status,
      newValue: "Sold/Removed",
    });
    newlySold.push(v);
    removed++;
  }

  if (newlySold.length > 0) {
    await syncSoldMarketplaceState(newlySold.map((vehicle) => vehicle.id), "inventory_sync");
  }

  const allForDealer = await db
    .select({ status: vehiclesTable.status })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealerId));
  const active = allForDealer.filter((v) => ACTIVE_STATUSES.includes(v.status)).length;

  await db
    .update(feedRunsTable)
    .set({
      status: "success",
      finishedAt: new Date(),
      vehiclesImported: parsed.length,
      vehiclesNew: created,
      vehiclesUpdated: updated,
      vehiclesRemoved: removed,
      vehiclesActive: active,
      errorCount: parseErrors,
    })
    .where(eq(feedRunsTable.id, feedRunId));
  await db
    .update(feedIngestionsTable)
    .set({ status: "ok", abortReason: null })
    .where(eq(feedIngestionsTable.id, ingestion!.id));

  // For Alpha Motorsport: the combined XML feed does NOT contain VehicleLocationID.
  // Scrape the website's location-filtered pages to determine which lot each vehicle
  // is physically parked at the active Manassas location and write it to lot_location.
  if (dealerId === ALPHA_DEALER_ID) {
    try {
      const locationMap = await scrapeAlphaLocationMapping(log);
      if (locationMap.size === 0) {
        throw new Error("Manassas location scrape returned no vehicles");
      }
      const byLocation = new Map<string, string[]>();
      for (const [stock, loc] of locationMap) {
        const list = byLocation.get(loc) ?? [];
        list.push(stock);
        byLocation.set(loc, list);
      }
      for (const [loc, stocks] of byLocation) {
        if (stocks.length === 0) continue;
        await db
          .update(vehiclesTable)
          .set({ lotLocation: loc })
          .where(and(eq(vehiclesTable.dealerId, dealerId), inArray(vehiclesTable.stockNumber, stocks)));
        // Keep branch provenance with the raw feed payload. This makes old
        // rows produced by the previous "all non-empty lots are Manassas"
        // behavior fail closed until a fresh authoritative sync verifies them.
        for (const stock of stocks) {
          const parsedVehicle = parsed.find((vehicle) => vehicle.stockNumber === stock);
          if (!parsedVehicle) continue;
          await db
            .update(vehiclesTable)
            .set({ sourceRaw: markVerifiedFeedLotLocation(parsedVehicle.sourceRaw, loc) })
            .where(and(eq(vehiclesTable.dealerId, dealerId), eq(vehiclesTable.stockNumber, stock)));
        }
      }
      log.info(
        { dealerId, locationMap: Object.fromEntries([...byLocation].map(([k, v]) => [k, v.length])) },
        "Alpha Motorsport lot_location refined from website location scrape",
      );
    } catch (err) {
      log.warn({ dealerId, err }, "Location scrape failed — feed physical city remains authoritative and unknown rows stay blocked");
    }
  }

  // Rebuild the breakdown after the optional stock crosswalk. This also
  // prevents a previous run's Manassas label from surviving when the current
  // feed identifies that stock at Fredericksburg or with no known city.
  const importedRows = await db
    .select({ lotLocation: vehiclesTable.lotLocation })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.dealerId, dealerId), inArray(vehiclesTable.vin, parsed.map((vehicle) => vehicle.vin))));
  for (const key of Object.keys(locationBreakdown)) delete locationBreakdown[key];
  for (const row of importedRows) {
    const key = row.lotLocation ?? "unknown";
    locationBreakdown[key] = (locationBreakdown[key] ?? 0) + 1;
  }

  const locationSummary = Object.entries(locationBreakdown)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  log.info(
    {
      dealerId, feedRunId, rawCount, parseErrors, created, updated, removed, active, totalImages,
      locations: locationBreakdown,
    },
    `Feed import complete — ${parsed.length} vehicles (locations: ${locationSummary || "none"})`,
  );

  return {
    feedRunId,
    rawCount,
    imported: parsed.length,
    errors: parseErrors,
    created,
    updated,
    removed,
    active,
    totalImages,
    locationBreakdown,
  };
}
