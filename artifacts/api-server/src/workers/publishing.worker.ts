// Publishing Worker — proactively assigns queued/approved publishing jobs to
// an online extension every 5 minutes. It NEVER publishes anything itself
// (only the Chrome extension, driven by a human-controlled tab, ever clicks
// Publish/Send) — it only performs the same "assign" step a human operator
// would otherwise do manually from the Publishing Queue UI.
//
// Guardrails (all real checks against DB state — nothing fabricated):
//  - Skips entirely if no extension has a recent heartbeat (offline).
//  - Skips vehicles with unknown lot location (lotLocation IS NULL).
//  - Skips vehicles flagged by the Market Agent as a duplicate-listing conflict.
//  - Skips vehicles whose cached GM Coach decision is HOLD or RECONSIDER,
//    unless the job was explicitly approved by a human (approvedByUser=true).
//  - Only jobs already in Queued/Retry with no assignment are touched — jobs
//    created via manual publish-now flows are left exactly as-is.
import {
  autoPublishSettingsTable,
  db,
  extensionConnectionsTable,
  listingVersionsTable,
  listingsTable,
  pool,
  publishingBatchesTable,
  publishingJobsTable,
  publishPriorityScoresTable,
  vehicleImagesTable,
  vehiclePhotoScoresTable,
  vehiclesTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getCachedGmDecision } from "../routes/gm";
import { getDuplicateConflictVehicleIds } from "./market.worker";
import { findLatestNeedsReviewVehicleIds } from "../publishing/needsReviewGuard";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";
import {
  ACTIVE_PUBLISHING_JOB_STATUSES,
  NOT_ELIGIBLE_STATUSES,
  resolveAlphaLotCity,
  resolvePublishMode,
} from "../publishing/controlledMode";
import { isAlphaManassasVehicle } from "../lib/dealer";
import { vehicleOperationalColumns } from "../lib/vehicleColumns";
import { getInitialBatchTiming } from "../publishing/batchProgress";
import { ensurePhotoDirectorReadyForPublish } from "../photo/publishReadiness";
import { reconcileBatchProgress } from "../features/publishing/infrastructure/publishingRepository";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEALER_ID = 1;
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // heartbeat within last 5 minutes = online
const MAX_ASSIGNMENTS_PER_RUN = 1;

async function deferJobForPhotoDirector(jobId: number, reason: string) {
  await db
    .update(publishingJobsTable)
    .set({
      status: "Scheduled",
      scheduledAt: new Date(Date.now() + 10 * 60_000),
      currentStep: "Waiting for Photo Director",
      progressPercent: 0,
      failedReason: reason,
      assignedExtensionId: null,
      assignedAt: null,
      claimedByExtension: null,
    })
    .where(eq(publishingJobsTable.id, jobId));
}
function newYorkDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function newYorkMinuteOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function newYorkCalendarDate(date: Date, daysFromDate: number): string {
  const [year, month, day] = newYorkDateKey(date).split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + daysFromDate));
  return `${shifted.getUTCFullYear().toString().padStart(4, "0")}-${(shifted.getUTCMonth() + 1).toString().padStart(2, "0")}-${shifted.getUTCDate().toString().padStart(2, "0")}`;
}

function newYorkTimeZoneOffsetMinutes(date: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(date).find((entry) => entry.type === "timeZoneName");
  const match = /^GMT([+-])(\d{2}):?(\d{2})?$/.exec(part?.value ?? "GMT+00:00");
  if (!match) return 0;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

function newYorkDateTimeToUtc(date: string, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const asUtc = Date.UTC(year!, month! - 1, day!, Math.floor(minutes / 60), minutes % 60);
  return new Date(asUtc - newYorkTimeZoneOffsetMinutes(new Date(asUtc)) * 60_000);
}

function isWithinWindow(now: Date, start: string, end: string): boolean {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin == null || endMin == null || startMin === endMin) return true;
  const current = newYorkMinuteOfDay(now);
  return startMin < endMin
    ? current >= startMin && current <= endMin
    : current >= startMin || current <= endMin;
}

