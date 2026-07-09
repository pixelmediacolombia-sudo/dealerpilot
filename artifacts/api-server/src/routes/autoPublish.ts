import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getCachedGmDecision, recordGmDecision } from "./gm";
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
  extensionConnectionsTable,
  feedsTable,
  feedRunsTable,
  type AutoPublishSettings,
  type PublishingBatch,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  isExtensionOnline,
  LOT_CITY_MAP,
  resolvePublishMode,
} from "../publishing/controlledMode";
import { getDuplicateConflictVehicleIds } from "../workers/market.worker";

// Dealer scope: Alpha Motorsport = dealer_id 1.
// Do NOT filter by lot_location — the feed stores the dealer name there, not a city.
const DEALER_ID = 1;
const DEALER_FILTER = eq(vehiclesTable.dealerId, DEALER_ID);

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
}, imageCount: number): { eligible: boolean; reason: string | null } {
  if (!vehicle.vin) return { eligible: false, reason: "Missing VIN" };
  if (!vehicle.year) return { eligible: false, reason: "Missing year" };
  if (!vehicle.price) return { eligible: false, reason: "Missing price" };
  if (!vehicle.mileage) return { eligible: false, reason: "Missing mileage" };
  if (imageCount < 5) return { eligible: false, reason: `Only ${imageCount} photo(s) — need at least 5` };
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
  lotLocation: z.string().optional(),
  // Vehicle IDs the operator has explicitly acknowledged and overridden a HOLD/RECONSIDER decision for
  gmOverrides: z.array(z.number().int()).optional().default([]),
});

