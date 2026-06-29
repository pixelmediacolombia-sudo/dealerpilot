import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  listingsTable,
  listingVersionsTable,
  publishingJobsTable,
  publishingBatchesTable,
  publishingEventsTable,
  autoPublishSettingsTable,
  vehiclePhotoScoresTable,
  publishPriorityScoresTable,
  type AutoPublishSettings,
  type PublishingBatch,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

const router: IRouter = Router();

// ─── Photo Quality Analyzer ──────────────────────────────────────────────────

function analyzePhotos(
  images: { url: string; position: number }[],
): {
  photoScore: number;
  photoLabel: string;
  photoDecision: string;
  totalPhotos: number;
  uniquePhotos: number;
  recommendedCoverUrl: string | null;
  needsAiCreative: number;
  scoreBreakdown: string;
} {
  const total = images.length;
  const unique = new Set(images.map((i) => i.url)).size;

  if (total === 0) {
    return {
      photoScore: 0,
      photoLabel: "No Photos",
      photoDecision: "needs_review",
      totalPhotos: 0,
      uniquePhotos: 0,
      recommendedCoverUrl: null,
      needsAiCreative: 1,
      scoreBreakdown: JSON.stringify({ photoCount: 0, diversity: 0, variety: 0 }),
    };
  }

  // Photo count score (0–40 pts)
  let photoCountScore = 0;
  if (total >= 20) photoCountScore = 40;
  else if (total >= 15) photoCountScore = 35;
  else if (total >= 10) photoCountScore = 28;
  else if (total >= 5) photoCountScore = 18;
  else if (total >= 3) photoCountScore = 10;
  else photoCountScore = 5;

  // Diversity score — ratio of unique to total (0–20 pts)
  const diversityRatio = unique / Math.max(total, 1);
  const diversityScore = Math.round(diversityRatio * 20);

  // Variety heuristic — more photos suggests interior/exterior variety (0–20 pts)
  const varietyScore = total >= 12 ? 20 : total >= 8 ? 14 : total >= 5 ? 8 : 4;

  // Completeness — has at least 5 photos (0–20 pts)
  const completenessScore = total >= 5 ? 20 : Math.round((total / 5) * 20);

  const photoScore = Math.min(
    100,
    photoCountScore + diversityScore + varietyScore + completenessScore,
  );

  let photoLabel: string;
  let photoDecision: string;
  let needsAiCreative: number;

  if (photoScore >= 80) {
    photoLabel = "Excellent";
    photoDecision = "use_original";
    needsAiCreative = 0;
  } else if (photoScore >= 60) {
    photoLabel = "Good";
    photoDecision = "use_original_recommend_ai_cover";
    needsAiCreative = 0;
  } else if (photoScore >= 1) {
    photoLabel = "Low Quality";
    photoDecision = "generate_ai_creative";
    needsAiCreative = 1;
  } else {
    photoLabel = "No Photos";
    photoDecision = "needs_review";
    needsAiCreative = 1;
  }

  const sorted = [...images].sort((a, b) => a.position - b.position);
  const recommendedCoverUrl = sorted[0]?.url ?? null;

  return {
    photoScore,
    photoLabel,
    photoDecision,
    totalPhotos: total,
    uniquePhotos: unique,
    recommendedCoverUrl,
    needsAiCreative,
    scoreBreakdown: JSON.stringify({
      photoCount: photoCountScore,
      diversity: diversityScore,
      variety: varietyScore,
      completeness: completenessScore,
    }),
  };
}

// ─── Vehicle Selection / Priority Scoring ────────────────────────────────────