function analyzePhotos(images: { url: string; position: number }[]) {
  const total = images.length;
  const unique = new Set(images.map((i) => i.url)).size;
  const photoCountScore = total >= 20 ? 40 : total >= 15 ? 35 : total >= 10 ? 28 : total >= 5 ? 18 : total >= 3 ? 10 : total > 0 ? 5 : 0;
  const diversityScore = Math.round((unique / Math.max(total, 1)) * 20);
  const varietyScore = total >= 12 ? 20 : total >= 8 ? 14 : total >= 5 ? 8 : total > 0 ? 4 : 0;
  const completenessScore = total >= 5 ? 20 : Math.round((total / 5) * 20);
  const photoScore = Math.min(100, photoCountScore + diversityScore + varietyScore + completenessScore);
  const sorted = [...images].sort((a, b) => a.position - b.position);

  return {
    photoScore,
    photoLabel: photoScore >= 80 ? "Excellent" : photoScore >= 60 ? "Good" : photoScore > 0 ? "Low Quality" : "No Photos",
    photoDecision: photoScore >= 80 ? "use_original" : photoScore >= 60 ? "use_original_recommend_ai_cover" : photoScore > 0 ? "generate_ai_creative" : "needs_review",
    totalPhotos: total,
    uniquePhotos: unique,
    recommendedCoverUrl: sorted[0]?.url ?? null,
    needsAiCreative: photoScore < 60 ? 1 : 0,
    scoreBreakdown: JSON.stringify({
      photoCount: photoCountScore,
      diversity: diversityScore,
      variety: varietyScore,
      completeness: completenessScore,
    }),
  };
}

function computePriorityScore(vehicle: {
  bodyStyle: string | null;
  price: number | null;
  firstSeenAt: Date;
}, photoScore: number, neverPublished: boolean): number {
  const bs = (vehicle.bodyStyle ?? "").toLowerCase();
  const bodyStyleBonus = bs.includes("truck") || bs.includes("pickup")
    ? 30
    : bs.includes("suv") || bs.includes("crossover")
      ? 20
      : bs.includes("van") || bs.includes("minivan")
        ? 15
        : bs.includes("sedan") || bs.includes("coupe")
          ? 10
          : 5;
  const price = vehicle.price ?? 0;
  const priceBonus =
    price >= 7000 && price < 16000 ? 22 :
    price < 22000 ? 18 :
    price < 28000 ? 12 :
    price < 35000 ? 6 :
    price >= 45000 ? -10 :
    0;
  const daysSinceSeen = Math.floor((Date.now() - vehicle.firstSeenAt.getTime()) / 86_400_000);
  const freshnessBonus = daysSinceSeen <= 3 ? 15 : daysSinceSeen <= 7 ? 10 : daysSinceSeen <= 14 ? 5 : 0;
  const photoBonus = photoScore >= 80 ? 10 : photoScore >= 60 ? 6 : photoScore >= 40 ? 3 : 0;
  const neverPublishedBonus = neverPublished ? 5 : 0;
  return bodyStyleBonus + priceBonus + freshnessBonus + photoBonus + neverPublishedBonus;
}