// POST /auto-publish/batches — select vehicles and create a publishing batch
router.post("/auto-publish/batches", async (req, res) => {
  const parsed = CreateBatchBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid batch request" });
    return;
  }
  const { dealerId, count, scheduledAt, lotLocation, gmOverrides } = parsed.data;
  const gmOverrideSet = new Set(gmOverrides);

  // The client-sent `mode` is advisory only — the server is authoritative.
  // Controlled Mode requires BOTH the global launch switch AND the dealer's
  // own autoClickPublish setting; otherwise every job in this batch runs
  // Assisted regardless of what was requested.
  const [dealerAutoPublishSettings] = await db
    .select()
    .from(autoPublishSettingsTable)
    .where(eq(autoPublishSettingsTable.dealerId, dealerId));
  const mode = resolvePublishMode(dealerAutoPublishSettings?.autoClickPublish ?? false);
  const isImmediate = !scheduledAt;
  if (mode === "Controlled" && isImmediate) {
    const online = await isExtensionOnline();
    if (!online) {
      res.status(422).json({ error: "Chrome extension is offline — cannot dispatch a Controlled Mode batch.", code: "EXTENSION_OFFLINE" });
      return;
    }
  }
  const duplicateConflictIds = await getDuplicateConflictVehicleIds();

  // Fetch active/ready vehicles for this dealer, optionally scoped to a lot location.
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
        lotLocation ? eq(vehiclesTable.lotLocation, lotLocation) : undefined,
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
        inArray(publishingJobsTable.status, [
          "Queued",
          "Retry",
          "Scheduled",
          "Assigned",
          "Claimed",
          "Publishing",
          "Opening Facebook",
          "Filling Form",
          "Auto Publishing",
        ]),
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
    const photoAnalysis = analyzePhotos(imgs);
    let validation = validateVehicleForPublish(v, imgs.length);

    // Lot location must exist and be a known, mapped city (Manassas or Fredericksburg).
    if (validation.eligible && (!v.lotLocation || !LOT_CITY_MAP[v.lotLocation])) {
      validation = { eligible: false, reason: `Unmapped lot location "${v.lotLocation ?? "unknown"}"` };
    }
    // Market Agent duplicate-listing conflict — blocked unless explicitly overridden.
    if (validation.eligible && duplicateConflictIds.has(v.id) && !gmOverrideSet.has(v.id)) {
      validation = { eligible: false, reason: "Market Agent flagged a duplicate-listing conflict" };
    }

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

  const prioritySorted = scored
    .filter((s) => s.eligible)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, count);

  // ── GM Coach guardrail ──────────────────────────────────────────────────────
  // Any vehicle the GM has flagged HOLD or RECONSIDER is blocked from batch
  // publish unless the operator explicitly listed it in gmOverrides.
  const gmBlocked: { vehicleId: number; label: string; recommendation: string; confidence: number }[] = [];
  const eligible = prioritySorted.filter((s) => {
    const gm = getCachedGmDecision(s.vehicle.id);
    const label = `${s.vehicle.year ?? ""} ${s.vehicle.make} ${s.vehicle.model}`.trim();
    const overridden = gmOverrideSet.has(s.vehicle.id);

    req.log.info({
      vehicleId: s.vehicle.id,
      label,
      gmRecommendation: gm?.recommendation ?? "NO_REVIEW",
      gmConfidence: gm?.confidence ?? null,
      gmOverride: overridden,
    }, "GM guardrail batch check");

    if (gm && (gm.recommendation === "HOLD" || gm.recommendation === "RECONSIDER") && !overridden) {
      gmBlocked.push({ vehicleId: s.vehicle.id, label, recommendation: gm.recommendation, confidence: gm.confidence });
      void recordGmDecision({
        vehicleId: s.vehicle.id,
        vehicleLabel: label,
        gmRecommendation: gm.recommendation,
        gmConfidence: gm.confidence,
        operatorAction: "batch_blocked",
        overridden: false,
        finalPublishStatus: "batch_blocked",
        notes: "Blocked during batch creation",
      });
      return false;
    }
    if (gm) {
      void recordGmDecision({
        vehicleId: s.vehicle.id,
        vehicleLabel: label,
        gmRecommendation: gm.recommendation,
        gmConfidence: gm.confidence,
        operatorAction: overridden ? "overridden" : "batch_published",
        overridden,
        finalPublishStatus: "published",
        notes: "Included in batch",
      });
    }
    return true;
  });

  if (gmBlocked.length > 0) {
    req.log.warn({ gmBlocked }, "Batch blocked vehicles due to GM Coach recommendation");
  }

  const ineligible = scored.filter((s) => !s.eligible);
  const needsReviewCount = ineligible.length;

  if (eligible.length === 0) {
    res.status(422).json({
      error: "No vehicles pass validation for publishing",
      gmBlocked: gmBlocked.length > 0 ? gmBlocked : undefined,
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
      lotLocation: lotLocation ?? null,
    })
    .returning();

  // Create publishing jobs for each selected vehicle
  const jobs = [];
  for (let i = 0; i < eligible.length; i++) {
    const s = eligible[i];
    const [job] = await db
      .insert(publishingJobsTable)
      .values({
        listingVersionId: s.bestVersionId ?? null,
        vehicleId: s.vehicle.id,
        dealerId,
        batchId: batch.id,
        mode,
        status: schedAt ? "Scheduled" : "Queued",
        priority: eligible.length - i,
        scheduledAt: schedAt ?? undefined,
        source: "auto_publish_batch",
        approvedByUser: !dealerAutoPublishSettings?.requireApproval,
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

// GET /auto-publish/batches — list batches for a dealer, optionally scoped to a lot location.
router.get("/auto-publish/batches", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEALER_ID;
  const location = typeof req.query.location === "string" ? req.query.location : "";
  const rows = await db
    .select()
    .from(publishingBatchesTable)
    .where(
      and(
        eq(publishingBatchesTable.dealerId, dealerId),
        location ? eq(publishingBatchesTable.lotLocation, location) : undefined,
      ),
    )
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

  // Update currentStep + progressPercent on the job row for live polling.
  // When the extension supplies `details`, use that as the human-readable step
  // text so messages like "Downloading photos 3/6" appear verbatim in the UI.
  const EVENT_PROGRESS_MAP: Record<string, { step: string; progress: number }> = {
    job_claimed:             { step: "Extension connected",              progress: 8   },
    marketplace_opened:      { step: "Opening Facebook",                 progress: 10  },
    opening_facebook:        { step: "Opening Facebook Marketplace",     progress: 15  },
    photo_download_started:  { step: "Downloading photos…",              progress: 12  },
    photo_download_progress: { step: "Downloading photos…",              progress: 17  },
    photo_download_complete: { step: "Photos downloaded",                progress: 25  },
    photo_upload_started:    { step: "Uploading photos to Facebook",     progress: 28  },
    photo_upload_complete:   { step: "Photos uploaded",                  progress: 45  },
    thumbnail_wait_started:  { step: "Waiting for Facebook thumbnails…", progress: 48  },
    thumbnail_detected:      { step: "Thumbnails confirmed",             progress: 52  },
    field_fill_started:      { step: "Filling vehicle details",          progress: 55  },
    filling_form:            { step: "Filling vehicle details",          progress: 58  },
    form_complete:           { step: "All fields filled",                progress: 65  },
    ready_for_review:        { step: "Ready for review",                 progress: 70  },
    auto_publish_starting:   { step: "Starting auto-publish",            progress: 75  },
    next_enabled:            { step: "Form complete — clicking Next",    progress: 76  },
    next_clicked:            { step: "Clicked Next",                     progress: 80  },
    clicking_next:           { step: "Clicking Next…",                   progress: 82  },
    publish_clicked:         { step: "Publishing to Marketplace…",       progress: 88  },
    clicking_publish:        { step: "Clicking Publish…",                progress: 92  },
    listing_url_captured:    { step: "Capturing listing URL",            progress: 95  },
    job_complete:            { step: "Published on Marketplace",         progress: 100 },
    published:               { step: "Published on Marketplace",         progress: 100 },
    auto_publish_failed:     { step: "Auto-publish failed",              progress: 0   },
  };
  const progressData = EVENT_PROGRESS_MAP[parsed.data.event];
  if (progressData) {
    // Use `details` as step text when the extension sends a dynamic message
    // (e.g. "Downloading photos 3/6") so the dashboard shows the exact string.
    const stepText = parsed.data.details || progressData.step;
    await db
      .update(publishingJobsTable)
      .set({ currentStep: stepText, progressPercent: progressData.progress })
      .where(eq(publishingJobsTable.id, jobId));
  }

  // Map events → job status transitions.
  const EVENT_STATUS_MAP: Record<string, string> = {
    opening_facebook:      "Opening Facebook",
    filling_form:          "Filling Form",
    ready_for_review:      "Ready for Review",
    auto_publish_starting: "Auto Publishing",
    clicking_next:         "Auto Publishing",
    clicking_publish:      "Auto Publishing",
  };
  const mappedStatus = EVENT_STATUS_MAP[parsed.data.event];
  if (mappedStatus) {
    await db
      .update(publishingJobsTable)
      .set({ status: mappedStatus })
      .where(
        and(
          eq(publishingJobsTable.id, jobId),
          or(
            eq(publishingJobsTable.status, "Publishing"),
            eq(publishingJobsTable.status, "Opening Facebook"),
            eq(publishingJobsTable.status, "Filling Form"),
            eq(publishingJobsTable.status, "Auto Publishing"),
          ),
        ),
      );
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

// GET /auto-publish/priority-scores — priority scores for dealer vehicles (always scoped to dealer_id=1)
router.get("/auto-publish/priority-scores", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEALER_ID;
  const rows = await db
    .select()
    .from(publishPriorityScoresTable)
    .where(eq(publishPriorityScoresTable.dealerId, dealerId))
    .orderBy(desc(publishPriorityScoresTable.priorityScore));
  res.json({ scores: rows });
});

// GET /auto-publish/photo-scores — photo scores for dealer vehicles (always scoped to dealer_id=1)
router.get("/auto-publish/photo-scores", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEALER_ID;
  const rows = await db
    .select()
    .from(vehiclePhotoScoresTable)
    .where(eq(vehiclePhotoScoresTable.dealerId, dealerId))
    .orderBy(desc(vehiclePhotoScoresTable.photoScore));
  res.json({ scores: rows });
});

// ─── Feed Quality ─────────────────────────────────────────────────────────────

// GET /auto-publish/feed-quality?dealerId=1
router.get("/auto-publish/feed-quality", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  if (!dealerId || Number.isNaN(dealerId)) {
    res.status(400).json({ error: "dealerId required" });
    return;
  }

  // Total active vehicles
  const allVehicles = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, dealerId),
        ne(vehiclesTable.status, "Removed"),
      ),
    );
  const total = allVehicles.length;
  const vehicleIds = allVehicles.map((v) => v.id);

  // Photos per vehicle
  const allImages =
    vehicleIds.length > 0
      ? await db.select().from(vehicleImagesTable).where(inArray(vehicleImagesTable.vehicleId, vehicleIds))
      : [];
  const photoCountByVehicle = new Map<number, number>();
  for (const img of allImages) {
    photoCountByVehicle.set(img.vehicleId, (photoCountByVehicle.get(img.vehicleId) ?? 0) + 1);
  }

  // Listings
  const allListings =
    vehicleIds.length > 0
      ? await db.select().from(listingsTable).where(inArray(listingsTable.vehicleId, vehicleIds))
      : [];
  const listingByVehicle = new Map(allListings.map((l) => [l.vehicleId, l]));

  // Listing versions (to check if a listing was generated)
  const allVersions =
    vehicleIds.length > 0
      ? await db
          .select({ vehicleId: listingVersionsTable.vehicleId })
          .from(listingVersionsTable)
          .where(inArray(listingVersionsTable.vehicleId, vehicleIds))
      : [];
  const vehiclesWithListing = new Set(allVersions.map((v) => v.vehicleId));

  let withFiveOrMorePhotos = 0;
  let missingVin = 0;
  let missingPrice = 0;
  let missingMileage = 0;
  let alreadyPublished = 0;
  let readyForBatch = 0;
  let listingGenerated = 0;
  let photoAnalyzed = 0;

  // Photo scores
  const photoScores =
    vehicleIds.length > 0
      ? await db.select().from(vehiclePhotoScoresTable).where(inArray(vehiclePhotoScoresTable.vehicleId, vehicleIds))
      : [];
  const photoScoreByVehicle = new Map(photoScores.map((s) => [s.vehicleId, s]));

  for (const v of allVehicles) {
    const photoCount = photoCountByVehicle.get(v.id) ?? 0;
    const listing = listingByVehicle.get(v.id);
    const hasListing = vehiclesWithListing.has(v.id);
    const isPublished = listing?.status === "Published" || v.status === "Published";

    if (!v.vin) missingVin++;
    if (!v.price) missingPrice++;
    if (!v.mileage) missingMileage++;
    if (photoCount >= 5) withFiveOrMorePhotos++;
    if (isPublished) alreadyPublished++;
    if (hasListing) listingGenerated++;
    if (photoScoreByVehicle.has(v.id)) photoAnalyzed++;

    // Ready for batch: not published, has VIN/price/mileage/year, 5+ photos, has listing, not already queued
    if (
      !isPublished &&
      v.vin &&
      v.price &&
      v.mileage &&
      v.year &&
      photoCount >= 5 &&
      hasListing
    ) {
      readyForBatch++;
    }
  }

  // Feed info
  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.dealerId, dealerId));
  const [lastRun] = await db
    .select()
    .from(feedRunsTable)
    .where(eq(feedRunsTable.dealerId, dealerId))
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(1);

  res.json({
    quality: {
      total,
      withFiveOrMorePhotos,
      missingVin,
      missingPrice,
      missingMileage,
      alreadyPublished,
      readyForBatch,
      listingGenerated,
      photoAnalyzed,
      feedUrl: feed?.url ?? null,
      lastFeedRunAt: lastRun?.startedAt ?? null,
      lastFeedStatus: lastRun?.status ?? null,
    },
  });
});