function computePriorityScore(vehicle: {
  bodyStyle: string | null;
  price: number | null;
  mileage: number | null;
  vin: string;
  year: number | null;
  make: string;
  model: string;
  firstSeenAt: Date;
  status: string;
}, photoScore: number, neverPublished: boolean) {
  // Body-style bonus
  const bs = (vehicle.bodyStyle ?? "").toLowerCase();
  let bodyStyleBonus = 0;
  if (bs.includes("truck") || bs.includes("pickup")) bodyStyleBonus = 30;
  else if (bs.includes("suv") || bs.includes("crossover")) bodyStyleBonus = 20;
  else if (bs.includes("van") || bs.includes("minivan")) bodyStyleBonus = 15;
  else if (bs.includes("sedan") || bs.includes("coupe")) bodyStyleBonus = 10;
  else bodyStyleBonus = 5;

  // Price bonus — higher price = higher margin potential
  const price = vehicle.price ?? 0;
  let priceBonus = 0;
  if (price >= 40000) priceBonus = 20;
  else if (price >= 25000) priceBonus = 15;
  else if (price >= 15000) priceBonus = 10;
  else if (price >= 5000) priceBonus = 5;

  // Freshness — how recently the vehicle was first seen
  const daysSinceSeen = Math.floor(
    (Date.now() - vehicle.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  const freshnessBonus = daysSinceSeen <= 3 ? 15 : daysSinceSeen <= 7 ? 10 : daysSinceSeen <= 14 ? 5 : 0;

  // Photo quality bonus
  const photoBonus = photoScore >= 80 ? 10 : photoScore >= 60 ? 6 : photoScore >= 40 ? 3 : 0;

  // Never-published bonus
  const neverPublishedBonus = neverPublished ? 5 : 0;

  const priorityScore =
    bodyStyleBonus + priceBonus + freshnessBonus + photoBonus + neverPublishedBonus;

  return { priorityScore, bodyStyleBonus, priceBonus, freshnessBonus, photoBonus, neverPublishedBonus };
}

function validateVehicleForPublish(vehicle: {
  vin: string;
  year: number | null;
  make: string;
  model: string;
  price: number | null;
  mileage: number | null;
}, imageCount: number, hasListing: boolean): { eligible: boolean; reason: string | null } {
  if (!vehicle.vin) return { eligible: false, reason: "Missing VIN" };
  if (!vehicle.year) return { eligible: false, reason: "Missing year" };
  if (!vehicle.price) return { eligible: false, reason: "Missing price" };
  if (!vehicle.mileage) return { eligible: false, reason: "Missing mileage" };
  if (imageCount < 5) return { eligible: false, reason: `Only ${imageCount} photo(s) — need at least 5` };
  if (!hasListing) return { eligible: false, reason: "No listing generated yet" };
  return { eligible: true, reason: null };
}

// ─── Auto-Publish Settings ────────────────────────────────────────────────────

// GET /auto-publish/settings/:dealerId
router.get("/auto-publish/settings/:dealerId", async (req, res) => {
  const dealerId = Number(req.params.dealerId);
  if (Number.isNaN(dealerId)) {
    res.status(400).json({ error: "Invalid dealerId" });
    return;
  }
  const [row] = await db
    .select()
    .from(autoPublishSettingsTable)
    .where(eq(autoPublishSettingsTable.dealerId, dealerId));

  // Return defaults if not configured yet
  if (!row) {
    const defaults: Omit<AutoPublishSettings, "id" | "createdAt" | "updatedAt"> = {
      dealerId,
      enabled: false,
      vehiclesPerBatch: 4,
      frequencyDays: 2,
      preferredWindowStart: "09:00",
      preferredWindowEnd: "17:00",
      maxPostsPerDay: 4,
      minDelayMinutes: 10,
      maxDelayMinutes: 20,
      requireApproval: true,
      autoClickPublish: false,
      useOriginalPhotos: true,
      aiCreativeIfLow: true,
      photoScoreThreshold: 60,
    };
    res.json({ settings: { id: null, ...defaults, createdAt: null, updatedAt: null } });
    return;
  }

  res.json({ settings: row });
});

const SettingsBody = z.object({
  enabled: z.boolean().optional(),
  vehiclesPerBatch: z.number().int().min(1).max(20).optional(),
  frequencyDays: z.number().int().min(1).max(30).optional(),
  preferredWindowStart: z.string().optional(),
  preferredWindowEnd: z.string().optional(),
  maxPostsPerDay: z.number().int().min(1).max(20).optional(),
  minDelayMinutes: z.number().int().min(1).max(120).optional(),
  maxDelayMinutes: z.number().int().min(1).max(120).optional(),
  requireApproval: z.boolean().optional(),
  autoClickPublish: z.boolean().optional(),
  useOriginalPhotos: z.boolean().optional(),
  aiCreativeIfLow: z.boolean().optional(),
  photoScoreThreshold: z.number().int().min(0).max(100).optional(),
});

// PUT /auto-publish/settings/:dealerId
router.put("/auto-publish/settings/:dealerId", async (req, res) => {
  const dealerId = Number(req.params.dealerId);
  if (Number.isNaN(dealerId)) {
    res.status(400).json({ error: "Invalid dealerId" });
    return;
  }
  const parsed = SettingsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings body" });
    return;
  }

  const [existing] = await db
    .select()
    .from(autoPublishSettingsTable)
    .where(eq(autoPublishSettingsTable.dealerId, dealerId));

  let row: AutoPublishSettings;
  if (existing) {
    const [updated] = await db
      .update(autoPublishSettingsTable)
      .set(parsed.data)
      .where(eq(autoPublishSettingsTable.dealerId, dealerId))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(autoPublishSettingsTable)
      .values({ dealerId, ...parsed.data })
      .returning();
    row = inserted;
  }

  req.log.info({ dealerId }, "Auto-publish settings updated");
  res.json({ settings: row });
});

// ─── Photo Scores ─────────────────────────────────────────────────────────────

// POST /auto-publish/vehicles/:vehicleId/photo-score — analyze and store photo score
router.post("/auto-publish/vehicles/:vehicleId/photo-score", async (req, res) => {
  const vehicleId = Number(req.params.vehicleId);
  if (Number.isNaN(vehicleId)) {
    res.status(400).json({ error: "Invalid vehicleId" });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicleId))
    .orderBy(asc(vehicleImagesTable.position));

  const analysis = analyzePhotos(images);

  const [score] = await db
    .insert(vehiclePhotoScoresTable)
    .values({ vehicleId, dealerId: vehicle.dealerId, ...analysis })
    .onConflictDoUpdate({
      target: vehiclePhotoScoresTable.vehicleId,
      set: { ...analysis, analyzedAt: new Date(), updatedAt: new Date() },
    })
    .returning();

  res.json({ score });
});

