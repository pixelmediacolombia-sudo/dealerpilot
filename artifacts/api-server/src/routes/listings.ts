import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  listingVersionsTable,
  listingScoresTable,
  publishingJobsTable,
  listingsTable,
  listingPerformanceTable,
  marketplaceListingsTable,
  type Vehicle,
  type ListingVersion,
  type ListingScore,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { generateListing } from "../listings/generator";
import { scoreListing } from "../listings/scoring";
import { priorityScore } from "../listings/rules";
import { ACTIVE_PUBLISHING_JOB_STATUSES } from "../publishing/controlledMode";
import { compactFutureAutoPublishQueue } from "../publishing/autoPublishQueueCompaction";
import { getDownPaymentPolicy } from "../downPayment/policy";
import { vehicleOperationalColumns, type VehicleOperationalRow } from "../lib/vehicleColumns";

const DEALER_ID = 1;

const router: IRouter = Router();

function toScore(s: ListingScore) {
  return {
    id: s.id,
    listingVersionId: s.listingVersionId,
    vehicleId: s.vehicleId,
    titleQuality: s.titleQuality,
    descriptionQuality: s.descriptionQuality,
    priceStrategy: s.priceStrategy,
    downPaymentStrategy: s.downPaymentStrategy,
    photoScore: s.photoScore,
    overall: s.overall,
    rating: s.rating,
    createdAt: s.createdAt.toISOString(),
  };
}

function toVersion(v: ListingVersion, score: ListingScore | null) {
  return {
    id: v.id,
    vehicleId: v.vehicleId,
    dealerId: v.dealerId,
    version: v.version,
    title: v.title,
    descriptionEn: v.descriptionEn ?? null,
    descriptionEs: v.descriptionEs ?? null,
    language: v.language,
    askingPrice: v.askingPrice ?? null,
    downPayment: v.downPayment ?? null,
    callToAction: v.callToAction ?? null,
    buyerProfile: v.buyerProfile ?? null,
    priority: v.priority ?? null,
    status: v.status,
    generatedBy: v.generatedBy,
    isCurrent: v.isCurrent,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    score: score ? toScore(score) : null,
  };
}