// ─── Batch Dry Run ────────────────────────────────────────────────────────────

const DryRunBody = z.object({
  dealerId: z.number().int(),
  count: z.number().int().min(1).max(20).optional().default(4),
});

// POST /auto-publish/dry-run
router.post("/auto-publish/dry-run", async (req, res) => {
  const parsed = DryRunBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid dry run request" });
    return;
  }
  const { dealerId, count } = parsed.data;

  // Same vehicle selection as batch — dealer_id = 1, no DB writes
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, dealerId),
        ne(vehiclesTable.status, "Published"),
        ne(vehiclesTable.status, "Sold"),
        ne(vehiclesTable.status, "Removed"),
      ),
    );

  if (vehicles.length === 0) {
    res.json({ selected: [], skipped: [], totalEligible: 0 });
    return;
  }

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
  const activeJobs = await db
    .select({ vehicleId: publishingJobsTable.vehicleId })
    .from(publishingJobsTable)
    .where(
      and(
        inArray(publishingJobsTable.vehicleId, vehicleIds),
        inArray(publishingJobsTable.status, [
          "Queued",
          "Retry",
          "Scheduled",
          "Assigned",
          "Claimed",
          "Publishing",
          "Opening Facebook",
          "Filling Form",
          "Auto Publishing",
        ]),
      ),
    );
  const alreadyQueued = new Set(activeJobs.map((j) => j.vehicleId));
  const duplicateConflictIds = await getDuplicateConflictVehicleIds();

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

  type ScoredEntry = {
    vehicleId: number;
    label: string;
    vin: string;
    price: number | null;
    mileage: number | null;
    photoCount: number;
    photoScore: number;
    photoDecision: string;
    priorityScore: number;
    eligible: boolean;
    skipReason: string | null;
  };

  const scored: ScoredEntry[] = [];

  for (const v of vehicles) {
    const label = `${v.year ?? ""} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`.trim();

    if (alreadyQueued.has(v.id)) {
      scored.push({ vehicleId: v.id, label, vin: v.vin, price: v.price, mileage: v.mileage, photoCount: 0, photoScore: 0, photoDecision: "needs_review", priorityScore: 0, eligible: false, skipReason: "Already in queue" });
      continue;
    }

    const imgs = imagesByVehicle.get(v.id) ?? [];
    const listing = listingByVehicle.get(v.id);
    if (listing?.status === "Published") {
      scored.push({ vehicleId: v.id, label, vin: v.vin, price: v.price, mileage: v.mileage, photoCount: imgs.length, photoScore: 0, photoDecision: "needs_review", priorityScore: 0, eligible: false, skipReason: "Already published" });
      continue;
    }

    const bestVersion = versionByVehicle.get(v.id);
    const photoAnalysis = analyzePhotos(imgs);
    let validation = validateVehicleForPublish(v, imgs.length);

    if (validation.eligible && (!v.lotLocation || !LOT_CITY_MAP[v.lotLocation])) {
      validation = { eligible: false, reason: `Unmapped lot location "${v.lotLocation ?? "unknown"}"` };
    }
    if (validation.eligible && duplicateConflictIds.has(v.id)) {
      validation = { eligible: false, reason: "Market Agent flagged a duplicate-listing conflict" };
    }

    const neverPublished = !listing || listing.status !== "Published";
    const { priorityScore } = computePriorityScore(v, photoAnalysis.photoScore, neverPublished);

    scored.push({
      vehicleId: v.id,
      label,
      vin: v.vin,
      price: v.price,
      mileage: v.mileage,
      photoCount: imgs.length,
      photoScore: photoAnalysis.photoScore,
      photoDecision: photoAnalysis.photoDecision,
      priorityScore,
      eligible: validation.eligible,
      skipReason: validation.reason,
    });
  }

  const eligible = scored
    .filter((s) => s.eligible)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const selected = eligible.slice(0, count);
  const skipped = scored.filter((s) => !s.eligible);

  res.json({
    selected,
    skipped,
    totalEligible: eligible.length,
  });
});

