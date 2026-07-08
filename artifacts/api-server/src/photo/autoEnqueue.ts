// Auto-enqueue photo jobs after inventory import.
// Called by the scheduler and the manual sync route after importFeed completes.
// Enqueues a Queued job for every active vehicle that has images but no Ready AI set.
// Skips vehicles that are already Processing/Queued, and vehicles without images.
import {
  db,
  aiPhotoJobsTable,
  aiPhotoSetsTable,
  aiStudioPacksTable,
  vehiclesTable,
  vehicleImagesTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { computePhotoHash } from "./changeDetection";

const ELIGIBLE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish"];

export async function autoEnqueueAfterImport(
  dealerId: number,
  log: Logger,
  opts: { maxCount?: number } = {},
): Promise<{ enqueued: number; skipped: number }> {
  const maxCount = opts.maxCount ?? Infinity;
  const [defaultPack] = await db
    .select()
    .from(aiStudioPacksTable)
    .where(and(eq(aiStudioPacksTable.dealerId, dealerId), eq(aiStudioPacksTable.isDefault, true)))
    .limit(1);

  if (!defaultPack) {
    log.warn({ dealerId }, "photo:auto-enqueue skipped — no studio pack configured");
    return { enqueued: 0, skipped: 0 };
  }

  const currentVersion = defaultPack.backgroundVersion ?? "v1";

  const vehicles = await db
    .select({ id: vehiclesTable.id, aiPhotoStatus: vehiclesTable.aiPhotoStatus })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, dealerId),
        inArray(vehiclesTable.status, ELIGIBLE_STATUSES),
      ),
    );

  let enqueued = 0;
  let skipped = 0;

  for (const v of vehicles) {
    if (enqueued >= maxCount) {
      skipped++;
      continue;
    }

    // Skip vehicles already in flight
    if (v.aiPhotoStatus === "Pending" || v.aiPhotoStatus === "Processing") {
      skipped++;
      continue;
    }

    // Skip vehicles already up-to-date with the current background version
    if (v.aiPhotoStatus === "Ready") {
      const [latestSet] = await db
        .select({ studioVersion: aiPhotoSetsTable.studioVersion })
        .from(aiPhotoSetsTable)
        .where(and(eq(aiPhotoSetsTable.vehicleId, v.id), eq(aiPhotoSetsTable.isLatest, true)))
        .limit(1);
      if (latestSet?.studioVersion === currentVersion) {
        skipped++;
        continue;
      }
    }

    const images = await db
      .select({ url: vehicleImagesTable.url })
      .from(vehicleImagesTable)
      .where(eq(vehicleImagesTable.vehicleId, v.id))
      .orderBy(asc(vehicleImagesTable.position));

    if (images.length === 0) {
      skipped++;
      continue;
    }

    const imageHash = computePhotoHash({
      photoUrls: images.map((i) => i.url),
      backgroundVersion: currentVersion,
      modelVersion: "bria-rmbg-2.0",
      presetVersion: "v1",
    });

    await db.insert(aiPhotoJobsTable).values({
      vehicleId: v.id,
      dealerId,
      status: "Queued",
      imageHash,
      studioPackId: defaultPack.id,
      priority: 5,
      totalPhotos: images.length,
      processedPhotos: 0,
      failedPhotos: 0,
    });

    await db
      .update(vehiclesTable)
      .set({ aiPhotoStatus: "Pending" })
      .where(eq(vehiclesTable.id, v.id));

    enqueued++;
  }

  log.info({ dealerId, enqueued, skipped }, "photo:auto-enqueue complete");
  return { enqueued, skipped };
}