function toVehicleSummary(v: VehicleOperationalRow, primaryImageUrl: string | null, imageCount: number) {
  return {
    id: v.id,
    dealerId: v.dealerId,
    vin: v.vin,
    stockNumber: v.stockNumber ?? null,
    year: v.year ?? null,
    make: v.make,
    model: v.model,
    trim: v.trim ?? null,
    mileage: v.mileage ?? null,
    price: v.price ?? null,
    exteriorColor: v.exteriorColor ?? null,
    interiorColor: v.interiorColor ?? null,
    bodyStyle: v.bodyStyle ?? null,
    transmission: v.transmission ?? null,
    fuelType: v.fuelType ?? null,
    description: v.description ?? null,
    vdpUrl: v.vdpUrl ?? null,
    status: v.status,
    primaryImageUrl,
    imageCount,
    lastSyncAt: v.lastSyncAt ? v.lastSyncAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

// Latest score per listing version id.
async function latestScores(versionIds: number[]): Promise<Map<number, ListingScore>> {
  const map = new Map<number, ListingScore>();
  if (versionIds.length === 0) return map;
  const rows = await db
    .select()
    .from(listingScoresTable)
    .where(inArray(listingScoresTable.listingVersionId, versionIds))
    .orderBy(desc(listingScoresTable.createdAt));
  for (const r of rows) {
    if (!map.has(r.listingVersionId)) map.set(r.listingVersionId, r);
  }
  return map;
}

async function imageInfo(vehicleIds: number[]) {
  const map = new Map<number, { primary: string | null; count: number }>();
  if (vehicleIds.length === 0) return map;
  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(inArray(vehicleImagesTable.vehicleId, vehicleIds))
    .orderBy(asc(vehicleImagesTable.position));
  for (const im of images) {
    const cur = map.get(im.vehicleId) ?? { primary: null, count: 0 };
    if (cur.primary === null) cur.primary = im.url;
    cur.count += 1;
    map.set(im.vehicleId, cur);
  }
  return map;
}

function deriveEngagement(
  messageCount: number,
  leadCount: number,
  hotLeadCount: number,
  appointmentReadyCount: number,
  daysLive: number,
  vehicleStatus: string,
): { engagementStatus: string; recommendation: string | null } {
  // Vehicle-level overrides take priority
  if (vehicleStatus === "Sold/Removed") {
    return {
      engagementStatus: "Sold",
      recommendation: "Vehicle sold/removed from XML — mark Marketplace listing as sold.",
    };
  }
  if (vehicleStatus === "Price Changed") {
    return {
      engagementStatus: "Needs Update",
      recommendation: "Price changed in XML — update Marketplace listing.",
    };
  }

  if (hotLeadCount >= 1 || appointmentReadyCount >= 1 || messageCount >= 3) {
    return { engagementStatus: "Strong", recommendation: "Strong engagement — keep active." };
  }
  if (messageCount >= 1) {
    return { engagementStatus: "Normal", recommendation: null };
  }
  if (daysLive < 1) {
    return { engagementStatus: "No engagement yet", recommendation: null };
  }
  // 0 messages after 24h
  return {
    engagementStatus: "Weak",
    recommendation: "No messages after 24h — change cover photo or lower down payment.",
  };
}

// GET /listings — one workspace per vehicle.
router.get("/listings", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const location = typeof req.query.location === "string" ? req.query.location : "";

  const conditions: SQL[] = [eq(vehiclesTable.dealerId, DEALER_ID)];
  if (location) conditions.push(eq(vehiclesTable.lotLocation, location));
  if (q) {
    const like = `%${q}%`;
    const search = or(
      ilike(vehiclesTable.vin, like),
      ilike(vehiclesTable.stockNumber, like),
      ilike(vehiclesTable.make, like),
      ilike(vehiclesTable.model, like),
      ilike(vehiclesTable.trim, like),
    );
    if (search) conditions.push(search);
  }

  const vehicles = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(and(...conditions))
    .orderBy(desc(vehiclesTable.createdAt));

  const vehicleIds = vehicles.map((v) => v.id);
  const [images, allListings, allPerformance, allMarketplaceListings] = await Promise.all([
    imageInfo(vehicleIds),
    vehicleIds.length > 0
      ? db.select().from(listingsTable).where(inArray(listingsTable.vehicleId, vehicleIds))
      : Promise.resolve([]),
    vehicleIds.length > 0
      ? db
          .select()
          .from(listingPerformanceTable)
          .where(inArray(listingPerformanceTable.vehicleId, vehicleIds))
          .orderBy(desc(listingPerformanceTable.publishedAt))
      : Promise.resolve([]),
    vehicleIds.length > 0
      ? db
          .select()
          .from(marketplaceListingsTable)
          .where(inArray(marketplaceListingsTable.vehicleId, vehicleIds))
          .orderBy(desc(marketplaceListingsTable.publishedAt))
      : Promise.resolve([]),
  ]);

  const listingByVehicle = new Map(allListings.map((l) => [l.vehicleId, l]));
  const marketplaceListingByVehicle = new Map<number, (typeof allMarketplaceListings)[number]>();
  for (const ml of allMarketplaceListings) {
    if (!marketplaceListingByVehicle.has(ml.vehicleId)) marketplaceListingByVehicle.set(ml.vehicleId, ml);
  }
  const performanceByVehicle = new Map<number, (typeof allPerformance)[number]>();
  for (const p of allPerformance) {
    if (!performanceByVehicle.has(p.vehicleId)) performanceByVehicle.set(p.vehicleId, p);
  }

  const versions =
    vehicleIds.length > 0
      ? await db
          .select()
          .from(listingVersionsTable)
          .where(inArray(listingVersionsTable.vehicleId, vehicleIds))
      : [];

  const versionsByVehicle = new Map<number, ListingVersion[]>();
  for (const v of versions) {
    const list = versionsByVehicle.get(v.vehicleId) ?? [];
    list.push(v);
    versionsByVehicle.set(v.vehicleId, list);
  }

  const currentVersionIds = versions.filter((v) => v.isCurrent).map((v) => v.id);
  const scores = await latestScores(currentVersionIds);

  const jobs =
    vehicleIds.length > 0
      ? await db
          .select()
          .from(publishingJobsTable)
          .where(inArray(publishingJobsTable.vehicleId, vehicleIds))
          .orderBy(desc(publishingJobsTable.createdAt))
      : [];
  const latestJobByVehicle = new Map<number, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (!latestJobByVehicle.has(j.vehicleId)) latestJobByVehicle.set(j.vehicleId, j);
  }

  const now = new Date();

  const workspaces = vehicles.map((v) => {
    const img = images.get(v.id) ?? { primary: null, count: 0 };
    const vVersions = (versionsByVehicle.get(v.id) ?? []).sort((a, b) => b.version - a.version);
    const current = vVersions.find((x) => x.isCurrent) ?? null;
    const score = current ? (scores.get(current.id) ?? null) : null;
    const latestJob = latestJobByVehicle.get(v.id) ?? null;
    const listing = listingByVehicle.get(v.id) ?? null;
    const marketplaceListing = marketplaceListingByVehicle.get(v.id) ?? null;
    const isMarketplaceLive = marketplaceListing?.status === "Live";
    const hasPublishedListing = listing?.status === "Published";
    const latestJobHasLiveProof =
      latestJob?.status === "Published" &&
      Boolean(latestJob.listingUrl) &&
      (!marketplaceListing || marketplaceListing.status === "Live");
    const isPublishedFromSource = isMarketplaceLive || hasPublishedListing || latestJobHasLiveProof;
    const latestJobStatus =
      latestJob?.status === "Published" && !isPublishedFromSource
        ? marketplaceListing?.status ?? listing?.status ?? "Needs Review"
        : latestJob?.status;
    const perf = performanceByVehicle.get(v.id) ?? null;

    const aiStatus = vVersions.length > 0 ? "AI Generated" : "Not Started";
    const publishStatus = isPublishedFromSource
      ? "Published"
      : latestJobStatus
      ? latestJobStatus
      : current?.status === "Approved"
        ? "Approved"
        : "Not Queued";

    // Published-listing engagement
    const publishedAt = marketplaceListing?.publishedAt ?? listing?.publishedAt ?? perf?.publishedAt ?? null;
    const marketplaceUrl = marketplaceListing?.listingUrl ?? listing?.externalUrl ?? latestJob?.listingUrl ?? perf?.marketplaceUrl ?? null;
    const messageCount = perf?.conversationsCount ?? 0;
    const hotLeadCount = perf?.hotLeadsCount ?? 0;
    const appointmentReadyCount = perf?.appointmentReadyCount ?? 0;
    const leadCount = (perf?.hotLeadsCount ?? 0) + (perf?.warmLeadsCount ?? 0) + (perf?.coldLeadsCount ?? 0);
    const daysLive = publishedAt
      ? Math.max(0, (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const isPublished = publishStatus === "Published";
    const { engagementStatus, recommendation } = isPublished
      ? deriveEngagement(messageCount, leadCount, hotLeadCount, appointmentReadyCount, daysLive, v.status)
      : { engagementStatus: null, recommendation: null };

    return {
      vehicleId: v.id,
      dealerId: v.dealerId,
      label: `${v.year ?? ""} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`.trim(),
      vin: v.vin,
      year: v.year ?? null,
      make: v.make,
      model: v.model,
      trim: v.trim ?? null,
      bodyStyle: v.bodyStyle ?? null,
      price: v.price ?? null,
      primaryImageUrl: img.primary,
      imageCount: img.count,
      status: current?.status ?? "Draft",
      vehicleStatus: v.status,
      versionCount: vVersions.length,
      currentVersion: current?.version ?? null,
      aiStatus,
      publishStatus,
      priorityScore: priorityScore(v as Vehicle, img.count),
      listingScore: score?.overall ?? null,
      listingRating: score?.rating ?? null,
      updatedAt: current ? current.updatedAt.toISOString() : v.updatedAt.toISOString(),
      // Published lifecycle fields
      publishedAt: publishedAt ? publishedAt.toISOString() : null,
      marketplaceUrl,
      messageCount,
      leadCount,
      engagementStatus,
      recommendation,
      daysLive: Math.floor(daysLive),
      downPayment: current?.downPayment ?? null,
    };
  });

  // Filter by workspace status after derivation
  const filtered = status
    ? workspaces.filter((w) => {
        if (status === "needs-update")
          return w.publishStatus === "Published" && (w.vehicleStatus === "Price Changed");
        if (status === "sold")
          return w.publishStatus === "Published" && w.vehicleStatus === "Sold/Removed";
        return w.status === status || w.publishStatus === status;
      })
    : workspaces;

  res.json({ workspaces: filtered });
});

// GET /listings/:id — detail for one vehicle.
router.get("/listings/:id", async (req, res) => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const imgRows = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicleId))
    .orderBy(asc(vehicleImagesTable.position));
  const imageCount = imgRows.length;
  const primary = imgRows[0]?.url ?? null;

  const versions = await db
    .select()
    .from(listingVersionsTable)
    .where(eq(listingVersionsTable.vehicleId, vehicleId))
    .orderBy(desc(listingVersionsTable.version));

  const scores = await latestScores(versions.map((v) => v.id));

  const jobs = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.vehicleId, vehicleId))
    .orderBy(desc(publishingJobsTable.createdAt));

  const current = versions.find((v) => v.isCurrent) ?? null;

  res.json({
    vehicle: toVehicleSummary(vehicle, primary, imageCount),
    images: imgRows.map((im) => ({ id: im.id, url: im.url, position: im.position })),
    currentVersion: current ? toVersion(current, scores.get(current.id) ?? null) : null,
    versions: versions.map((v) => toVersion(v, scores.get(v.id) ?? null)),
    jobs: jobs.map((j) => ({
      id: j.id,
      listingVersionId: j.listingVersionId,
      vehicleId: j.vehicleId,
      dealerId: j.dealerId,
      status: j.status,
      priority: j.priority,
      scheduledAt: j.scheduledAt ? j.scheduledAt.toISOString() : null,
      claimedByExtension: j.claimedByExtension ?? null,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
      failedReason: j.failedReason ?? null,
      attempts: j.attempts,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      vehicleLabel: null,
      dealerName: null,
      listingTitle: null,
    })),
    priorityScore: priorityScore(vehicle as Vehicle, imageCount),
  });
});

