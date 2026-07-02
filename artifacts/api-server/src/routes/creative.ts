import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  dealersTable,
  dealerBrandDnaTable,
  creativeTemplatesTable,
  creativeVersionsTable,
  creativeScoresTable,
  creativeJobsTable,
  type Vehicle,
  type DealerBrandDna,
  type CreativeTemplate,
  type CreativeVersion,
  type CreativeScore,
  type CreativeJob,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";

const DEALER_ID = 1;

const router: IRouter = Router();

// Parse a positive-integer route param, returning null for anything else so
// callers can respond with a controlled 400 instead of leaking a DB error.
function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function vehicleLabel(v: Pick<Vehicle, "year" | "make" | "model" | "trim">): string {
  return `${v.year ?? ""} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`.trim();
}

function toScore(s: CreativeScore) {
  return {
    id: s.id,
    creativeVersionId: s.creativeVersionId,
    vehicleId: s.vehicleId,
    brandConsistency: s.brandConsistency,
    vehicleVisibility: s.vehicleVisibility,
    lighting: s.lighting,
    composition: s.composition,
    ctrPrediction: s.ctrPrediction,
    overall: s.overall,
    rating: s.rating,
    createdAt: s.createdAt.toISOString(),
  };
}

function toVersion(v: CreativeVersion, score: CreativeScore | null) {
  return {
    id: v.id,
    vehicleId: v.vehicleId,
    dealerId: v.dealerId,
    version: v.version,
    templateKey: v.templateKey,
    brandStyle: v.brandStyle,
    backgroundStyle: v.backgroundStyle,
    status: v.status,
    isDefault: v.isDefault,
    renderSpec: v.renderSpec,
    outputs: v.outputs,
    score: score ? toScore(score) : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function toJob(j: CreativeJob, label: string | null) {
  return {
    id: j.id,
    vehicleId: j.vehicleId,
    dealerId: j.dealerId,
    templateKey: j.templateKey,
    status: j.status,
    step: j.step ?? null,
    progress: j.progress,
    creativeVersionId: j.creativeVersionId ?? null,
    failedReason: j.failedReason ?? null,
    attempts: j.attempts,
    startedAt: j.startedAt ? j.startedAt.toISOString() : null,
    completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    vehicleLabel: label,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

function toTemplate(t: CreativeTemplate) {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description ?? null,
    category: t.category,
    recommendedBrandStyle: t.recommendedBrandStyle ?? null,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
  };
}

function toDna(d: DealerBrandDna) {
  return {
    id: d.id,
    dealerId: d.dealerId,
    primaryColors: d.primaryColors,
    secondaryColors: d.secondaryColors,
    accentColors: d.accentColors,
    logoUrl: d.logoUrl ?? null,
    preferredFont: d.preferredFont,
    brandStyle: d.brandStyle,
    backgroundStyle: d.backgroundStyle,
    defaultTemplateKey: d.defaultTemplateKey,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
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
    bodyStyle: v.bodyStyle ?? null,
    fuelType: v.fuelType ?? null,
    status: v.status,
    primaryImageUrl,
    imageCount,
  };
}

// Latest score per creative version id.
async function latestScores(versionIds: number[]): Promise<Map<number, CreativeScore>> {
  const map = new Map<number, CreativeScore>();
  if (versionIds.length === 0) return map;
  const rows = await db
    .select()
    .from(creativeScoresTable)
    .where(inArray(creativeScoresTable.creativeVersionId, versionIds))
    .orderBy(desc(creativeScoresTable.createdAt));
  for (const r of rows) {
    if (!map.has(r.creativeVersionId)) map.set(r.creativeVersionId, r);
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

// GET /creative/studio — one creative workspace per vehicle.
router.get("/creative/studio", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const conditions: SQL[] = [eq(vehiclesTable.dealerId, DEALER_ID)];
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
    .where(and(...conditions))
    .orderBy(desc(vehiclesTable.createdAt));

  const vehicleIds = vehicles.map((v) => v.id);
  const images = await imageInfo(vehicleIds);

  const versions =
    vehicleIds.length > 0
      ? await db
          .select()
          .from(creativeVersionsTable)
          .where(inArray(creativeVersionsTable.vehicleId, vehicleIds))
      : [];
  const versionsByVehicle = new Map<number, CreativeVersion[]>();
  for (const v of versions) {
    const list = versionsByVehicle.get(v.vehicleId) ?? [];
    list.push(v);
    versionsByVehicle.set(v.vehicleId, list);
  }

  const scores = await latestScores(versions.map((v) => v.id));

  const jobs =
    vehicleIds.length > 0
      ? await db
          .select()
          .from(creativeJobsTable)
          .where(inArray(creativeJobsTable.vehicleId, vehicleIds))
          .orderBy(desc(creativeJobsTable.createdAt))
      : [];
  const latestJobByVehicle = new Map<number, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (!latestJobByVehicle.has(j.vehicleId)) latestJobByVehicle.set(j.vehicleId, j);
  }

  const items = vehicles.map((v) => {
    const img = images.get(v.id) ?? { primary: null, count: 0 };
    const vVersions = (versionsByVehicle.get(v.id) ?? []).sort((a, b) => b.version - a.version);
    const scoreVersion = vVersions.find((x) => x.isDefault) ?? vVersions[0] ?? null;
    const score = scoreVersion ? (scores.get(scoreVersion.id) ?? null) : null;
    const latestJob = latestJobByVehicle.get(v.id) ?? null;
    const activeJob =
      latestJob && (latestJob.status === "Queued" || latestJob.status === "Generating")
        ? latestJob
        : null;

    const creativeStatus = activeJob
      ? activeJob.status
      : vVersions.some((x) => x.status === "Approved")
        ? "Approved"
        : vVersions.length > 0
          ? "Generated"
          : "None";

    return {
      vehicleId: v.id,
      dealerId: v.dealerId,
      label: vehicleLabel(v),
      vin: v.vin,
      year: v.year ?? null,
      make: v.make,
      model: v.model,
      trim: v.trim ?? null,
      bodyStyle: v.bodyStyle ?? null,
      price: v.price ?? null,
      primaryImageUrl: img.primary,
      imageCount: img.count,
      creativeStatus,
      versionCount: vVersions.length,
      latestVersion: vVersions[0]?.version ?? null,
      defaultVersionId: vVersions.find((x) => x.isDefault)?.id ?? null,
      creativeScore: score?.overall ?? null,
      creativeRating: score?.rating ?? null,
      activeJobId: activeJob?.id ?? null,
      activeJobStatus: activeJob?.status ?? null,
      activeJobStep: activeJob?.step ?? null,
      activeJobProgress: activeJob?.progress ?? null,
      updatedAt: vVersions[0]
        ? vVersions[0].updatedAt.toISOString()
        : v.updatedAt.toISOString(),
    };
  });

  const filtered = status ? items.filter((i) => i.creativeStatus === status) : items;
  res.json({ vehicles: filtered });
});

// GET /creative/vehicles/:id — creative detail for one vehicle.
router.get("/creative/vehicles/:id", async (req, res) => {
  const vehicleId = parseId(req.params.id);
  if (vehicleId === null) {
    res.status(400).json({ error: "Invalid vehicle id" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const imgRows = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, vehicleId))
    .orderBy(asc(vehicleImagesTable.position));

  const versions = await db
    .select()
    .from(creativeVersionsTable)
    .where(eq(creativeVersionsTable.vehicleId, vehicleId))
    .orderBy(desc(creativeVersionsTable.version));
  const scores = await latestScores(versions.map((v) => v.id));

  const jobs = await db
    .select()
    .from(creativeJobsTable)
    .where(eq(creativeJobsTable.vehicleId, vehicleId))
    .orderBy(desc(creativeJobsTable.createdAt));

  const defaultVersion = versions.find((v) => v.isDefault) ?? null;

  res.json({
    vehicle: toVehicleSummary(vehicle, imgRows[0]?.url ?? null, imgRows.length),
    images: imgRows.map((im) => ({ id: im.id, url: im.url, position: im.position })),
    versions: versions.map((v) => toVersion(v, scores.get(v.id) ?? null)),
    defaultVersion: defaultVersion
      ? toVersion(defaultVersion, scores.get(defaultVersion.id) ?? null)
      : null,
    jobs: jobs.map((j) => toJob(j, vehicleLabel(vehicle))),
  });
});

const BulkGenerateBody = z.object({
  vehicleIds: z.array(z.number().int().positive()).min(1).max(100),
  templateKey: z.string().min(1).optional(),
});

// POST /creative/bulk-generate — enqueue creative jobs for multiple vehicles.
router.post("/creative/bulk-generate", async (req, res) => {
  const parsed = BulkGenerateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bulk-generate request" });
    return;
  }
  const { vehicleIds, templateKey: reqTemplateKey } = parsed.data;

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds));

  if (vehicles.length === 0) {
    res.status(404).json({ error: "No matching vehicles found" });
    return;
  }

  const dealerId = vehicles[0]!.dealerId;
  const [dna] = await db
    .select()
    .from(dealerBrandDnaTable)
    .where(eq(dealerBrandDnaTable.dealerId, dealerId));
  const defaultTemplateKey = dna?.defaultTemplateKey ?? "marketplace-premium";

  const templates = await db
    .select()
    .from(creativeTemplatesTable)
    .where(eq(creativeTemplatesTable.isActive, true));
  const validKeys = new Set(templates.map((t) => t.key));

  const resolvedKey = reqTemplateKey && validKeys.has(reqTemplateKey) ? reqTemplateKey : defaultTemplateKey;
  if (!validKeys.has(resolvedKey)) {
    res.status(400).json({ error: "No active templates found" });
    return;
  }

  const enqueued: ReturnType<typeof toJob>[] = [];
  for (const vehicle of vehicles) {
    const [job] = await db
      .insert(creativeJobsTable)
      .values({
        vehicleId: vehicle.id,
        dealerId: vehicle.dealerId,
        templateKey: resolvedKey,
        status: "Queued",
        progress: 0,
      })
      .returning();
    enqueued.push(toJob(job!, vehicleLabel(vehicle)));
  }

  const skipped = vehicleIds.length - vehicles.length;
  req.log.info({ count: enqueued.length, skipped, templateKey: resolvedKey }, "Bulk creative jobs enqueued");
  res.status(202).json({ enqueued: enqueued.length, skipped, jobs: enqueued });
});

const GenerateBody = z.object({ templateKey: z.string().min(1).optional() });

// POST /creative/vehicles/:id/generate — enqueue a background creative job.
router.post("/creative/vehicles/:id/generate", async (req, res) => {
  const vehicleId = parseId(req.params.id);
  if (vehicleId === null) {
    res.status(400).json({ error: "Invalid vehicle id" });
    return;
  }
  const parsed = GenerateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const [dna] = await db
    .select()
    .from(dealerBrandDnaTable)
    .where(eq(dealerBrandDnaTable.dealerId, vehicle.dealerId));
  const templateKey =
    parsed.data.templateKey ?? dna?.defaultTemplateKey ?? "marketplace-premium";

  const [template] = await db
    .select()
    .from(creativeTemplatesTable)
    .where(eq(creativeTemplatesTable.key, templateKey));
  if (!template || !template.isActive) {
    res.status(400).json({ error: "Invalid or inactive template" });
    return;
  }

  const [job] = await db
    .insert(creativeJobsTable)
    .values({
      vehicleId,
      dealerId: vehicle.dealerId,
      templateKey,
      status: "Queued",
      progress: 0,
    })
    .returning();

  req.log.info({ vehicleId, jobId: job!.id, templateKey }, "Enqueued creative job");
  res.status(202).json(toJob(job!, vehicleLabel(vehicle)));
});

// GET /creative/jobs — the creative generation queue.
router.get("/creative/jobs", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const jobs = await db
    .select()
    .from(creativeJobsTable)
    .where(status ? eq(creativeJobsTable.status, status) : undefined)
    .orderBy(desc(creativeJobsTable.createdAt));

  const vehicleIds = [...new Set(jobs.map((j) => j.vehicleId))];
  const labels = new Map<number, string>();
  if (vehicleIds.length > 0) {
    const rows = await db
      .select()
      .from(vehiclesTable)
      .where(inArray(vehiclesTable.id, vehicleIds));
    for (const v of rows) labels.set(v.id, vehicleLabel(v));
  }

  res.json({ jobs: jobs.map((j) => toJob(j, labels.get(j.vehicleId) ?? null)) });
});

