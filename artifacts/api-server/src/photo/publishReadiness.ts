import {
  aiPhotoJobsTable,
  aiPhotoSetsTable,
  aiStudioPacksTable,
  db,
  vehicleImagesTable,
  vehiclesTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { computePhotoHash } from "./changeDetection";
import { presetVersionForMode } from "./restorationPolicy";

const PHOTO_DIRECTOR_PENDING_STATUSES = new Set(["Queued", "Pending", "Processing"]);
const PHOTO_DIRECTOR_READY_STATUSES = new Set(["Ready", "Done"]);
const PHOTO_DIRECTOR_MODEL_VERSION = "bria-rmbg-2.0";
const PHOTO_DIRECTOR_PRESET_VERSION = presetVersionForMode("balanced", [], [], [], "balanced");

export const PHOTO_DIRECTOR_WAITING_REASON =
  "Photo Director is preparing the approved Marketplace photo set. Publish again when AI photos are Ready.";

export type PhotoDirectorPublishReadiness =
  | { ready: true; code: "PHOTO_DIRECTOR_READY" | "ORIGINAL_PHOTOS_FALLBACK" }
  | { ready: false; code: "PHOTO_DIRECTOR_PENDING" | "PHOTO_DIRECTOR_QUEUED" | "PHOTO_DIRECTOR_UNAVAILABLE"; reason: string; photoJobId?: number };

export function isPhotoDirectorReadyForPublish(vehicle: {
  aiPhotoStatus: string | null;
  aiPhotoSetId: number | null;
}): boolean {
  return vehicle.aiPhotoSetId !== null && PHOTO_DIRECTOR_READY_STATUSES.has(vehicle.aiPhotoStatus ?? "");
}

export function photoDirectorPublishBlockReason(vehicle: {
  aiPhotoStatus: string | null;
  aiPhotoSetId: number | null;
}): string | null {
  // Photo Director is an enhancement, not a prerequisite for Marketplace.
  // The extension can publish the approved original inventory photos while
  // an AI set is pending or unavailable, as it did before this guardrail.
  return null;
}

export async function ensurePhotoDirectorReadyForPublish(
  vehicle: {
    id: number;
    dealerId: number;
    aiPhotoStatus: string | null;
    aiPhotoSetId: number | null;
  },
  log: Logger,
  options?: { allowOriginalPhotosFallback?: boolean },
): Promise<PhotoDirectorPublishReadiness> {
  if (isPhotoDirectorReadyForPublish(vehicle)) {
    return { ready: true, code: "PHOTO_DIRECTOR_READY" };
  }

  // Preserve the original Marketplace path by default: AI photo processing
  // must not stop an otherwise valid inventory vehicle from reaching the
  // extension. The caller still validates the vehicle and source-photo count.
  if (options?.allowOriginalPhotosFallback !== false) {
    return { ready: true, code: "ORIGINAL_PHOTOS_FALLBACK" };
  }

  const [latestReadySet] = await db
    .select({ id: aiPhotoSetsTable.id })
    .from(aiPhotoSetsTable)
    .where(and(eq(aiPhotoSetsTable.vehicleId, vehicle.id), eq(aiPhotoSetsTable.status, "Ready")))
    .orderBy(desc(aiPhotoSetsTable.isLatest), desc(aiPhotoSetsTable.version), desc(aiPhotoSetsTable.createdAt))
    .limit(1);

  if (latestReadySet) {
    await db
      .update(vehiclesTable)
      .set({ aiPhotoStatus: "Ready", aiPhotoSetId: latestReadySet.id })
      .where(eq(vehiclesTable.id, vehicle.id));
    log.info({ vehicleId: vehicle.id, aiPhotoSetId: latestReadySet.id }, "photo:publish guardrail healed ready AI photo set");
    return { ready: true, code: "PHOTO_DIRECTOR_READY" };
  }

  const [activeJob] = await db
    .select({ id: aiPhotoJobsTable.id, status: aiPhotoJobsTable.status })
    .from(aiPhotoJobsTable)
    .where(and(eq(aiPhotoJobsTable.vehicleId, vehicle.id), inArray(aiPhotoJobsTable.status, ["Queued", "Processing"])))
    .orderBy(asc(aiPhotoJobsTable.priority), desc(aiPhotoJobsTable.createdAt))
    .limit(1);

  if (activeJob || PHOTO_DIRECTOR_PENDING_STATUSES.has(vehicle.aiPhotoStatus ?? "")) {
    return {
      ready: false,
      code: "PHOTO_DIRECTOR_PENDING",
      reason: PHOTO_DIRECTOR_WAITING_REASON,
      photoJobId: activeJob?.id,
    };
  }

  const [defaultPack] = await db
    .select()
    .from(aiStudioPacksTable)
    .where(and(eq(aiStudioPacksTable.dealerId, vehicle.dealerId), eq(aiStudioPacksTable.isDefault, true)))
    .limit(1);

  if (!defaultPack) {
    log.warn({ vehicleId: vehicle.id, dealerId: vehicle.dealerId }, "photo:publish guardrail could not queue - no default studio pack");
    return {
      ready: false,
      code: "PHOTO_DIRECTOR_UNAVAILABLE",
      reason: "Photo Director cannot prepare this vehicle because no default studio pack is configured.",
    };
  }

  const images = await db
    .select({ url: vehicleImagesTable.url })
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicle.id))
    .orderBy(asc(vehicleImagesTable.position));

  if (images.length === 0) {
    return {
      ready: false,
      code: "PHOTO_DIRECTOR_UNAVAILABLE",
      reason: "Photo Director cannot prepare this vehicle because it has no source photos.",
    };
  }

  const studioVersion = defaultPack.backgroundVersion ?? "v1";
  const imageHash = computePhotoHash({
    photoUrls: images.map((image) => image.url),
    backgroundVersion: studioVersion,
    modelVersion: PHOTO_DIRECTOR_MODEL_VERSION,
    presetVersion: PHOTO_DIRECTOR_PRESET_VERSION,
  });

  const [job] = await db
    .insert(aiPhotoJobsTable)
    .values({
      vehicleId: vehicle.id,
      dealerId: vehicle.dealerId,
      status: "Queued",
      imageHash,
      studioPackId: defaultPack.id,
      studioVersion,
      modelVersion: PHOTO_DIRECTOR_MODEL_VERSION,
      presetVersion: PHOTO_DIRECTOR_PRESET_VERSION,
      priority: -5,
      totalPhotos: images.length,
      processedPhotos: 0,
      failedPhotos: 0,
    })
    .returning({ id: aiPhotoJobsTable.id });

  await db
    .update(vehiclesTable)
    .set({ aiPhotoStatus: "Pending" })
    .where(eq(vehiclesTable.id, vehicle.id));

  log.info({ vehicleId: vehicle.id, dealerId: vehicle.dealerId, photoJobId: job?.id }, "photo:publish guardrail queued Photo Director");
  return {
    ready: false,
    code: "PHOTO_DIRECTOR_QUEUED",
    reason: PHOTO_DIRECTOR_WAITING_REASON,
    photoJobId: job?.id,
  };
}