// POST /listings/:vehicleId/mark-published — operator manually marks a listing live.
const MarkPublishedBody = z.object({
  marketplaceUrl: z
    .string()
    .url()
    .refine((url) => url.includes("/marketplace/item/"), {
      message: "A live Facebook Marketplace item URL is required",
    }),
  publishedByExtensionId: z.string().optional(),
});

router.post("/listings/:vehicleId/mark-published", async (req, res) => {
  const vehicleId = Number(req.params.vehicleId);
  if (isNaN(vehicleId)) {
    res.status(400).json({ error: "Invalid vehicle id" });
    return;
  }

  const parsed = MarkPublishedBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "A live Facebook Marketplace listing URL is required",
      issues: parsed.error.issues,
    });
    return;
  }

  const [vehicle] = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const now = new Date();
  const { marketplaceUrl, publishedByExtensionId } = parsed.data;

  await db
    .insert(listingsTable)
    .values({
      vehicleId,
      channel: "marketplace",
      status: "Published",
      externalUrl: marketplaceUrl ?? null,
      publishedAt: now,
      publishedByExtensionId: publishedByExtensionId ?? null,
    })
    .onConflictDoUpdate({
      target: [listingsTable.vehicleId, listingsTable.channel],
      set: {
        status: "Published",
        externalUrl: marketplaceUrl ?? undefined,
        publishedAt: now,
        publishedByExtensionId: publishedByExtensionId ?? undefined,
      },
    });

  // Flip vehicle status and upsert a completed publishing job
  await db
    .update(vehiclesTable)
    .set({ status: "Published" })
    .where(eq(vehiclesTable.id, vehicleId));

  // Mark the latest queued/scheduled job as Published if one exists
  const [latestJob] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.vehicleId, vehicleId),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
      ),
    )
    .orderBy(desc(publishingJobsTable.createdAt))
    .limit(1);

  if (latestJob) {
    await db
      .update(publishingJobsTable)
      .set({ status: "Published", completedAt: now })
      .where(eq(publishingJobsTable.id, latestJob.id));

    try {
      await compactFutureAutoPublishQueue({
        dealerId: latestJob.dealerId,
        completedBatchId: latestJob.batchId,
        now,
      });
    } catch (err) {
      // The operator's confirmed listing remains successful even if queue
      // maintenance needs a later retry.
      req.log.error({ err, vehicleId, jobId: latestJob.id }, "mark-published: failed to compact future auto-publish queue");
    }
  }

  req.log.info({ vehicleId, marketplaceUrl }, "Listing manually marked as published");
  res.status(200).json({ success: true, vehicleId, publishedAt: now.toISOString() });
});