// GET /auto-publish/vehicles/:vehicleId/photo-score
router.get("/auto-publish/vehicles/:vehicleId/photo-score", async (req, res) => {
  const vehicleId = Number(req.params.vehicleId);
  if (Number.isNaN(vehicleId)) {
    res.status(400).json({ error: "Invalid vehicleId" });
    return;
  }

  const [score] = await db
    .select()
    .from(vehiclePhotoScoresTable)
    .where(eq(vehiclePhotoScoresTable.vehicleId, vehicleId));

  res.json({ score: score ?? null });
});

// ─── Batch Creation (vehicle selection + validation) ─────────────────────────

const CreateBatchBody = z.object({
  dealerId: z.number().int(),
  mode: z.enum(["Assisted", "Controlled"]).optional().default("Assisted"),
  count: z.number().int().min(1).max(20).optional().default(4),
  scheduledAt: z.string().optional(),
});

// POST /auto-publish/batches — select vehicles and create a publishing batch
router.post("/auto-publish/batches", async (req, res) => {
  const parsed = CreateBatchBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid batch request" });
    return;
  }
  const { dealerId, mode, count, scheduledAt } = parsed.data;

  // Fetch all active/ready vehicles for this dealer
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, dealerId),
        // Not already published or sold
        ne(vehiclesTable.status, "Published"),
        ne(vehiclesTable.status, "Sold"),
        ne(vehiclesTable.status, "Removed"),
      ),
    );

  if (vehicles.length === 0) {
    res.status(422).json({ error: "No eligible vehicles found for this dealer" });
    return;
  }

  const vehicleIds = vehicles.map((v) => v.id);

  // Load images for all vehicles at once
  const allImages = await db
    .select()
    .from(vehicleImagesTable)
    .where(inArray(vehicleImagesTable.vehicleId, vehicleIds))
    .orderBy(asc(vehicleImagesTable.position));

  // Load existing listings
  const allListings = await db
    .select()
    .from(listingsTable)
    .where(inArray(listingsTable.vehicleId, vehicleIds));

  // Load best listing versions (to know if a listing was generated)
  const allVersions = await db
    .select()
    .from(listingVersionsTable)
    .where(inArray(listingVersionsTable.vehicleId, vehicleIds))
    .orderBy(desc(listingVersionsTable.createdAt));

  // Check which vehicles are already in the queue or publishing
  const activeJobs = await db
    .select({ vehicleId: publishingJobsTable.vehicleId })
    .from(publishingJobsTable)
    .where(
      and(
        inArray(publishingJobsTable.vehicleId, vehicleIds),
        inArray(publishingJobsTable.status, ["Queued", "Publishing", "Scheduled"]),
      ),
    );
  const alreadyQueued = new Set(activeJobs.map((j) => j.vehicleId));

  // Build maps
  const imagesByVehicle = new Map<number, typeof allImages>();
  for (const img of allImages) {
    const arr = imagesByVehicle.get(img.vehicleId) ?? [];
    arr.push(img);
    imagesByVehicle.set(img.vehicleId, arr);
  }
  const listingByVehicle = new Map(allListings.map((l) => [l.vehicleId, l]));
  const versionByVehicle = new Map<number, typeof allVersions[0]>();
  for (const v of allVersions) {
    if (!versionByVehicle.has(v.vehicleId)) versionByVehicle.set(v.vehicleId, v);
  }

  // Score and validate each vehicle
  type ScoredVehicle = {
    vehicle: typeof vehicles[0];
    priorityScore: number;
    bodyStyleBonus: number;
    priceBonus: number;
    freshnessBonus: number;
    photoBonus: number;
    neverPublishedBonus: number;
    photoAnalysis: ReturnType<typeof analyzePhotos>;
    eligible: boolean;
    ineligibleReason: string | null;
    bestVersionId: number | null;
  };

  const scored: ScoredVehicle[] = [];

  for (const v of vehicles) {
    if (alreadyQueued.has(v.id)) continue; // already in queue

    const imgs = imagesByVehicle.get(v.id) ?? [];
    const listing = listingByVehicle.get(v.id);
    const hasPublishedListing = listing?.status === "Published";
    if (hasPublishedListing) continue; // already live

    const bestVersion = versionByVehicle.get(v.id);
    const hasListing = !!bestVersion;
    const photoAnalysis = analyzePhotos(imgs);
    const validation = validateVehicleForPublish(v, imgs.length, hasListing);
    const neverPublished = !listing || listing.status !== "Published";

    const scores = computePriorityScore(v, photoAnalysis.photoScore, neverPublished);

    scored.push({
      vehicle: v,
      ...scores,
      photoAnalysis,
      eligible: validation.eligible,
      ineligibleReason: validation.reason,
      bestVersionId: bestVersion?.id ?? null,
    });
  }

  // Upsert priority scores
  for (const s of scored) {
    await db
      .insert(publishPriorityScoresTable)
      .values({
        vehicleId: s.vehicle.id,
        dealerId,
        priorityScore: s.priorityScore,
        bodyStyleBonus: s.bodyStyleBonus,
        priceBonus: s.priceBonus,
        freshnessBonus: s.freshnessBonus,
        photoBonus: s.photoBonus,
        neverPublishedBonus: s.neverPublishedBonus,
        eligible: s.eligible ? 1 : 0,
        ineligibleReason: s.ineligibleReason,
      })
      .onConflictDoUpdate({
        target: publishPriorityScoresTable.vehicleId,
        set: {
          priorityScore: s.priorityScore,
          bodyStyleBonus: s.bodyStyleBonus,
          priceBonus: s.priceBonus,
          freshnessBonus: s.freshnessBonus,
          photoBonus: s.photoBonus,
          neverPublishedBonus: s.neverPublishedBonus,
          eligible: s.eligible ? 1 : 0,
          ineligibleReason: s.ineligibleReason,
          computedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    // Upsert photo scores
    await db
      .insert(vehiclePhotoScoresTable)
      .values({
        vehicleId: s.vehicle.id,
        dealerId,
        ...s.photoAnalysis,
      })
      .onConflictDoUpdate({
        target: vehiclePhotoScoresTable.vehicleId,
        set: { ...s.photoAnalysis, analyzedAt: new Date(), updatedAt: new Date() },
      });
  }

  const eligible = scored
    .filter((s) => s.eligible)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, count);

  const ineligible = scored.filter((s) => !s.eligible);
  const needsReviewCount = ineligible.length;

  if (eligible.length === 0) {
    res.status(422).json({
      error: "No vehicles pass validation for publishing",
      details: ineligible.slice(0, 5).map((s) => ({
        vehicleId: s.vehicle.id,
        label: `${s.vehicle.year ?? ""} ${s.vehicle.make} ${s.vehicle.model}`.trim(),
        reason: s.ineligibleReason,
      })),
    });
    return;
  }

  // Count existing batches to set batchNumber
  const batchCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(publishingBatchesTable)
    .where(eq(publishingBatchesTable.dealerId, dealerId));
  const batchNumber = Number(batchCountResult[0]?.count ?? 0) + 1;

  const schedAt = scheduledAt ? new Date(scheduledAt) : null;

  // Create the batch
  const [batch] = await db
    .insert(publishingBatchesTable)
    .values({
      dealerId,
      batchNumber,
      status: schedAt ? "Scheduled" : "Preparing",
      mode,
      totalVehicles: eligible.length,
      needsReviewCount,
      scheduledAt: schedAt ?? undefined,
    })
    .returning();

  // Create publishing jobs for each selected vehicle
  const jobs = [];
  for (let i = 0; i < eligible.length; i++) {
    const s = eligible[i];
    if (!s.bestVersionId) continue;
    const [job] = await db
      .insert(publishingJobsTable)
      .values({
        listingVersionId: s.bestVersionId,
        vehicleId: s.vehicle.id,
        dealerId,
        batchId: batch.id,
        mode,
        status: schedAt ? "Scheduled" : "Queued",
        priority: eligible.length - i,
        scheduledAt: schedAt ?? undefined,
      })
      .returning();
    jobs.push(job);
  }

  req.log.info(
    { batchId: batch.id, jobCount: jobs.length, dealerId },
    "Auto-publish batch created",
  );

  res.json({
    batch,
    jobs: jobs.map((j) => ({ id: j.id, vehicleId: j.vehicleId, status: j.status, mode: j.mode })),
    ineligible: ineligible.slice(0, 5).map((s) => ({
      vehicleId: s.vehicle.id,
      reason: s.ineligibleReason,
    })),
  });
});