// ─── Extension Diagnostics ────────────────────────────────────────────────────

// GET /auto-publish/extension-diagnostics?dealerId=1
router.get("/auto-publish/extension-diagnostics", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  if (!dealerId || Number.isNaN(dealerId)) {
    res.status(400).json({ error: "dealerId required" });
    return;
  }

  // All extension connections
  const connections = await db.select().from(extensionConnectionsTable).orderBy(desc(extensionConnectionsTable.lastHeartbeatAt));
  const onlineConnections = connections.filter((c) => c.status === "online");
  const latestConnection = connections[0] ?? null;

  // 5-minute window for "online"
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const extensionOnline =
    onlineConnections.length > 0 ||
    (latestConnection?.lastHeartbeatAt != null && latestConnection.lastHeartbeatAt > fiveMinutesAgo);

  // Last events for this dealer
  const recentEvents = await db
    .select()
    .from(publishingEventsTable)
    .where(eq(publishingEventsTable.dealerId, dealerId))
    .orderBy(desc(publishingEventsTable.createdAt))
    .limit(20);

  const lastJobClaim = recentEvents.find((e) => e.event === "job_claimed");
  const lastMarketplaceOpen = recentEvents.find((e) => e.event === "marketplace_opened");
  const lastPublished = recentEvents.find((e) => e.event === "published");
  const lastEvent = recentEvents[0] ?? null;

  // Check if there are any publishing jobs that succeeded (as a proxy for "publish tested")
  const publishedJobsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(publishingJobsTable)
    .where(and(eq(publishingJobsTable.dealerId, dealerId), eq(publishingJobsTable.status, "Published")));

  res.json({
    diagnostics: {
      extensionOnline,
      connectionCount: connections.length,
      onlineCount: onlineConnections.length,
      lastHeartbeatAt: latestConnection?.lastHeartbeatAt ?? null,
      backendReachable: connections.length > 0,
      facebookSessionVisible: lastMarketplaceOpen != null,
      marketplacePageReachable: lastMarketplaceOpen != null,
      lastJobClaimAt: lastJobClaim?.createdAt ?? null,
      lastJobClaimExtensionId: lastJobClaim?.extensionId ?? null,
      lastEventAt: lastEvent?.createdAt ?? null,
      lastEventType: lastEvent?.event ?? null,
      publishedJobsCount: Number(publishedJobsCount[0]?.count ?? 0),
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        lastHeartbeatAt: c.lastHeartbeatAt,
      })),
    },
  });
});

