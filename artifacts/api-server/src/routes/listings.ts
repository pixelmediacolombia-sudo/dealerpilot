import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  listingVersionsTable,
  listingScoresTable,
  publishingJobsTable,
  type Vehicle,
  type ListingVersion,
  type ListingScore,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { generateListing } from "../listings/generator";
import { scoreListing } from "../listings/scoring";
import { priorityScore } from "../listings/rules";

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

function toVehicleSummary(v: Vehicle, primaryImageUrl: string | null, imageCount: number) {
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

// GET /listings — one workspace per vehicle.
router.get("/listings", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const conditions: SQL[] = [];
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
    .select()
    .from(vehiclesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(vehiclesTable.createdAt));

  const vehicleIds = vehicles.map((v) => v.id);
  const images = await imageInfo(vehicleIds);

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

  const workspaces = vehicles.map((v) => {
    const img = images.get(v.id) ?? { primary: null, count: 0 };
    const vVersions = (versionsByVehicle.get(v.id) ?? []).sort((a, b) => b.version - a.version);
    const current = vVersions.find((x) => x.isCurrent) ?? null;
    const score = current ? (scores.get(current.id) ?? null) : null;
    const latestJob = latestJobByVehicle.get(v.id) ?? null;

    const aiStatus = vVersions.length > 0 ? "AI Generated" : "Not Started";
    const publishStatus = latestJob
      ? latestJob.status
      : current?.status === "Approved"
        ? "Approved"
        : "Not Queued";

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
      versionCount: vVersions.length,
      currentVersion: current?.version ?? null,
      aiStatus,
      publishStatus,
      priorityScore: priorityScore(v, img.count),
      listingScore: score?.overall ?? null,
      listingRating: score?.rating ?? null,
      updatedAt: current ? current.updatedAt.toISOString() : v.updatedAt.toISOString(),
    };
  });

  // Filter by workspace status after derivation (status reflects the listing).
  const filtered = status
    ? workspaces.filter((w) => w.status === status || w.publishStatus === status)
    : workspaces;

  res.json({ workspaces: filtered });
});

// GET /listings/:id — detail for one vehicle.
router.get("/listings/:id", async (req, res) => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db
    .select()
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
    priorityScore: priorityScore(vehicle, imageCount),
  });
});

// POST /listings/:id/generate — generate a brand-new version (never overwrites).
router.post("/listings/:id/generate", async (req, res) => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  let generated;
  try {
    generated = await generateListing(vehicle);
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
        priority: generated.priority,
        status: "AI Generated",
        generatedBy: "ai",
        isCurrent: true,
      })
      .returning();
    return row;
  });

  const breakdown = scoreListing(inserted, vehicle, imageCount);
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
    .select()
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
  const breakdown = scoreListing(updated, vehicle, imgRows.length);
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