// GET /auto-publish/batches — list batches for a dealer
router.get("/auto-publish/batches", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  const rows = await db
    .select()
    .from(publishingBatchesTable)
    .where(dealerId ? eq(publishingBatchesTable.dealerId, dealerId) : undefined)
    .orderBy(desc(publishingBatchesTable.createdAt));
  res.json({ batches: rows });
});

// GET /auto-publish/batches/:id — batch detail with jobs
router.get("/auto-publish/batches/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }
  const [batch] = await db
    .select()
    .from(publishingBatchesTable)
    .where(eq(publishingBatchesTable.id, id));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const jobs = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.batchId, id))
    .orderBy(asc(publishingJobsTable.priority));

  const vehicleIds = [...new Set(jobs.map((j) => j.vehicleId))];
  const vehicleRows =
    vehicleIds.length > 0
      ? await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds))
      : [];
  const vMap = new Map(vehicleRows.map((v) => [v.id, v]));

  const enrichedJobs = jobs.map((j) => {
    const v = vMap.get(j.vehicleId);
    return {
      ...j,
      vehicleLabel: v
        ? `${v.year ?? ""} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`.trim()
        : null,
    };
  });

  res.json({ batch, jobs: enrichedJobs });
});

// ─── Publishing Events ────────────────────────────────────────────────────────