// GET /creative/templates — active template catalog.
router.get("/creative/templates", async (_req, res) => {
  const templates = await db
    .select()
    .from(creativeTemplatesTable)
    .where(eq(creativeTemplatesTable.isActive, true))
    .orderBy(asc(creativeTemplatesTable.sortOrder));
  res.json({ templates: templates.map(toTemplate) });
});

// POST /creative/versions/:id/approve — approve a creative version.
router.post("/creative/versions/:id/approve", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid version id" });
    return;
  }
  const [updated] = await db
    .update(creativeVersionsTable)
    .set({ status: "Approved" })
    .where(eq(creativeVersionsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Creative version not found" });
    return;
  }
  const scores = await latestScores([updated.id]);
  res.json(toVersion(updated, scores.get(updated.id) ?? null));
});

// POST /creative/versions/:id/default — mark a version as the vehicle default.
router.post("/creative/versions/:id/default", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid version id" });
    return;
  }
  const [target] = await db
    .select()
    .from(creativeVersionsTable)
    .where(eq(creativeVersionsTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Creative version not found" });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    await tx
      .update(creativeVersionsTable)
      .set({ isDefault: false })
      .where(eq(creativeVersionsTable.vehicleId, target.vehicleId));
    const [row] = await tx
      .update(creativeVersionsTable)
      .set({ isDefault: true })
      .where(eq(creativeVersionsTable.id, id))
      .returning();
    return row!;
  });

  const scores = await latestScores([updated.id]);
  res.json(toVersion(updated, scores.get(updated.id) ?? null));
});