async function maybeCreateAutomaticBatch(
  log: import("pino").Logger,
  duplicateConflictIds: Set<number>,
): Promise<{ created: number; summary: string | null }> {
  const [settings] = await db
    .select()
    .from(autoPublishSettingsTable)
    .where(eq(autoPublishSettingsTable.dealerId, DEALER_ID));
  if (!settings?.enabled) return { created: 0, summary: null };
  if (settings.requireApproval) {
    return { created: 0, summary: "Auto-publish enabled but waiting for operator approval" };
  }

  const mode = resolvePublishMode(settings.autoClickPublish);
  if (mode !== "Controlled") {
    return { created: 0, summary: "Auto-publish enabled but Controlled mode is off" };
  }

  const now = new Date();
  if (!isWithinWindow(now, settings.preferredWindowStart, settings.preferredWindowEnd)) {
    return { created: 0, summary: `Outside auto-publish window ${settings.preferredWindowStart}-${settings.preferredWindowEnd}` };
  }

  const activeJobs = await db
    .select({ vehicleId: publishingJobsTable.vehicleId })
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.dealerId, DEALER_ID),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
      ),
    );
  const activeVehicleIds = new Set(activeJobs.map((job) => job.vehicleId));
  if (activeJobs.length > 0) {
    log.info(
      { activeJobCount: activeJobs.length, activeVehicleIds: [...activeVehicleIds] },
      "Publishing worker found active jobs; isolating those vehicles so the next candidates can continue",
    );
  }

  const allScheduledJobs = await db
    .select({ createdAt: publishingJobsTable.createdAt, scheduledAt: publishingJobsTable.scheduledAt })
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.dealerId, DEALER_ID));

  const [lastBatch] = await db
    .select({ createdAt: publishingBatchesTable.createdAt, scheduledAt: publishingBatchesTable.scheduledAt })
    .from(publishingBatchesTable)
    .where(
      and(
        eq(publishingBatchesTable.dealerId, DEALER_ID),
        eq(publishingBatchesTable.notes, "Created automatically by Publishing Agent"),
        ne(publishingBatchesTable.status, "Cancelled"),
        ne(publishingBatchesTable.status, "Dismissed"),
      ),
    )
    .orderBy(desc(publishingBatchesTable.createdAt))
    .limit(1);
  const todayKey = newYorkDateKey(now);
  const planStart = parseTimeToMinutes(settings.preferredWindowStart) ?? newYorkMinuteOfDay(now);
  const lastBatchScheduledAt = lastBatch?.scheduledAt ?? lastBatch?.createdAt ?? null;
  const targetBatchAt = lastBatchScheduledAt && newYorkDateKey(lastBatchScheduledAt) === todayKey
    ? newYorkDateTimeToUtc(newYorkCalendarDate(now, 1), planStart)
    : now;
  const targetBatchDateKey = newYorkDateKey(targetBatchAt);
  const lastBatchDateKey = lastBatch ? newYorkDateKey(lastBatch.scheduledAt ?? lastBatch.createdAt) : null;
  if (lastBatchDateKey && targetBatchDateKey <= lastBatchDateKey) {
    return { created: 0, summary: `Auto-publish next batch already planned for ${lastBatchDateKey}` };
  }

  const postsOnTargetDay = allScheduledJobs.filter((job) => newYorkDateKey(job.scheduledAt ?? job.createdAt) === targetBatchDateKey).length;
  const remainingTargetDay = Math.max(0, settings.maxPostsPerDay - postsOnTargetDay);
  if (remainingTargetDay <= 0) {
    return { created: 0, summary: `Daily auto-publish cap reached for ${targetBatchDateKey} (${settings.maxPostsPerDay})` };
  }

  const vehicles = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, DEALER_ID),
        ne(vehiclesTable.status, "Published"),
        ne(vehiclesTable.status, "Sold/Removed"),
        ne(vehiclesTable.status, "Removed"),
        ne(vehiclesTable.status, "Archived"),
      ),
    );
  if (vehicles.length === 0) return { created: 0, summary: "No active vehicles available for auto-publish" };

  const vehicleIds = vehicles.map((v) => v.id);
  const needsReviewVehicleIds = await findLatestNeedsReviewVehicleIds(vehicleIds);
  const allImages = await db
    .select()
    .from(vehicleImagesTable)
    .where(inArray(vehicleImagesTable.vehicleId, vehicleIds))
    .orderBy(asc(vehicleImagesTable.position));
  const allListings = await db
    .select()
    .from(listingsTable)
    .where(inArray(listingsTable.vehicleId, vehicleIds));
  const allVersions = await db
    .select()
    .from(listingVersionsTable)
    .where(inArray(listingVersionsTable.vehicleId, vehicleIds))
    .orderBy(desc(listingVersionsTable.createdAt));

  const imagesByVehicle = new Map<number, typeof allImages>();
  for (const image of allImages) {
    const list = imagesByVehicle.get(image.vehicleId) ?? [];
    list.push(image);
    imagesByVehicle.set(image.vehicleId, list);
  }
  const listingByVehicle = new Map(allListings.map((l) => [l.vehicleId, l]));
  const versionByVehicle = new Map<number, typeof allVersions[0]>();
  for (const version of allVersions) {
    if (!versionByVehicle.has(version.vehicleId)) versionByVehicle.set(version.vehicleId, version);
  }

  const selectedCandidates = vehicles
    .map((vehicle) => {
      if (needsReviewVehicleIds.has(vehicle.id)) return null;
      // An active job blocks only its own vehicle. It must never prevent the
      // automatic planner from creating a batch for other eligible vehicles.
      if (activeVehicleIds.has(vehicle.id)) return null;
      const images = imagesByVehicle.get(vehicle.id) ?? [];
      const listing = listingByVehicle.get(vehicle.id);
      const gm = getCachedGmDecision(vehicle.id);
      const lotCity = resolveAlphaLotCity(vehicle.lotLocation);
      const photoAnalysis = analyzePhotos(images);
      const invalid =
        !vehicle.vin ||
        !vehicle.year ||
        !vehicle.price ||
        !vehicle.mileage ||
        images.length < 5 ||
        listing?.status === "Published" ||
        !lotCity ||
        !isAlphaManassasVehicle(vehicle) ||
        duplicateConflictIds.has(vehicle.id) ||
        (gm && (gm.recommendation === "HOLD" || gm.recommendation === "RECONSIDER"));
      if (invalid) return null;
      const neverPublished = !listing || listing.status !== "Published";
      return {
        vehicle,
        version: versionByVehicle.get(vehicle.id) ?? null,
        photoAnalysis,
        priorityScore: computePriorityScore(vehicle, photoAnalysis.photoScore, neverPublished),
      };
    })
    .filter((entry) => entry != null)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const selected: typeof selectedCandidates = [];
  for (const entry of selectedCandidates) {
    if (selected.length >= Math.min(settings.vehiclesPerBatch, remainingTargetDay)) break;
    const photoReadiness = await ensurePhotoDirectorReadyForPublish(entry.vehicle, log);
    if (!photoReadiness.ready) {
      log.info(
        { vehicleId: entry.vehicle.id, code: photoReadiness.code, photoJobId: photoReadiness.photoJobId ?? null },
        "Publishing worker deferred auto-batch candidate until Photo Director is ready",
      );
      continue;
    }
    selected.push(entry);
  }

  if (selected.length === 0) {
    return { created: 0, summary: "No vehicles passed auto-publish guardrails or Photo Director readiness" };
  }

  const batchCountResult = await db
    .select()
    .from(publishingBatchesTable)
    .where(eq(publishingBatchesTable.dealerId, DEALER_ID));
  const batchNumber = batchCountResult.length + 1;
  const batchTiming = getInitialBatchTiming(targetBatchAt, now.getTime());

  const [batch] = await db
    .insert(publishingBatchesTable)
    .values({
      dealerId: DEALER_ID,
      batchNumber,
      status: batchTiming.status,
      mode,
      totalVehicles: selected.length,
      needsReviewCount: 0,
      scheduledAt: targetBatchAt,
      startedAt: batchTiming.startedAt,
      notes: "Created automatically by Publishing Agent",
    })
    .returning();

  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i]!;
    const jobScheduledAt = new Date(targetBatchAt.getTime() + i * settings.minDelayMinutes * 60_000);
    const jobDueNow = jobScheduledAt.getTime() <= Date.now() + 1000;
    await db
      .insert(publishPriorityScoresTable)
      .values({
        vehicleId: entry.vehicle.id,
        dealerId: DEALER_ID,
        priorityScore: entry.priorityScore,
        eligible: 1,
      })
      .onConflictDoUpdate({
        target: publishPriorityScoresTable.vehicleId,
        set: { priorityScore: entry.priorityScore, eligible: 1, computedAt: now, updatedAt: now },
      });
    await db
      .insert(vehiclePhotoScoresTable)
      .values({
        vehicleId: entry.vehicle.id,
        dealerId: DEALER_ID,
        ...entry.photoAnalysis,
      })
      .onConflictDoUpdate({
        target: vehiclePhotoScoresTable.vehicleId,
        set: { ...entry.photoAnalysis, analyzedAt: now, updatedAt: now },
      });
    await db.insert(publishingJobsTable).values({
      listingVersionId: entry.version?.id ?? null,
      vehicleId: entry.vehicle.id,
      dealerId: DEALER_ID,
      batchId: batch.id,
      mode,
      status: jobDueNow ? "Queued" : "Scheduled",
      priority: selected.length - i,
      scheduledAt: jobScheduledAt,
      source: "auto_publish_batch",
      approvedByUser: true,
    });
  }

  log.info({ batchId: batch.id, count: selected.length }, "Publishing worker created auto-publish batch");
  return { created: selected.length, summary: `Auto-created batch #${batchNumber} with ${selected.length} job(s)` };
}