const EventBody = z.object({
  event: z.string().min(1),
  extensionId: z.string().optional(),
  details: z.string().optional(),
  batchId: z.number().int().optional(),
});

// POST /publishing/jobs/:id/event — extension sends a progress event
router.post("/publishing/jobs/:id/event", async (req, res) => {
  const jobId = Number(req.params.id);
  if (Number.isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const parsed = EventBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event body" });
    return;
  }

  const [job] = await db.select().from(publishingJobsTable).where(eq(publishingJobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [ev] = await db
    .insert(publishingEventsTable)
    .values({
      jobId,
      vehicleId: job.vehicleId,
      dealerId: job.dealerId,
      batchId: parsed.data.batchId ?? job.batchId ?? undefined,
      event: parsed.data.event,
      extensionId: parsed.data.extensionId ?? null,
      details: parsed.data.details ?? null,
    })
    .returning();

  // Update batch counters when a job reaches a terminal state via event
  if (job.batchId) {
    if (parsed.data.event === "published") {
      await db
        .update(publishingBatchesTable)
        .set({ completedCount: sql`${publishingBatchesTable.completedCount} + 1` })
        .where(eq(publishingBatchesTable.id, job.batchId));
    } else if (parsed.data.event === "failed") {
      await db
        .update(publishingBatchesTable)
        .set({ failedCount: sql`${publishingBatchesTable.failedCount} + 1` })
        .where(eq(publishingBatchesTable.id, job.batchId));
    } else if (parsed.data.event === "skipped") {
      await db
        .update(publishingBatchesTable)
        .set({ skippedCount: sql`${publishingBatchesTable.skippedCount} + 1` })
        .where(eq(publishingBatchesTable.id, job.batchId));
    }
  }

  res.json({ event: ev });
});

// GET /publishing/jobs/:id/events — get events for a job
router.get("/publishing/jobs/:id/events", async (req, res) => {
  const jobId = Number(req.params.id);
  if (Number.isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const events = await db
    .select()
    .from(publishingEventsTable)
    .where(eq(publishingEventsTable.jobId, jobId))
    .orderBy(asc(publishingEventsTable.createdAt));
  res.json({ events });
});

// GET /auto-publish/priority-scores — priority scores for dealer vehicles
router.get("/auto-publish/priority-scores", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  const rows = await db
    .select()
    .from(publishPriorityScoresTable)
    .where(dealerId ? eq(publishPriorityScoresTable.dealerId, dealerId) : undefined)
    .orderBy(desc(publishPriorityScoresTable.priorityScore));
  res.json({ scores: rows });
});

// GET /auto-publish/photo-scores — photo scores for dealer vehicles
router.get("/auto-publish/photo-scores", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  const rows = await db
    .select()
    .from(vehiclePhotoScoresTable)
    .where(dealerId ? eq(vehiclePhotoScoresTable.dealerId, dealerId) : undefined)
    .orderBy(desc(vehiclePhotoScoresTable.photoScore));
  res.json({ scores: rows });
});

// PATCH /auto-publish/batches/:id — update batch status
const PatchBatchBody = z.object({
  status: z.enum(["Scheduled", "Preparing", "Active", "Paused", "Completed", "Failed", "Cancelled"]).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

router.patch("/auto-publish/batches/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }
  const parsed = PatchBatchBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid patch body" });
    return;
  }

  const updateData: Partial<PublishingBatch> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.startedAt) updateData.startedAt = new Date(parsed.data.startedAt);
  if (parsed.data.completedAt) updateData.completedAt = new Date(parsed.data.completedAt);

  const [updated] = await db
    .update(publishingBatchesTable)
    .set(updateData)
    .where(eq(publishingBatchesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  res.json({ batch: updated });
});

export default router;
