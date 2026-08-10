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
import type { WorkerDefinition, WorkerRunOutcome } from "./types";
import {
  ACTIVE_PUBLISHING_JOB_STATUSES,
  LOT_CITY_MAP,
  resolvePublishMode,
} from "../publishing/controlledMode";
import { getInitialBatchTiming } from "../publishing/batchProgress";
import { ensurePhotoDirectorReadyForPublish } from "../photo/publishReadiness";

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
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.dealerId, DEALER_ID),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
      ),
    );
  if (activeJobs.length > 0) {
    return { created: 0, summary: `${activeJobs.length} active publishing job(s) already in queue` };
  }

  const allTodayJobs = await db
    .select({ createdAt: publishingJobsTable.createdAt })
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.dealerId, DEALER_ID));
  const todayKey = newYorkDateKey(now);
  const postsToday = allTodayJobs.filter((j) => newYorkDateKey(j.createdAt) === todayKey).length;
  const remainingToday = Math.max(0, settings.maxPostsPerDay - postsToday);
  if (remainingToday <= 0) {
    return { created: 0, summary: `Daily auto-publish cap reached (${settings.maxPostsPerDay})` };
  }

  const [lastBatch] = await db
    .select({ createdAt: publishingBatchesTable.createdAt })
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
  if (lastBatch) {
    const ageDays = (now.getTime() - lastBatch.createdAt.getTime()) / 86_400_000;
    if (ageDays < settings.frequencyDays) {
      return { created: 0, summary: `Auto-publish frequency not due for ${Math.ceil(settings.frequencyDays - ageDays)} day(s)` };
    }
  }

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, DEALER_ID),
        ne(vehiclesTable.status, "Published"),
        ne(vehiclesTable.status, "Sold/Removed"),
        ne(vehiclesTable.status, "Removed"),
      ),
    );
  if (vehicles.length === 0) return { created: 0, summary: "No active vehicles available for auto-publish" };

  const vehicleIds = vehicles.map((v) => v.id);
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
      const images = imagesByVehicle.get(vehicle.id) ?? [];
      const listing = listingByVehicle.get(vehicle.id);
      const gm = getCachedGmDecision(vehicle.id);
      const lotCity = vehicle.lotLocation ? LOT_CITY_MAP[vehicle.lotLocation] : undefined;
      const photoAnalysis = analyzePhotos(images);
      const invalid =
        !vehicle.vin ||
        !vehicle.year ||
        !vehicle.price ||
        !vehicle.mileage ||
        images.length < 5 ||
        listing?.status === "Published" ||
        !lotCity ||
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
    if (selected.length >= Math.min(settings.vehiclesPerBatch, remainingToday)) break;
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
  const batchTiming = getInitialBatchTiming(now, now.getTime());

  const [batch] = await db
    .insert(publishingBatchesTable)
    .values({
      dealerId: DEALER_ID,
      batchNumber,
      status: batchTiming.status,
      mode,
      totalVehicles: selected.length,
      needsReviewCount: 0,
      scheduledAt: now,
      startedAt: batchTiming.startedAt,
      notes: "Created automatically by Publishing Agent",
    })
    .returning();

  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i]!;
    const jobScheduledAt = new Date(now.getTime() + i * settings.minDelayMinutes * 60_000);
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
      vehicle: vehiclesTable,
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

    if (!vehicle.lotLocation) {
      skippedUnknownLot++;
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