// POST /listings/:id/generate — generate a brand-new version (never overwrites).
router.post("/listings/:id/generate", async (req, res) => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  let generated;
  try {
    generated = await generateListing(vehicle as Vehicle, await getDownPaymentPolicy(vehicle.dealerId, vehicle.id));
  } catch (err) {
    req.log.error({ err, vehicleId }, "AI listing generation failed");
    res.status(502).json({ error: "AI generation failed. Please try again." });
    return;
  }

  const imgRows = await db
    .select({ id: vehicleImagesTable.id })
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicleId));
  const imageCount = imgRows.length;

  const existing = await db
    .select()
    .from(listingVersionsTable)
    .where(eq(listingVersionsTable.vehicleId, vehicleId));
  const nextVersion =
    existing.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  const inserted = await db.transaction(async (tx) => {
    if (existing.length > 0) {
      await tx
        .update(listingVersionsTable)
        .set({ isCurrent: false })
        .where(eq(listingVersionsTable.vehicleId, vehicleId));
    }
    const [row] = await tx
      .insert(listingVersionsTable)
      .values({
        vehicleId,
        dealerId: vehicle.dealerId,
        version: nextVersion,
        title: generated.title,
        descriptionEn: generated.descriptionEn,
        descriptionEs: generated.descriptionEs,
        language: generated.language,
        askingPrice: generated.askingPrice,
        downPayment: generated.downPayment,
        callToAction: generated.callToAction,
        buyerProfile: generated.buyerProfile,
        copyAngle: generated.copyAngle,
        priority: generated.priority,
        status: "AI Generated",
        generatedBy: "ai",
        isCurrent: true,
      })
      .returning();
    return row;
  });

  const breakdown = scoreListing(inserted, vehicle as Vehicle, imageCount);
  const [scoreRow] = await db
    .insert(listingScoresTable)
    .values({
      listingVersionId: inserted.id,
      vehicleId,
      titleQuality: breakdown.titleQuality,
      descriptionQuality: breakdown.descriptionQuality,
      priceStrategy: breakdown.priceStrategy,
      downPaymentStrategy: breakdown.downPaymentStrategy,
      photoScore: breakdown.photoScore,
      overall: breakdown.overall,
      rating: breakdown.rating,
    })
    .returning();

  req.log.info(
    { vehicleId, version: nextVersion, score: breakdown.overall },
    "Generated listing version",
  );
  res.json(toVersion(inserted, scoreRow));
});

