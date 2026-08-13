import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  db,
  pagePublishSettingsTable,
  pagePublishingBatchesTable,
  pagePublishingJobsTable,
  dealersTable,
  listingsTable,
  vehiclesTable,
  type PagePublishSettings,
} from "@workspace/db";
import type { WorkerDefinition, WorkerRunOutcome } from "../workers/types";
import { getVehiclePhotos, getVehicleRawPhotos } from "../features/publishing/infrastructure/publishingRepository";
import { ensurePagesSchema } from "./schema";
import { MetaPagesPublisher, validateMetaPageConnection } from "./metaPagesPublisher";
import { ensureLegacyAlphaMetaConnection, getMetaPageConnection, recordMetaPageValidation } from "./metaPageConnections";
import { ALPHA_DEALER_ID } from "../lib/dealer";

const PAGE_TIME_ZONE = process.env.META_PAGE_TIME_ZONE?.trim() || "America/New_York";
const PAGE_ELIGIBLE_VEHICLE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish"];
const DEFAULT_SETTINGS: Omit<PagePublishSettings, "id" | "createdAt" | "updatedAt" | "dealerId"> = {
  enabled: false,
  vehiclesPerBatch: 3,
  frequencyDays: 1,
  preferredWindowStart: "09:00",
  preferredWindowEnd: "17:00",
  maxPostsPerDay: 3,
  minDelayMinutes: 30,
  requireApproval: false,
  useOriginalPhotos: true,
  aiCreativeIfLow: true,
  photoScoreThreshold: 60,
};

function title(vehicle: { year: number | null; make: string; model: string; trim: string | null }): string {
  return `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`.trim();
}

function message(vehicle: {
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  vdpUrl: string | null;
  stockNumber: string | null;
}, dealerName: string | null): string {
  const lines = [
    title(vehicle),
    vehicle.price ? `Price: $${vehicle.price.toLocaleString("en-US")}` : null,
    vehicle.mileage ? `Mileage: ${vehicle.mileage.toLocaleString("en-US")} miles` : null,
    vehicle.stockNumber ? `Stock #: ${vehicle.stockNumber}` : null,
    vehicle.vdpUrl ? `More details: ${vehicle.vdpUrl}` : null,
    dealerName ? `Available now at ${dealerName}. Message us for availability and financing details.` : "Message us for availability and financing details.",
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour") % 24, minute: value("minute") };
}

function zonedWallTimeToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(guess, timeZone);
    const actualWallMs = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const targetWallMs = Date.UTC(year, month - 1, day, hour, minute);
    guess = new Date(guess.getTime() - (actualWallMs - targetWallMs));
  }
  return guess;
}

function nextWindowStart(now: Date, settings: PagePublishSettings): Date {
  const local = zonedParts(now, PAGE_TIME_ZONE);
  const [hourText, minuteText] = settings.preferredWindowStart.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  let target = zonedWallTimeToUtc(PAGE_TIME_ZONE, local.year, local.month, local.day, hour, minute);
  if (target.getTime() <= now.getTime()) {
    target = zonedWallTimeToUtc(PAGE_TIME_ZONE, local.year, local.month, local.day + 1, hour, minute);
  }
  return target;
}

