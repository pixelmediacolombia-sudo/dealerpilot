import {
  db,
  feedRunsTable,
  vehiclesTable,
  vehicleImagesTable,
  vehicleChangesTable,
  type Vehicle,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { parseInventoryXml } from "./xmlEngine";

const ACTIVE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish", "Published"];

type ChangeDraft = {
  changeType: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
};

function replaceImages(vehicleId: number, urls: string[]) {
  return (async () => {
    await db.delete(vehicleImagesTable).where(eq(vehicleImagesTable.vehicleId, vehicleId));
    if (urls.length > 0) {
      await db.insert(vehicleImagesTable).values(
        urls.map((url, position) => ({ vehicleId, url, position })),
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
};

export async function importFeed(
  dealerId: number,
  xml: string,
  log: Pick<Logger, "info" | "warn">,
): Promise<ImportSummary> {
  const { vehicles: parsed, rawCount, errors: parseErrors } = parseInventoryXml(xml);
  log.info({ dealerId, rawCount, parsed: parsed.length, parseErrors }, "Parsed inventory feed");

  const [run] = await db
    .insert(feedRunsTable)
    .values({ dealerId, status: "running", vehiclesImported: parsed.length })
    .returning();
  const feedRunId = run!.id;

  // Safety guard: a feed that parses to zero vehicles is almost always a broken
  // or shape-drifted response (vendor outage, HTML error page, schema change),
  // NOT a dealer who genuinely sold every car. Importing it would mark the
  // entire active inventory as Sold/Removed. Abort without mutating vehicles and
  // record the run as a failure so the Connection Center surfaces it.
  if (parsed.length === 0) {
    const message =
      rawCount > 0
        ? `Feed parsed 0 vehicles from ${rawCount} raw entries — aborting to protect inventory`
        : "Feed contained no vehicles — aborting to protect inventory";
    log.warn({ dealerId, feedRunId, rawCount }, message);
    await db
      .update(feedRunsTable)
      .set({
        status: "error",
        finishedAt: new Date(),
        vehiclesImported: 0,
        errorCount: parseErrors + 1,
        errorMessage: message,
      })
      .where(eq(feedRunsTable.id, feedRunId));
    throw new Error(message);
  }

  const existing = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealerId));
  const existingByVin = new Map<string, Vehicle>();
  for (const v of existing) existingByVin.set(v.vin, v);

  const now = new Date();
  const seenVins = new Set<string>();
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const n of parsed) {
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
          sourceRaw: n.sourceRaw,
          status: "New",
          firstSeenAt: now,
          lastSeenAt: now,
          lastSyncAt: now,
        })
        .returning();
      await replaceImages(inserted!.id, n.images);
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

    // Existing vehicle still in feed — detect field-level changes.
    const drafts: ChangeDraft[] = [];
    const priceDraft = diffField("price", prior.price, n.price);
    if (priceDraft) drafts.push(priceDraft);
    const mileageDraft = diffField("mileage", prior.mileage, n.mileage);
    if (mileageDraft) drafts.push(mileageDraft);
    const descDraft = diffField("description", prior.description, n.description);
    if (descDraft) drafts.push(descDraft);

    const priorImages = await getImageUrls(prior.id);
    const imagesChanged =
      priorImages.length !== n.images.length ||
      priorImages.some((u, i) => u !== n.images[i]);
    if (imagesChanged) {
      drafts.push({
        changeType: "image_change",
        field: "images",
        oldValue: `${priorImages.length} photos`,
        newValue: `${n.images.length} photos`,
      });
    }

    // Status transitions.
    let nextStatus = prior.status;
    if (prior.status === "Archived") {
      nextStatus = "Archived";
    } else {
      if (prior.status === "Sold/Removed") {
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
        sourceRaw: n.sourceRaw,
        status: nextStatus,
        lastSeenAt: now,
        lastSyncAt: now,
      })
      .where(eq(vehiclesTable.id, prior.id));

    if (imagesChanged) await replaceImages(prior.id, n.images);

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

  // Vehicles previously present but missing from this feed -> Sold/Removed.
  const missing = existing.filter(
    (v) =>
      !seenVins.has(v.vin) &&
      v.status !== "Sold/Removed" &&
      v.status !== "Archived",
  );
  for (const v of missing) {
    await db
      .update(vehiclesTable)
      .set({ status: "Sold/Removed", lastSyncAt: now })
      .where(eq(vehiclesTable.id, v.id));
    await db.insert(vehicleChangesTable).values({
      vehicleId: v.id,
      feedRunId,
      changeType: "removed",
      field: "status",
      oldValue: v.status,
      newValue: "Sold/Removed",
    });
    removed++;
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

  log.info(
    { dealerId, feedRunId, rawCount, parseErrors, created, updated, removed, active },
    "Feed import complete",
  );

  return { feedRunId, rawCount, imported: parsed.length, errors: parseErrors, created, updated, removed, active };
}