// ─── Facebook Field Validation Report ─────────────────────────────────────────

// GET /auto-publish/field-validation?dealerId=1
router.get("/auto-publish/field-validation", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  if (!dealerId || Number.isNaN(dealerId)) {
    res.status(400).json({ error: "dealerId required" });
    return;
  }

  // Get recent validation events (fields_filled or validation_passed)
  const events = await db
    .select()
    .from(publishingEventsTable)
    .where(
      and(
        eq(publishingEventsTable.dealerId, dealerId),
        inArray(publishingEventsTable.event, ["fields_filled", "validation_passed", "field_validation"]),
      ),
    )
    .orderBy(desc(publishingEventsTable.createdAt))
    .limit(50);

  // Parse details JSON to extract field validation data
  type FieldReport = {
    jobId: number;
    vehicleId: number;
    eventType: string;
    testedAt: Date;
    titleFound: boolean | null;
    priceFound: boolean | null;
    descriptionFound: boolean | null;
    mileageFound: boolean | null;
    imageUploadFound: boolean | null;
    publishButtonDetected: boolean | null;
    rawDetails: string | null;
  };

  const reports: FieldReport[] = events.map((ev) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = ev.details ? (JSON.parse(ev.details) as Record<string, unknown>) : {};
    } catch {
      // ok
    }
    return {
      jobId: ev.jobId,
      vehicleId: ev.vehicleId,
      eventType: ev.event,
      testedAt: ev.createdAt,
      titleFound: (parsed.titleFound as boolean | null) ?? null,
      priceFound: (parsed.priceFound as boolean | null) ?? null,
      descriptionFound: (parsed.descriptionFound as boolean | null) ?? null,
      mileageFound: (parsed.mileageFound as boolean | null) ?? null,
      imageUploadFound: (parsed.imageUploadFound as boolean | null) ?? null,
      publishButtonDetected: (parsed.publishButtonDetected as boolean | null) ?? null,
      rawDetails: ev.details ?? null,
    };
  });

  // Aggregate latest per field (most recent wins)
  const latest = reports[0] ?? null;
  const aggregated = latest
    ? {
        titleFound: latest.titleFound,
        priceFound: latest.priceFound,
        descriptionFound: latest.descriptionFound,
        mileageFound: latest.mileageFound,
        imageUploadFound: latest.imageUploadFound,
        publishButtonDetected: latest.publishButtonDetected,
        lastTestedAt: latest.testedAt,
        totalReports: reports.length,
      }
    : null;

  res.json({ reports, aggregated });
});