async function findOnlineExtension(): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select()
    .from(extensionConnectionsTable)
    .orderBy(desc(extensionConnectionsTable.lastHeartbeatAt));
  const cutoff = Date.now() - ONLINE_THRESHOLD_MS;
  const online = rows.find(
    (r) => r.lastHeartbeatAt && r.lastHeartbeatAt.getTime() >= cutoff && r.status === "online",
  );
  const chromeId = online
    ? await pool.query<{ chrome_extension_id: string | null }>(
        "select chrome_extension_id from extension_connections where id = $1 limit 1",
        [online.id],
      )
    : null;
  const extensionId = chromeId?.rows[0]?.chrome_extension_id ?? online?.name ?? null;
  return extensionId && online ? { id: extensionId, name: online.name } : null;
}

async function rebindDueAssignedJobsToOnlineExtension(extensionId: string): Promise<number> {
  const rebound = await db
    .update(publishingJobsTable)
    .set({ assignedExtensionId: extensionId, assignedAt: new Date() })
    .where(
      and(
        eq(publishingJobsTable.status, "Assigned"),
        isNull(publishingJobsTable.claimedByExtension),
        or(isNull(publishingJobsTable.scheduledAt), lte(publishingJobsTable.scheduledAt, new Date())),
        or(
          isNull(publishingJobsTable.assignedExtensionId),
          ne(publishingJobsTable.assignedExtensionId, extensionId),
        ),
      ),
    )
    .returning({ id: publishingJobsTable.id });
  return rebound.length;
}