// GET /creative/dna/:dealerId — dealer Brand DNA.
router.get("/creative/dna/:dealerId", async (req, res) => {
  const dealerId = parseId(req.params.dealerId);
  if (dealerId === null) {
    res.status(400).json({ error: "Invalid dealer id" });
    return;
  }
  const [dna] = await db
    .select()
    .from(dealerBrandDnaTable)
    .where(eq(dealerBrandDnaTable.dealerId, dealerId));
  if (!dna) {
    res.status(404).json({ error: "Brand DNA not found" });
    return;
  }
  res.json(toDna(dna));
});

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, "Invalid hex color");
const DnaBody = z.object({
  primaryColors: z.array(hexColor).optional(),
  secondaryColors: z.array(hexColor).optional(),
  accentColors: z.array(hexColor).optional(),
  logoUrl: z.string().nullable().optional(),
  preferredFont: z.string().min(1).optional(),
  brandStyle: z.string().min(1).optional(),
  backgroundStyle: z.string().min(1).optional(),
  defaultTemplateKey: z.string().min(1).optional(),
});

// PUT /creative/dna/:dealerId — create or update dealer Brand DNA.
router.put("/creative/dna/:dealerId", async (req, res) => {
  const dealerId = parseId(req.params.dealerId);
  if (dealerId === null) {
    res.status(400).json({ error: "Invalid dealer id" });
    return;
  }
  const parsed = DnaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Brand DNA fields" });
    return;
  }

  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }

  const [row] = await db
    .insert(dealerBrandDnaTable)
    .values({ dealerId, ...parsed.data })
    .onConflictDoUpdate({
      target: dealerBrandDnaTable.dealerId,
      set: { ...parsed.data },
    })
    .returning();

  res.json(toDna(row!));
});

export default router;