// ─── Launch Checklist ─────────────────────────────────────────────────────────

// GET /auto-publish/launch-checklist?dealerId=1
router.get("/auto-publish/launch-checklist", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : null;
  if (!dealerId || Number.isNaN(dealerId)) {
    res.status(400).json({ error: "dealerId required" });
    return;
  }

  // 1. XML feed connected
  const [feed] = await db.select().from(feedsTable).where(eq(feedsTable.dealerId, dealerId));
  const feedConnected = !!(feed?.url);
  const [lastSuccessfulRun] = await db
    .select()
    .from(feedRunsTable)
    .where(and(eq(feedRunsTable.dealerId, dealerId), eq(feedRunsTable.status, "success")))
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(1);

  // 2. Extension installed (any connection ever seen)
  const connections = await db.select().from(extensionConnectionsTable);
  const extensionInstalled = connections.length > 0;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const extensionOnline =
    connections.some(
      (c) => c.status === "online" || (c.lastHeartbeatAt != null && c.lastHeartbeatAt > fiveMinutesAgo),
    );

  // 3. Facebook logged in (marketplace_opened event seen)
  const [facebookEvent] = await db
    .select()
    .from(publishingEventsTable)
    .where(and(eq(publishingEventsTable.dealerId, dealerId), eq(publishingEventsTable.event, "marketplace_opened")))
    .orderBy(desc(publishingEventsTable.createdAt))
    .limit(1);
  const facebookLoggedIn = !!facebookEvent;

  // 4. At least 5 photos per selected vehicle
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.dealerId, dealerId),
        ne(vehiclesTable.status, "Published"),
        ne(vehiclesTable.status, "Sold"),
        ne(vehiclesTable.status, "Removed"),
      ),
    );
  const vIds = vehicles.map((v) => v.id);
  let vehiclesWithFivePhotos = 0;
  if (vIds.length > 0) {
    const imgs = await db.select().from(vehicleImagesTable).where(inArray(vehicleImagesTable.vehicleId, vIds));
    const counts = new Map<number, number>();
    for (const img of imgs) counts.set(img.vehicleId, (counts.get(img.vehicleId) ?? 0) + 1);
    vehiclesWithFivePhotos = [...counts.values()].filter((c) => c >= 5).length;
  }
  const hasEnoughPhotos = vehiclesWithFivePhotos > 0;

  // 5. Listing generated for at least one vehicle
  let listingGenerated = false;
  if (vIds.length > 0) {
    const [anyVersion] = await db
      .select()
      .from(listingVersionsTable)
      .where(inArray(listingVersionsTable.vehicleId, vIds))
      .limit(1);
    listingGenerated = !!anyVersion;
  }

  // 6. Photo quality analyzed for at least one vehicle
  let photoAnalyzed = false;
  if (vIds.length > 0) {
    const [anyScore] = await db
      .select()
      .from(vehiclePhotoScoresTable)
      .where(inArray(vehiclePhotoScoresTable.vehicleId, vIds))
      .limit(1);
    photoAnalyzed = !!anyScore;
  }

  // 7. Batch dry run passed — proxy: at least one eligible vehicle exists
  // We compute eligibility inline (lightweight version)
  let dryRunPassed = false;
  if (vIds.length > 0) {
    const imgs = await db.select().from(vehicleImagesTable).where(inArray(vehicleImagesTable.vehicleId, vIds));
    const counts = new Map<number, number>();
    for (const img of imgs) counts.set(img.vehicleId, (counts.get(img.vehicleId) ?? 0) + 1);
    const versions = await db
      .select({ vehicleId: listingVersionsTable.vehicleId })
      .from(listingVersionsTable)
      .where(inArray(listingVersionsTable.vehicleId, vIds));
    const withVersion = new Set(versions.map((v) => v.vehicleId));
    dryRunPassed = vehicles.some(
      (v) =>
        v.vin && v.price && v.mileage && v.year && (counts.get(v.id) ?? 0) >= 5 && withVersion.has(v.id),
    );
  }

  // 8. Assisted publish test passed — any published job for dealer
  const [publishedJob] = await db
    .select()
    .from(publishingJobsTable)
    .where(and(eq(publishingJobsTable.dealerId, dealerId), eq(publishingJobsTable.status, "Published")))
    .limit(1);
  const assistedPublishTested = !!publishedJob;

  const items = [
    { key: "feedConnected", label: "XML feed connected", passed: feedConnected, detail: feedConnected ? (lastSuccessfulRun ? `Last sync: ${lastSuccessfulRun.startedAt.toISOString()}` : "Feed URL set — not yet synced") : "No feed URL configured" },
    { key: "extensionInstalled", label: "Extension installed & online", passed: extensionOnline, detail: extensionInstalled ? (extensionOnline ? "Extension is online" : "Extension seen but not currently online") : "Extension has never connected" },
    { key: "facebookLoggedIn", label: "Facebook session active", passed: facebookLoggedIn, detail: facebookLoggedIn ? `Last seen: ${facebookEvent!.createdAt.toISOString()}` : "No Marketplace page activity detected" },
    { key: "hasEnoughPhotos", label: "At least 5 photos per vehicle", passed: hasEnoughPhotos, detail: hasEnoughPhotos ? `${vehiclesWithFivePhotos} vehicle(s) have 5+ photos` : "No vehicles have 5+ photos — upload more" },
    { key: "listingGenerated", label: "AI listing generated", passed: listingGenerated, detail: listingGenerated ? "At least one listing version generated" : "No listings generated yet — run AI generation" },
    { key: "photoAnalyzed", label: "Photo quality analyzed", passed: photoAnalyzed, detail: photoAnalyzed ? "Photo quality scores available" : "Run photo quality analysis first" },
    { key: "dryRunPassed", label: "Batch dry run passed", passed: dryRunPassed, detail: dryRunPassed ? "At least one vehicle passes all validation checks" : "No vehicles eligible — check photo count and listing data" },
    { key: "assistedPublishTested", label: "Assisted publish test passed", passed: assistedPublishTested, detail: assistedPublishTested ? "At least one job successfully published" : "No successful publishes yet" },
  ];

  const passedCount = items.filter((i) => i.passed).length;
  const allPassed = passedCount === items.length;

  res.json({ checklist: { items, passedCount, totalCount: items.length, allPassed } });
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