function publicPhotoUrl(value: string | null): string | null {
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  const base = (process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  return base && value.startsWith("/") ? `${base}${value}` : null;
}

async function assertPublicImageUrls(imageUrls: string[]): Promise<void> {
  for (const imageUrl of imageUrls) {
    if (!/^https:\/\//i.test(imageUrl)) throw new Error(`Photo URL is not publicly reachable over HTTPS: ${imageUrl}`);
    const response = await fetch(imageUrl, {
      method: "GET",
      headers: { Range: "bytes=0-1023" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Photo URL is not a public image (${response.status}): ${imageUrl}`);
    }
    await response.body?.cancel();
  }
}

export async function reconcilePagesBatchProgress(batchId: number, now = new Date()): Promise<void> {
  const [counts] = await db
    .select({
      published: sql<number>`count(*) filter (where ${pagePublishingJobsTable.status} = 'Published')`,
      needsReview: sql<number>`count(*) filter (where ${pagePublishingJobsTable.status} in ('Needs Review', 'Failed'))`,
      total: sql<number>`count(*)`,
    })
    .from(pagePublishingJobsTable)
    .where(eq(pagePublishingJobsTable.batchId, batchId));
  const completedCount = Number(counts?.published ?? 0);
  const failedCount = Number(counts?.needsReview ?? 0);
  const totalVehicles = Number(counts?.total ?? 0);
  const isComplete = totalVehicles > 0 && completedCount + failedCount >= totalVehicles;
  await db.update(pagePublishingBatchesTable).set({
    status: isComplete ? (failedCount > 0 ? "Needs Review" : "Completed") : "Active",
    completedCount,
    failedCount,
    completedAt: isComplete ? now : null,
    updatedAt: now,
  }).where(eq(pagePublishingBatchesTable.id, batchId));
}

async function getSettings(dealerId: number): Promise<PagePublishSettings> {
  const [row] = await db
    .select()
    .from(pagePublishSettingsTable)
    .where(eq(pagePublishSettingsTable.dealerId, dealerId));
  if (row) return row;
  const [created] = await db
    .insert(pagePublishSettingsTable)
    .values({ dealerId, ...DEFAULT_SETTINGS })
    .returning();
  return created!;
}

type PageBatchCandidateSelection = {
  latest: typeof pagePublishingBatchesTable.$inferSelect | undefined;
  targetAt: Date;
  batchLimit: number;
  candidates: typeof vehiclesTable.$inferSelect[];
};

async function selectNextBatchCandidates(
  settings: PagePublishSettings,
  now: Date,
  dealerId: number,
): Promise<PageBatchCandidateSelection> {
  const [latest] = await db.select().from(pagePublishingBatchesTable)
    .where(eq(pagePublishingBatchesTable.dealerId, dealerId))
    .orderBy(desc(pagePublishingBatchesTable.scheduledAt), desc(pagePublishingBatchesTable.id)).limit(1);
  const targetAt = latest?.scheduledAt && latest.scheduledAt.getTime() >= now.getTime()
    ? new Date(latest.scheduledAt.getTime() + settings.frequencyDays * 86_400_000)
    : nextWindowStart(now, settings);
  const publishedVehicleRows = await db
    .select({ vehicleId: listingsTable.vehicleId })
    .from(listingsTable)
    .innerJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
    .where(and(
      eq(listingsTable.channel, "facebook_page"),
      eq(listingsTable.status, "Published"),
      eq(vehiclesTable.dealerId, dealerId),
    ));
  const reservedRows = await db.select({ vehicleId: pagePublishingJobsTable.vehicleId })
    .from(pagePublishingJobsTable)
    .where(and(
      eq(pagePublishingJobsTable.dealerId, dealerId),
      inArray(pagePublishingJobsTable.status, ["Scheduled", "Queued", "Publishing", "Published", "Needs Review"]),
    ));
  const excluded = new Set([...publishedVehicleRows, ...reservedRows].map((row) => row.vehicleId));
  const startMinutes = Number(settings.preferredWindowStart.slice(0, 2)) * 60 + Number(settings.preferredWindowStart.slice(3, 5));
  const endMinutes = Number(settings.preferredWindowEnd.slice(0, 2)) * 60 + Number(settings.preferredWindowEnd.slice(3, 5));
  const windowMinutes = Math.max(0, endMinutes - startMinutes);
  const windowCapacity = settings.minDelayMinutes > 0 ? Math.floor(windowMinutes / settings.minDelayMinutes) + 1 : settings.maxPostsPerDay;
  const batchLimit = Math.max(1, Math.min(settings.vehiclesPerBatch, settings.maxPostsPerDay, windowCapacity));
  const candidates = await db.select().from(vehiclesTable)
    .where(and(
      eq(vehiclesTable.dealerId, dealerId),
      inArray(vehiclesTable.status, PAGE_ELIGIBLE_VEHICLE_STATUSES),
      notInArray(vehiclesTable.id, [...excluded].length ? [...excluded] : [-1]),
    ))
    .orderBy(asc(vehiclesTable.updatedAt)).limit(batchLimit);
  return { latest, targetAt, batchLimit, candidates };
}

export async function previewNextPagesBatch(dealerId: number, now = new Date()) {
  const [storedSettings] = await db
    .select()
    .from(pagePublishSettingsTable)
    .where(eq(pagePublishSettingsTable.dealerId, dealerId));
  const settings = storedSettings ?? ({
    dealerId,
    id: 0,
    createdAt: now,
    updatedAt: now,
    ...DEFAULT_SETTINGS,
  } satisfies PagePublishSettings);
  const selection = await selectNextBatchCandidates(settings, now, dealerId);
  const vehicles = await Promise.all(selection.candidates.map(async (vehicle) => {
    const photos = settings.useOriginalPhotos
      ? await getVehicleRawPhotos(vehicle.id)
      : await getVehiclePhotos(vehicle.id, vehicle.aiPhotoSetId, vehicle.aiPhotoStatus);
    const imageUrls = photos.map((photo) => publicPhotoUrl(photo.url)).filter((url): url is string => Boolean(url));
    let photoError: string | null = imageUrls.length > 0 ? null : "Vehicle has no publishable photos";
    if (!photoError) {
      try {
        await assertPublicImageUrls(imageUrls);
      } catch (error) {
        photoError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      price: vehicle.price,
      stockNumber: vehicle.stockNumber,
      status: vehicle.status,
      photoCount: photos.length,
      publicPhotoCount: imageUrls.length,
      photosReady: photoError === null,
      photoError,
    };
  }));
  return {
    dealerId,
    dryRun: true,
    configured: Boolean(storedSettings),
    planEnabled: storedSettings?.enabled ?? false,
    batchNumber: (selection.latest?.batchNumber ?? 0) + 1,
    scheduledAt: selection.targetAt.toISOString(),
    batchLimit: selection.batchLimit,
    vehicles,
    reason: selection.candidates.length > 0 ? null : "No eligible vehicles for a Pages batch",
  };
}

async function publishOne(job: typeof pagePublishingJobsTable.$inferSelect, log: import("pino").Logger): Promise<void> {
  const config = await getMetaPageConnection(job.dealerId);
  if (!config) throw new Error("Meta Pages publishing is not configured");
  const validation = await validateMetaPageConnection(config, config.scopes);
  await recordMetaPageValidation(job.dealerId, {
    pageName: validation.pageName,
    lastError: validation.error,
    valid: validation.ok,
  });
  if (!validation.ok) throw new Error(validation.error || "Meta Page connection validation failed");
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  if (!vehicle) throw new Error("Vehicle not found");
  const [dealer] = await db.select({ name: dealersTable.name }).from(dealersTable).where(eq(dealersTable.id, job.dealerId)).limit(1);
  const settings = await getSettings(job.dealerId);
  const photos = settings.useOriginalPhotos
    ? await getVehicleRawPhotos(vehicle.id)
    : await getVehiclePhotos(vehicle.id, vehicle.aiPhotoSetId, vehicle.aiPhotoStatus);
  const imageUrls = photos.map((photo) => publicPhotoUrl(photo.url)).filter((url): url is string => Boolean(url));
  if (imageUrls.length === 0) throw new Error("Vehicle has no publishable photos");
  await assertPublicImageUrls(imageUrls);

  await db.update(pagePublishingJobsTable).set({
    status: "Publishing",
    currentStep: "Publishing to Meta Page",
    startedAt: new Date(),
    attempts: sql`${pagePublishingJobsTable.attempts} + 1`,
    updatedAt: new Date(),
  }).where(eq(pagePublishingJobsTable.id, job.id));

  const result = await new MetaPagesPublisher(config).publishVehicle({
    message: message(vehicle, dealer?.name ?? null),
    imageUrls,
  });
  await db.update(pagePublishingJobsTable).set({
    status: "Published",
    currentStep: "Published",
    completedAt: new Date(),
    metaPostId: result.postId,
    postUrl: result.postUrl,
    updatedAt: new Date(),
  }).where(eq(pagePublishingJobsTable.id, job.id));
  await db.insert(listingsTable).values({
    vehicleId: vehicle.id,
    channel: "facebook_page",
    status: "Published",
    externalId: result.postId,
    externalUrl: result.postUrl,
    publishedAt: new Date(),
  }).onConflictDoUpdate({
    target: [listingsTable.vehicleId, listingsTable.channel],
    set: { status: "Published", externalId: result.postId, externalUrl: result.postUrl, publishedAt: new Date() },
  });
  log.info({ jobId: job.id, vehicleId: vehicle.id, postId: result.postId }, "Pages vehicle published");
}

async function createNextBatch(settings: PagePublishSettings, now: Date, dealerId: number): Promise<number> {
  const { latest, targetAt, candidates } = await selectNextBatchCandidates(settings, now, dealerId);
  if (candidates.length === 0) return 0;

  const [batch] = await db.insert(pagePublishingBatchesTable).values({
    dealerId,
    batchNumber: (latest?.batchNumber ?? 0) + 1,
    status: targetAt.getTime() <= now.getTime() ? "Active" : "Scheduled",
    totalVehicles: candidates.length,
    scheduledAt: targetAt,
    startedAt: targetAt.getTime() <= now.getTime() ? now : null,
    notes: "Created automatically by Pages Auto Publish",
  }).returning();
  for (let index = 0; index < candidates.length; index += 1) {
    await db.insert(pagePublishingJobsTable).values({
      batchId: batch!.id,
      vehicleId: candidates[index]!.id,
      dealerId,
      status: targetAt.getTime() + index * settings.minDelayMinutes * 60_000 <= now.getTime() ? "Queued" : "Scheduled",
      scheduledAt: new Date(targetAt.getTime() + index * settings.minDelayMinutes * 60_000),
      currentStep: "Queued for Meta Page",
    });
  }
  return candidates.length;
}

export async function createImmediatePagesBatch(dealerId: number, requestedVehicleId?: number | null, now = new Date()) {
  const [storedSettings] = await db
    .select()
    .from(pagePublishSettingsTable)
    .where(eq(pagePublishSettingsTable.dealerId, dealerId));
  const settings = storedSettings ?? ({
    dealerId,
    id: 0,
    createdAt: now,
    updatedAt: now,
    ...DEFAULT_SETTINGS,
  } satisfies PagePublishSettings);
  const selection = await selectNextBatchCandidates({
    ...settings,
    vehiclesPerBatch: 1,
    maxPostsPerDay: 1,
  }, now, dealerId);
  const candidate = requestedVehicleId == null
    ? selection.candidates[0]
    : selection.candidates.find((vehicle) => vehicle.id === requestedVehicleId);
  if (!candidate) {
    return {
      created: false,
      reason: requestedVehicleId == null
        ? "No eligible vehicles for immediate Pages publishing"
        : "The selected vehicle is no longer eligible for immediate Pages publishing",
    };
  }

  const [existing] = await db
    .select({ id: pagePublishingJobsTable.id, batchId: pagePublishingJobsTable.batchId, status: pagePublishingJobsTable.status })
    .from(pagePublishingJobsTable)
    .where(and(
      eq(pagePublishingJobsTable.dealerId, dealerId),
      eq(pagePublishingJobsTable.vehicleId, candidate.id),
      inArray(pagePublishingJobsTable.status, ["Scheduled", "Queued", "Publishing", "Published", "Needs Review"]),
    ))
    .limit(1);
  if (existing) {
    return { created: false, alreadyQueued: true, ...existing, vehicleId: candidate.id };
  }

  const [batch] = await db.insert(pagePublishingBatchesTable).values({
    dealerId,
    batchNumber: (selection.latest?.batchNumber ?? 0) + 1,
    status: "Active",
    totalVehicles: 1,
    scheduledAt: now,
    startedAt: now,
    notes: "Created by Pages Publish Now",
  }).returning();
  const [job] = await db.insert(pagePublishingJobsTable).values({
    batchId: batch!.id,
    vehicleId: candidate.id,
    dealerId,
    status: "Queued",
    scheduledAt: now,
    currentStep: "Queued for immediate Meta Page publishing",
  }).returning();
  return { created: true, batchId: batch!.id, jobId: job!.id, vehicleId: candidate.id };
}

export const pagesPublishingWorker: WorkerDefinition = {
  id: "pages-publishing",
  name: "Pages Publisher",
  description: "Publishes queued Page vehicles through Meta Graph API without a browser extension.",
  intervalMs: 5 * 60 * 1000,
  enabled: true,
  async run({ log }): Promise<WorkerRunOutcome> {
    await ensurePagesSchema();
    await ensureLegacyAlphaMetaConnection(ALPHA_DEALER_ID);

    const now = new Date();
    const [dueJob] = await db.select().from(pagePublishingJobsTable)
      .where(and(inArray(pagePublishingJobsTable.status, ["Queued", "Scheduled"]), lte(pagePublishingJobsTable.scheduledAt, now)))
      .orderBy(asc(pagePublishingJobsTable.scheduledAt), asc(pagePublishingJobsTable.id)).limit(1);
    if (dueJob) {
      try {
        await publishOne(dueJob, log);
        await reconcilePagesBatchProgress(dueJob.batchId, now);
        return { summary: `Published Pages job #${dueJob.id}`, detail: { jobId: dueJob.id, vehicleId: dueJob.vehicleId } };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await db.update(pagePublishingJobsTable).set({ status: "Needs Review", currentStep: "Needs Review", failedReason: reason, updatedAt: now })
          .where(eq(pagePublishingJobsTable.id, dueJob.id));
        await reconcilePagesBatchProgress(dueJob.batchId, now);
        return { summary: `Pages job #${dueJob.id} needs review: ${reason}`, detail: { jobId: dueJob.id, vehicleId: dueJob.vehicleId } };
      }
    }

    const dealers = await db.select({ id: dealersTable.id }).from(dealersTable).where(eq(dealersTable.status, "Active"));
    let created = 0;
    for (const dealer of dealers) {
      const settings = await getSettings(dealer.id);
      if (!settings.enabled || settings.requireApproval) continue;
      const connection = await getMetaPageConnection(dealer.id);
      if (!connection) continue;
      const validation = await validateMetaPageConnection(connection, connection.scopes);
      await recordMetaPageValidation(dealer.id, {
        pageName: validation.pageName,
        lastError: validation.error,
        valid: validation.ok,
      });
      if (!validation.ok) continue;
      created += await createNextBatch(settings, now, dealer.id);
    }
    return created > 0
      ? { summary: `Queued Pages batch with ${created} vehicle(s)`, detail: { created } }
      : { summary: "No eligible vehicles for Pages auto-publish", skipped: true };
  },
};

export { DEFAULT_SETTINGS };

/**
 * Pages is intentionally scheduled outside the Marketplace orchestrator.
 * Marketplace's orchestrator requires a browser extension; Pages does not.
 */
export function startPagesPublishingWorker(log: import("pino").Logger): void {
  if (process.env["WORKERS_ENABLED"] === "false") return;
  const tick = () => {
    void import("../workers/scheduler")
      .then(({ runWorkerOnce }) => runWorkerOnce(
        pagesPublishingWorker,
        log,
        "auto",
        new Date(Date.now() + pagesPublishingWorker.intervalMs),
      ));
  };
  tick();
  setInterval(tick, pagesPublishingWorker.intervalMs);
}