async function repairLegacyStaleAssignedJobs(log: import("pino").Logger): Promise<number> {
  const stale = await db
    .update(publishingJobsTable)
    .set({
      status: "Retry",
      currentStep: null,
      progressPercent: 0,
      failedReason: null,
      claimedByExtension: null,
      assignedExtensionId: null,
      assignedAt: null,
    })
    .where(
      and(
        eq(publishingJobsTable.status, "Assigned"),
        isNull(publishingJobsTable.claimedByExtension),
        sql`${publishingJobsTable.failedReason} like 'Auto-expired:%'`,
      ),
    )
    .returning({ id: publishingJobsTable.id });

  if (stale.length > 0) {
    log.warn(
      { jobIds: stale.map((job) => job.id) },
      "Publishing worker repaired legacy stale assignments back to Retry",
    );
  }
  return stale.length;
}

async function run({ log }: { log: import("pino").Logger }): Promise<WorkerRunOutcome> {
  const extension = await findOnlineExtension();
  if (!extension) {
    return { summary: "Publishing worker skipped — no extension online", skipped: true };
  }

  const duplicateConflictIds = await getDuplicateConflictVehicleIds();
  const autoBatch = await maybeCreateAutomaticBatch(log, duplicateConflictIds);
  const repairedStaleAssignments = await repairLegacyStaleAssignedJobs(log);
  const reboundAssignments = await rebindDueAssignedJobsToOnlineExtension(extension.id);
  if (reboundAssignments > 0) {
    log.info(
      { extensionId: extension.id, reboundAssignments },
      "Publishing worker rebound unclaimed jobs to the active extension",
    );
  }

  const candidates = await db
    .select({
      job: publishingJobsTable,
      vehicle: vehicleOperationalColumns,
    })
    .from(publishingJobsTable)
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, publishingJobsTable.vehicleId))
    .where(
      and(
        eq(publishingJobsTable.dealerId, DEALER_ID),
        or(
          and(
            eq(publishingJobsTable.status, "Queued"),
            or(isNull(publishingJobsTable.scheduledAt), lte(publishingJobsTable.scheduledAt, new Date())),
          ),
          eq(publishingJobsTable.status, "Retry"),
          and(eq(publishingJobsTable.status, "Scheduled"), lte(publishingJobsTable.scheduledAt, new Date())),
        ),
        isNull(publishingJobsTable.assignedExtensionId),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    )
    .orderBy(desc(publishingJobsTable.priority), asc(publishingJobsTable.createdAt))
    .limit(25);

  log.info(
    {
      nextJobId: candidates[0]?.job.id ?? null,
      nextVehicleLabel: candidates[0]?.vehicle
        ? `${candidates[0].vehicle.year ?? ""} ${candidates[0].vehicle.make} ${candidates[0].vehicle.model}`.trim()
        : null,
      nextSource: candidates[0]?.job.source ?? null,
      nextStatus: candidates[0]?.job.status ?? null,
      nextScheduledAt: candidates[0]?.job.scheduledAt?.toISOString() ?? null,
      candidateCount: candidates.length,
      repairedStaleAssignments,
    },
    "Publishing worker next queue decision",
  );

  let assigned = 0;
  let skippedUnknownLot = 0;
  let skippedDuplicate = 0;
  let skippedGm = 0;
  let skippedPhotoDirector = 0;

  for (const { job, vehicle } of candidates) {
    if (assigned >= MAX_ASSIGNMENTS_PER_RUN) break;

    // Last-moment inventory guard: the joined candidate can be stale if an
    // inventory sync or operator action changed the vehicle after selection.
    const [currentVehicle] = await db
      .select({ status: vehiclesTable.status, dealerId: vehiclesTable.dealerId, lotLocation: vehiclesTable.lotLocation, sourceRaw: vehiclesTable.sourceRaw })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicle.id))
      .limit(1);
    if (!currentVehicle || NOT_ELIGIBLE_STATUSES.has(currentVehicle.status)) {
      const reason = currentVehicle
        ? `Vehicle status is "${currentVehicle.status}" — publishing job cancelled.`
        : "Vehicle no longer exists — publishing job cancelled.";
      const [cancelled] = await db
        .update(publishingJobsTable)
        .set({
          status: "Cancelled",
          failedReason: reason,
          currentStep: "Cancelled - vehicle not eligible",
          claimedByExtension: null,
          assignedExtensionId: null,
          assignedAt: null,
        })
        .where(
          and(
            eq(publishingJobsTable.id, job.id),
            inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
          ),
        )
        .returning({ id: publishingJobsTable.id });
      if (cancelled) await reconcileBatchProgress(job.batchId);
      log.warn({ jobId: job.id, vehicleId: vehicle.id, status: currentVehicle?.status ?? null }, "Publishing worker blocked terminal vehicle at final guardrail");
      continue;
    }

    if (!isAlphaManassasVehicle(currentVehicle)) {
      skippedUnknownLot++;
      await db
        .update(publishingJobsTable)
        .set({
          status: "Needs Review",
          failedReason: "Vehicle is not verified as Alpha Manassas inventory",
          reviewReason: "NON_MANASSAS_LOT",
          currentStep: "Blocked - non-Manassas inventory",
          claimedByExtension: null,
          assignedExtensionId: null,
          assignedAt: null,
        })
        .where(eq(publishingJobsTable.id, job.id));
      continue;
    }
    if (duplicateConflictIds.has(job.vehicleId)) {
      skippedDuplicate++;
      continue;
    }
    if (!job.approvedByUser) {
      const gmDecision = getCachedGmDecision(job.vehicleId);
      if (gmDecision && gmDecision.recommendation !== "PUBLISH") {
        skippedGm++;
        continue;
      }
      if (gmDecision?.duplicateConflictWarning) {
        skippedDuplicate++;
        continue;
      }
    }

    const photoReadiness = await ensurePhotoDirectorReadyForPublish(vehicle, log);
    if (!photoReadiness.ready) {
      skippedPhotoDirector++;
      await deferJobForPhotoDirector(job.id, photoReadiness.reason);
      log.info(
        { jobId: job.id, vehicleId: vehicle.id, code: photoReadiness.code, photoJobId: photoReadiness.photoJobId ?? null },
        "Publishing worker deferred job until Photo Director is ready",
      );
      continue;
    }

    const [updated] = await db
      .update(publishingJobsTable)
      .set({ status: "Assigned", assignedExtensionId: extension.id, assignedAt: new Date() })
      .where(
        and(
          eq(publishingJobsTable.id, job.id),
          or(
            and(
              eq(publishingJobsTable.status, "Queued"),
              or(isNull(publishingJobsTable.scheduledAt), lte(publishingJobsTable.scheduledAt, new Date())),
            ),
            eq(publishingJobsTable.status, "Retry"),
            and(eq(publishingJobsTable.status, "Scheduled"), lte(publishingJobsTable.scheduledAt, new Date())),
          ),
        ),
      )
      .returning({ id: publishingJobsTable.id });

    if (updated) assigned++;
  }

  if (assigned === 0) {
    const autoSummary = autoBatch.summary ? `${autoBatch.summary}; ` : "";
    return {
      summary: `${autoSummary}No jobs assigned - ${skippedUnknownLot} unknown lot, ${skippedDuplicate} duplicate conflicts, ${skippedGm} GM held, ${skippedPhotoDirector} waiting for Photo Director`,
      skipped: true,
      detail: { autoCreated: autoBatch.created, repairedStaleAssignments, reboundAssignments, skippedUnknownLot, skippedDuplicate, skippedGm, skippedPhotoDirector },
    };
  }

  return {
    summary: `${autoBatch.summary ? `${autoBatch.summary}; ` : ""}Assigned ${assigned} publishing job${assigned === 1 ? "" : "s"} to extension "${extension.id}"`,
    detail: { autoCreated: autoBatch.created, repairedStaleAssignments, reboundAssignments, assigned, skippedUnknownLot, skippedDuplicate, skippedGm, skippedPhotoDirector },
  };
}

export const publishingWorker: WorkerDefinition = {
  id: "publishing",
  name: "Publishing Agent",
  description: "Assigns approved queued jobs to the online extension within guardrails",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