const UpdateBody = z.object({
  title: z.string().min(1).optional(),
  descriptionEn: z.string().optional(),
  descriptionEs: z.string().optional(),
  language: z.string().optional(),
  askingPrice: z.number().int().optional(),
  downPayment: z.number().int().optional(),
  callToAction: z.string().optional(),
  buyerProfile: z.string().optional(),
  priority: z.string().optional(),
});

// PATCH /listing-versions/:id — edit fields, recompute the score.
router.patch("/listing-versions/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing version fields" });
    return;
  }

  const [updated] = await db
    .update(listingVersionsTable)
    .set(parsed.data)
    .where(eq(listingVersionsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Listing version not found" });
    return;
  }

  const [vehicle] = await db
    .select(vehicleOperationalColumns)
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, updated.vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  const imgRows = await db
    .select({ id: vehicleImagesTable.id })
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, updated.vehicleId));
  const breakdown = scoreListing(updated, vehicle as Vehicle, imgRows.length);
  const [scoreRow] = await db
    .insert(listingScoresTable)
    .values({
      listingVersionId: updated.id,
      vehicleId: updated.vehicleId,
      titleQuality: breakdown.titleQuality,
      descriptionQuality: breakdown.descriptionQuality,
      priceStrategy: breakdown.priceStrategy,
      downPaymentStrategy: breakdown.downPaymentStrategy,
      photoScore: breakdown.photoScore,
      overall: breakdown.overall,
      rating: breakdown.rating,
    })
    .returning();

  res.json(toVersion(updated, scoreRow));
});

const StatusBody = z.object({ status: z.string().min(1) });
const ALLOWED_VERSION_STATUSES = new Set([
  "Draft",
  "AI Generated",
  "Ready for Review",
  "Approved",
]);

// PATCH /listing-versions/:id/status — move through the listing lifecycle.
router.patch("/listing-versions/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = StatusBody.safeParse(req.body);
  if (!parsed.success || !ALLOWED_VERSION_STATUSES.has(parsed.data.status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const [updated] = await db
    .update(listingVersionsTable)
    .set({ status: parsed.data.status })
    .where(eq(listingVersionsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Listing version not found" });
    return;
  }
  const scores = await latestScores([updated.id]);
  res.json(toVersion(updated, scores.get(updated.id) ?? null));
});

export default router;
