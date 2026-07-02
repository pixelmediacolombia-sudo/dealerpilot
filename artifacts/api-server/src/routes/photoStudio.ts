import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import {
  db,
  aiPhotoJobsTable,
  aiPhotoSetsTable,
  aiPhotoImagesTable,
  aiStudioPacksTable,
  vehiclesTable,
  vehicleImagesTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { computePhotoHash, hasChanged } from "../photo/changeDetection";


// ── Multer: background image upload ─────────────────────────────────────────
const bgUploadDir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos/backgrounds");
fs.mkdirSync(bgUploadDir, { recursive: true });
const bgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, bgUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `background-${Date.now()}${ext}`);
  },
});
const bgUpload = multer({
  storage: bgStorage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/image\/(jpeg|png|webp|tiff)/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, WebP, or TIFF images are accepted"));
  },
});

const router = Router();

// ── Queue list (all jobs, recent first) ─────────────────────────────────────
router.get("/photo-studio/jobs", async (req: Request, res: Response) => {
  try {
    const rawStatus = req.query["status"];
    const status: string | undefined = typeof rawStatus === "string" ? rawStatus : undefined;
    const limitN = Math.min(parseInt(req.query["limit"] as string || "50", 10) || 50, 200);
    const offsetN = parseInt(req.query["offset"] as string || "0", 10) || 0;

    const jobs = await db
      .select({
        id: aiPhotoJobsTable.id,
        vehicleId: aiPhotoJobsTable.vehicleId,
        dealerId: aiPhotoJobsTable.dealerId,
        status: aiPhotoJobsTable.status,
        priority: aiPhotoJobsTable.priority,
        attempts: aiPhotoJobsTable.attempts,
        totalPhotos: aiPhotoJobsTable.totalPhotos,
        processedPhotos: aiPhotoJobsTable.processedPhotos,
        failedPhotos: aiPhotoJobsTable.failedPhotos,
        currentStage: aiPhotoJobsTable.currentStage,
        progressPercent: aiPhotoJobsTable.progressPercent,
        outputSetId: aiPhotoJobsTable.outputSetId,
        modelVersion: aiPhotoJobsTable.modelVersion,
        startedAt: aiPhotoJobsTable.startedAt,
        completedAt: aiPhotoJobsTable.completedAt,
        failedReason: aiPhotoJobsTable.failedReason,
        createdAt: aiPhotoJobsTable.createdAt,
        // Per-set image breakdown (correlated subqueries on outputSetId)
        exteriorCount: sql<number>`coalesce((select count(*) from ai_photo_images where set_id = ${aiPhotoJobsTable.outputSetId} and is_exterior = 1), 0)`,
        interiorCount: sql<number>`coalesce((select count(*) from ai_photo_images where set_id = ${aiPhotoJobsTable.outputSetId} and is_exterior = 0 and classification != 'Miscellaneous'), 0)`,
        fallbackCount: sql<number>`coalesce((select count(*) from ai_photo_images where set_id = ${aiPhotoJobsTable.outputSetId} and used_fallback = 1), 0)`,
        // Vehicle fields
        vehicleYear: vehiclesTable.year,
        vehicleMake: vehiclesTable.make,
        vehicleModel: vehiclesTable.model,
        vehicleTrim: vehiclesTable.trim,
        vehicleVin: vehiclesTable.vin,
        vehicleStatus: vehiclesTable.status,
        vehicleAiStatus: vehiclesTable.aiPhotoStatus,
        vehicleThumbnailUrl: sql<string | null>`(select url from vehicle_images where vehicle_id = ${aiPhotoJobsTable.vehicleId} order by position asc limit 1)`,
      })
      .from(aiPhotoJobsTable)
      .leftJoin(vehiclesTable, eq(vehiclesTable.id, aiPhotoJobsTable.vehicleId))
      .where(and(status ? eq(aiPhotoJobsTable.status, status) : undefined))
      .orderBy(desc(aiPhotoJobsTable.createdAt))
      .limit(limitN)
      .offset(offsetN);

    res.json({ jobs, total: jobs.length });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/jobs failed");
    res.status(500).json({ error: "Failed to list photo jobs" });
  }
});

// ── Job detail (with processed images) ──────────────────────────────────────
router.get("/photo-studio/jobs/:id", async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    const [job] = await db
      .select()
      .from(aiPhotoJobsTable)
      .where(eq(aiPhotoJobsTable.id, jobId))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const images = job.outputSetId
      ? await db
          .select()
          .from(aiPhotoImagesTable)
          .where(eq(aiPhotoImagesTable.setId, job.outputSetId))
          .orderBy(asc(aiPhotoImagesTable.position))
      : [];

    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, job.vehicleId))
      .limit(1);

    res.json({ job, images, vehicle: vehicle ?? null });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/jobs/:id failed");
    res.status(500).json({ error: "Failed to get job detail" });
  }
});

// ── Manually trigger AI processing for a vehicle ────────────────────────────
router.post("/photo-studio/vehicles/:vehicleId/process", async (req: Request, res: Response) => {
  try {
    const vehicleId = Number(req.params.vehicleId);
    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }

    const images = await db
      .select({ url: vehicleImagesTable.url })
      .from(vehicleImagesTable)
      .where(eq(vehicleImagesTable.vehicleId, vehicleId))
      .orderBy(asc(vehicleImagesTable.position));

    if (images.length === 0) {
      res.status(422).json({ error: "Vehicle has no photos — cannot process" });
      return;
    }

    // Cancel any existing queued jobs for this vehicle
    await db
      .update(aiPhotoJobsTable)
      .set({ status: "Cancelled" })
      .where(
        and(
          eq(aiPhotoJobsTable.vehicleId, vehicleId),
          inArray(aiPhotoJobsTable.status, ["Queued"]),
        ),
      );

    const [defaultPack] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(
        and(eq(aiStudioPacksTable.dealerId, vehicle.dealerId), eq(aiStudioPacksTable.isDefault, true)),
      )
      .limit(1);

    const imageHash = computePhotoHash({
      photoUrls: images.map((i) => i.url),
      backgroundVersion: defaultPack?.backgroundVersion ?? "v1",
      modelVersion: "bria-rmbg-2.0",
      presetVersion: "v1",
    });

    const [job] = await db
      .insert(aiPhotoJobsTable)
      .values({
        vehicleId,
        dealerId: vehicle.dealerId,
        status: "Queued",
        imageHash,
        studioPackId: defaultPack?.id ?? null,
        studioVersion: defaultPack?.backgroundVersion ?? "v1",
        modelVersion: "bria-rmbg-2.0",
        presetVersion: "v1",
        priority: 1, // manual trigger = higher priority
      })
      .returning();

    await db
      .update(vehiclesTable)
      .set({ aiPhotoStatus: "Pending" })
      .where(eq(vehiclesTable.id, vehicleId));

    req.log.info({ jobId: job!.id, vehicleId }, "photo:manual trigger queued");
    res.status(201).json({ job });
  } catch (err) {
    req.log.error({ err }, "POST /photo-studio/vehicles/:vehicleId/process failed");
    res.status(500).json({ error: "Failed to enqueue photo job" });
  }
});

// ── Bulk enqueue: process all vehicles missing AI photos ─────────────────────
router.post("/photo-studio/enqueue-all", async (req: Request, res: Response) => {
  try {
    const { dealerId = 1 } = req.body as { dealerId?: number };

    // Find all active vehicles with images but no Ready AI set
    const vehicles = await db
      .select({ id: vehiclesTable.id, aiPhotoStatus: vehiclesTable.aiPhotoStatus })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.dealerId, dealerId),
          inArray(vehiclesTable.status, ["Active", "Ready to Publish", "New"]),
        ),
      );

    const [defaultPack] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(and(eq(aiStudioPacksTable.dealerId, dealerId), eq(aiStudioPacksTable.isDefault, true)))
      .limit(1);

    let enqueued = 0;
    let skipped = 0;

    // For Ready vehicles, check if their latest set's studioVersion is stale.
    // We load all latest sets in one query to avoid N+1 inside the loop.
    const currentVersion = defaultPack?.backgroundVersion ?? "v1";

    const readyVehicleIds = vehicles
      .filter((v) => v.aiPhotoStatus === "Ready")
      .map((v) => v.id);

    const latestSets =
      readyVehicleIds.length > 0
        ? await db
            .select({
              vehicleId: aiPhotoSetsTable.vehicleId,
              setId: aiPhotoSetsTable.id,
              studioVersion: aiPhotoSetsTable.studioVersion,
            })
            .from(aiPhotoSetsTable)
            .where(
              and(
                inArray(aiPhotoSetsTable.vehicleId, readyVehicleIds),
                eq(aiPhotoSetsTable.isLatest, true),
              ),
            )
        : [];

    const latestSetByVehicle = new Map(latestSets.map((s) => [s.vehicleId, s]));

    for (const v of vehicles) {
      // Always skip in-flight vehicles
      if (v.aiPhotoStatus === "Pending" || v.aiPhotoStatus === "Processing") {
        skipped++;
        continue;
      }

      // For Ready vehicles: skip if up-to-date, enqueue with sourceSetId if stale
      let sourceSetId: number | null = null;
      if (v.aiPhotoStatus === "Ready") {
        const latest = latestSetByVehicle.get(v.id);
        const setVersion = latest?.studioVersion ?? null;
        if (setVersion === currentVersion) {
          skipped++;
          continue;
        }
        // Stale background — re-composite only; Stages 1+2 will re-use prior results
        sourceSetId = latest?.setId ?? null;
      }

      const images = await db
        .select({ url: vehicleImagesTable.url })
        .from(vehicleImagesTable)
        .where(eq(vehicleImagesTable.vehicleId, v.id))
        .orderBy(asc(vehicleImagesTable.position));

      if (images.length === 0) { skipped++; continue; }

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
        studioPackId: defaultPack?.id ?? null,
        studioVersion: currentVersion,
        modelVersion: "bria-rmbg-2.0",
        presetVersion: "v1",
        priority: 0,
        ...(sourceSetId !== null ? { sourceSetId } : {}),
      });

      await db
        .update(vehiclesTable)
        .set({ aiPhotoStatus: "Pending" })
        .where(eq(vehiclesTable.id, v.id));

      enqueued++;
    }

    req.log.info({ enqueued, skipped, dealerId, currentVersion }, "photo:bulk enqueue");
    res.json({ enqueued, skipped, staleRequeued: enqueued });
  } catch (err) {
    req.log.error({ err }, "POST /photo-studio/enqueue-all failed");
    res.status(500).json({ error: "Failed to bulk enqueue" });
  }
});

// ── Stale vehicle count (background version changed) ─────────────────────────
// GET /api/photo-studio/stale-count
// Returns how many Ready vehicles have AI photos built with an older backgroundVersion
// than the current studio pack.  Used by the dashboard to show the reprocess banner.
router.get("/photo-studio/stale-count", async (req: Request, res: Response) => {
  try {
    const { dealerId = 1 } = req.query as { dealerId?: number };

    const [defaultPack] = await db
      .select({ backgroundVersion: aiStudioPacksTable.backgroundVersion })
      .from(aiStudioPacksTable)
      .where(and(eq(aiStudioPacksTable.dealerId, dealerId), eq(aiStudioPacksTable.isDefault, true)))
      .limit(1);

    const currentVersion = defaultPack?.backgroundVersion ?? "v1";

    // Find Ready vehicles whose latest set was built with a different (or null) studioVersion
    const stale = await db
      .select({ vehicleId: vehiclesTable.id })
      .from(vehiclesTable)
      .innerJoin(
        aiPhotoSetsTable,
        and(
          eq(aiPhotoSetsTable.vehicleId, vehiclesTable.id),
          eq(aiPhotoSetsTable.isLatest, true),
        ),
      )
      .where(
        and(
          eq(vehiclesTable.dealerId, dealerId),
          eq(vehiclesTable.aiPhotoStatus, "Ready"),
          or(
            isNull(aiPhotoSetsTable.studioVersion),
            ne(aiPhotoSetsTable.studioVersion, currentVersion),
          ),
        ),
      );

    res.json({ staleCount: stale.length, currentVersion });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/stale-count failed");
    res.status(500).json({ error: "Failed to get stale count" });
  }
});

// ── Reprocess stale vehicles (background changed) ────────────────────────────
// POST /api/photo-studio/reprocess-stale
// Finds all Ready vehicles whose AI photos were built with an older backgroundVersion
// and re-queues them using sourceSetId so Stages 1+2 (classify + bg-removal) are
// skipped — only compositing and later stages run, at zero extra OpenAI/Fal.ai cost.
router.post("/photo-studio/reprocess-stale", async (req: Request, res: Response) => {
  try {
    const { dealerId = 1 } = req.body as { dealerId?: number };

    const [defaultPack] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(and(eq(aiStudioPacksTable.dealerId, dealerId), eq(aiStudioPacksTable.isDefault, true)))
      .limit(1);

    if (!defaultPack?.backgroundUrl) {
      res.status(400).json({ error: "No studio background configured — upload the background first" });
      return;
    }

    const currentVersion = defaultPack.backgroundVersion ?? "v1";

    // Load all Ready vehicles with stale studioVersion in their latest set
    const staleRows = await db
      .select({
        vehicleId: vehiclesTable.id,
        setId: aiPhotoSetsTable.id,
        setStudioVersion: aiPhotoSetsTable.studioVersion,
      })
      .from(vehiclesTable)
      .innerJoin(
        aiPhotoSetsTable,
        and(
          eq(aiPhotoSetsTable.vehicleId, vehiclesTable.id),
          eq(aiPhotoSetsTable.isLatest, true),
        ),
      )
      .where(
        and(
          eq(vehiclesTable.dealerId, dealerId),
          eq(vehiclesTable.aiPhotoStatus, "Ready"),
          or(
            isNull(aiPhotoSetsTable.studioVersion),
            ne(aiPhotoSetsTable.studioVersion, currentVersion),
          ),
        ),
      );

    if (staleRows.length === 0) {
      res.json({ enqueued: 0, message: "All vehicles are up-to-date with the current background" });
      return;
    }

    let enqueued = 0;

    for (const row of staleRows) {
      // Load vehicle photos for the image hash
      const images = await db
        .select({ url: vehicleImagesTable.url })
        .from(vehicleImagesTable)
        .where(eq(vehicleImagesTable.vehicleId, row.vehicleId))
        .orderBy(asc(vehicleImagesTable.position));

      if (images.length === 0) continue;

      // Cancel any existing Queued jobs so we don't double-enqueue
      await db
        .update(aiPhotoJobsTable)
        .set({ status: "Cancelled" })
        .where(
          and(
            eq(aiPhotoJobsTable.vehicleId, row.vehicleId),
            eq(aiPhotoJobsTable.status, "Queued"),
          ),
        );

      const imageHash = computePhotoHash({
        photoUrls: images.map((i) => i.url),
        backgroundVersion: currentVersion,
        modelVersion: "bria-rmbg-2.0",
        presetVersion: "v1",
      });

      await db.insert(aiPhotoJobsTable).values({
        vehicleId: row.vehicleId,
        dealerId,
        status: "Queued",
        imageHash,
        studioPackId: defaultPack.id,
        studioVersion: currentVersion,
        modelVersion: "bria-rmbg-2.0",
        presetVersion: "v1",
        priority: 0,
        sourceSetId: row.setId,
      });

      await db
        .update(vehiclesTable)
        .set({ aiPhotoStatus: "Pending" })
        .where(eq(vehiclesTable.id, row.vehicleId));

      enqueued++;
    }

    req.log.info(
      { enqueued, dealerId, currentVersion },
      "photo:reprocess-stale queued",
    );
    res.json({ enqueued, currentVersion });
  } catch (err) {
    req.log.error({ err }, "POST /photo-studio/reprocess-stale failed");
    res.status(500).json({ error: "Failed to reprocess stale vehicles" });
  }
});

// ── Cancel a job ─────────────────────────────────────────────────────────────
router.delete("/photo-studio/jobs/:id", async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    const [job] = await db
      .update(aiPhotoJobsTable)
      .set({ status: "Cancelled" })
      .where(and(eq(aiPhotoJobsTable.id, jobId), eq(aiPhotoJobsTable.status, "Queued")))
      .returning();

    if (!job) {
      res.status(409).json({ error: "Job not found or not cancellable (only Queued jobs can be cancelled)" });
      return;
    }
    res.json({ cancelled: true, job });
  } catch (err) {
    req.log.error({ err }, "DELETE /photo-studio/jobs/:id failed");
    res.status(500).json({ error: "Failed to cancel job" });
  }
});

// ── AI Photo Sets for a vehicle ──────────────────────────────────────────────
router.get("/photo-studio/vehicles/:vehicleId/sets", async (req: Request, res: Response) => {
  try {
    const vehicleId = Number(req.params.vehicleId);
    const sets = await db
      .select()
      .from(aiPhotoSetsTable)
      .where(eq(aiPhotoSetsTable.vehicleId, vehicleId))
      .orderBy(desc(aiPhotoSetsTable.version));

    res.json({ sets });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/vehicles/:vehicleId/sets failed");
    res.status(500).json({ error: "Failed to list photo sets" });
  }
});

// ── Combined set + images for a vehicle (active/latest set) ──────────────────
// GET /photo-studio/sets/:vehicleId  — returns the latest set plus all images
// with summary stats and a marketplace-active flag.
router.get("/photo-studio/sets/:vehicleId", async (req: Request, res: Response) => {
  try {
    const vehicleId = Number(req.params.vehicleId);

    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);

    if (!vehicle) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }

    // Get the latest set for this vehicle
    const [set] = await db
      .select()
      .from(aiPhotoSetsTable)
      .where(and(eq(aiPhotoSetsTable.vehicleId, vehicleId), eq(aiPhotoSetsTable.isLatest, true)))
      .orderBy(desc(aiPhotoSetsTable.version))
      .limit(1);

    if (!set) {
      res.json({
        set: null,
        images: [],
        summary: null,
        vehicle: { id: vehicle.id, year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim, vin: vehicle.vin, aiPhotoStatus: vehicle.aiPhotoStatus },
        isActiveForMarketplace: false,
      });
      return;
    }

    const images = await db
      .select()
      .from(aiPhotoImagesTable)
      .where(eq(aiPhotoImagesTable.setId, set.id))
      .orderBy(asc(aiPhotoImagesTable.position));

    const exteriorCount = images.filter((i) => i.isExterior === 1).length;
    const interiorCount = images.filter((i) => i.isExterior === 0 && i.classification !== "Miscellaneous").length;
    const miscCount = images.filter((i) => i.classification === "Miscellaneous").length;
    const fallbackCount = images.filter((i) => i.usedFallback === 1).length;
    const compositedCount = images.filter((i) => i.compositedUrl && i.compositedUrl !== i.originalUrl).length;

    res.json({
      set,
      images,
      summary: { total: images.length, exteriorCount, interiorCount, miscCount, fallbackCount, compositedCount },
      vehicle: { id: vehicle.id, year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim, vin: vehicle.vin, aiPhotoStatus: vehicle.aiPhotoStatus },
      isActiveForMarketplace: vehicle.aiPhotoSetId === set.id,
    });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/sets/:vehicleId failed");
    res.status(500).json({ error: "Failed to get vehicle photo set" });
  }
});

// ── Images for a specific set ────────────────────────────────────────────────
router.get("/photo-studio/sets/:setId/images", async (req: Request, res: Response) => {
  try {
    const setId = Number(req.params.setId);
    const images = await db
      .select()
      .from(aiPhotoImagesTable)
      .where(eq(aiPhotoImagesTable.setId, setId))
      .orderBy(asc(aiPhotoImagesTable.position));

    res.json({ images });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/sets/:setId/images failed");
    res.status(500).json({ error: "Failed to list set images" });
  }
});

// ── Studio Packs ─────────────────────────────────────────────────────────────
router.get("/photo-studio/packs", async (req: Request, res: Response) => {
  try {
    const packs = await db
      .select()
      .from(aiStudioPacksTable)
      .where(eq(aiStudioPacksTable.isActive, true))
      .orderBy(desc(aiStudioPacksTable.isDefault), asc(aiStudioPacksTable.name));

    res.json({ packs });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/packs failed");
    res.status(500).json({ error: "Failed to list studio packs" });
  }
});

// ── Update a studio pack (background URL, lighting preset, etc.) ─────────────
router.patch("/photo-studio/packs/:id", async (req: Request, res: Response) => {
  try {
    const packId = Number(req.params.id);
    const { backgroundUrl, lightingPreset, vehicleScale, vehicleOffsetX, vehicleOffsetY, logoSafeZoneJson, placementMaskJson } =
      req.body as {
        backgroundUrl?: string;
        lightingPreset?: string;
        vehicleScale?: number;
        vehicleOffsetX?: number;
        vehicleOffsetY?: number;
        logoSafeZoneJson?: string;
        placementMaskJson?: string;
      };

    const [existing] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(eq(aiStudioPacksTable.id, packId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Pack not found" });
      return;
    }

    // If background changed, bump version so change detection triggers re-processing
    const bgChanged = backgroundUrl !== undefined && backgroundUrl !== existing.backgroundUrl;
    const currentVersion = existing.backgroundVersion ?? "v1";
    const nextVersion = bgChanged
      ? `v${parseInt(currentVersion.replace("v", ""), 10) + 1}`
      : currentVersion;

    const [updated] = await db
      .update(aiStudioPacksTable)
      .set({
        backgroundUrl: backgroundUrl ?? existing.backgroundUrl,
        backgroundVersion: nextVersion,
        lightingPreset: lightingPreset ?? existing.lightingPreset,
        vehicleScale: vehicleScale ?? existing.vehicleScale,
        vehicleOffsetX: vehicleOffsetX ?? existing.vehicleOffsetX,
        vehicleOffsetY: vehicleOffsetY ?? existing.vehicleOffsetY,
        logoSafeZoneJson: logoSafeZoneJson ?? existing.logoSafeZoneJson,
        placementMaskJson: placementMaskJson ?? existing.placementMaskJson,
      })
      .where(eq(aiStudioPacksTable.id, packId))
      .returning();

    req.log.info({ packId, bgChanged, nextVersion }, "photo:pack updated");
    res.json({ pack: updated });
  } catch (err) {
    req.log.error({ err }, "PATCH /photo-studio/packs/:id failed");
    res.status(500).json({ error: "Failed to update studio pack" });
  }
});

// ── Upload the official studio background ────────────────────────────────────
// POST /api/photo-studio/background
// Accepts multipart/form-data with a single "background" image field (≤ 30 MB).
// Analyzes with Sharp, builds logo safe zones + placement mask, saves to the
// default studio pack.  After upload, compositing is enabled for all future jobs.
router.post(
  "/photo-studio/background",
  bgUpload.single("background"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No background image file provided (field: background)" });
        return;
      }

      // Analyze uploaded image with Sharp
      const meta = await sharp(req.file.path).metadata();
      const bgWidth = meta.width ?? 1280;
      const bgHeight = meta.height ?? 720;

      // Auto-generate logo safe zones (0–1 relative coords):
      //   Alpha Motorsport logo is typically in the top strip of the background.
      //   Reserve the full top 15% of the frame so vehicles never overlap it.
      const logoSafeZones = [{ x: 0.0, y: 0.0, w: 1.0, h: 0.15, label: "top-logo-strip" }];

      // Placement mask: the area where vehicles should be composited.
      //   Center 85% of width, occupying the bottom 78% of height (below logo strip).
      // Placement mask for the compositing stage: { cx, bottomY, maxW }
      //   cx      — horizontal center (0–1 of bg width)
      //   bottomY — where the vehicle's wheel-line lands (0–1 from top)
      //   maxW    — max vehicle width as fraction of bg width
      // Default: center frame, bottom 5% margin, fill 60% of width.
      // Override per-upload based on the actual background's podium/floor geometry.
      const placementMask = { cx: 0.5, bottomY: 0.95, maxW: 0.60 };

      // Serve via /api/static/ai-photos/backgrounds/<filename>
      const servedUrl = `/api/static/ai-photos/backgrounds/${req.file.filename}`;

      // Bump background version (short timestamp token) to trigger re-processing
      const newVersion = `v${Date.now().toString(36)}`;

      // Update the default studio pack for dealer 1
      const [pack] = await db
        .select()
        .from(aiStudioPacksTable)
        .where(and(eq(aiStudioPacksTable.dealerId, 1), eq(aiStudioPacksTable.isDefault, true)))
        .limit(1);

      if (!pack) {
        res.status(500).json({ error: "No default studio pack found for dealer" });
        return;
      }

      const [updated] = await db
        .update(aiStudioPacksTable)
        .set({
          backgroundUrl: servedUrl,
          backgroundVersion: newVersion,
          backgroundWidth: bgWidth,
          backgroundHeight: bgHeight,
          logoSafeZoneJson: JSON.stringify(logoSafeZones),
          placementMaskJson: JSON.stringify(placementMask),
        })
        .where(eq(aiStudioPacksTable.id, pack.id))
        .returning();

      req.log.info(
        { packId: pack.id, url: servedUrl, width: bgWidth, height: bgHeight, version: newVersion },
        "photo:background uploaded — compositing now enabled",
      );

      // Serve the uploaded background file from the static mount
      res.json({
        pack: updated,
        setup: {
          backgroundConfigured: true,
          backgroundSource: "upload",
          compositingEnabled: true,
          backgroundWidth: bgWidth,
          backgroundHeight: bgHeight,
          logoSafeZones,
          placementMask,
        },
      });
    } catch (err) {
      req.log.error({ err }, "POST /photo-studio/background failed");
      res.status(500).json({ error: "Failed to upload background image" });
    }
  },
);

// ── Setup status ──────────────────────────────────────────────────────────────
// GET /api/photo-studio/setup-status
// Returns which pipeline stages are enabled/disabled and what is still missing.
router.get("/photo-studio/setup-status", async (req: Request, res: Response) => {
  try {
    const [defaultPack] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(and(eq(aiStudioPacksTable.dealerId, 1), eq(aiStudioPacksTable.isDefault, true)))
      .limit(1);

    const backgroundFromPack = defaultPack?.backgroundUrl ?? null;
    const backgroundFromEnv = process.env["AI_STUDIO_BACKGROUND"] ?? null;
    const backgroundUrl = backgroundFromPack ?? backgroundFromEnv;
    const backgroundSource = backgroundFromPack
      ? "upload"
      : backgroundFromEnv
        ? "env"
        : null;

    const falKey = !!process.env["FAL_KEY"];

    res.json({
      backgroundConfigured: !!backgroundUrl,
      backgroundSource,
      backgroundUrl: backgroundFromPack ?? null,
      backgroundWidth: defaultPack?.backgroundWidth ?? null,
      backgroundHeight: defaultPack?.backgroundHeight ?? null,
      logoSafeZones: defaultPack?.logoSafeZoneJson
        ? (JSON.parse(defaultPack.logoSafeZoneJson) as unknown)
        : null,
      placementMask: defaultPack?.placementMaskJson
        ? (JSON.parse(defaultPack.placementMaskJson) as unknown)
        : null,
      stages: {
        classify: { enabled: true, provider: "OpenAI GPT-5-mini vision" },
        removeBackground: { enabled: falKey, provider: falKey ? "fal.ai (BRIA RMBG 2.0)" : null },
        composite: {
          enabled: !!backgroundUrl,
          provider: backgroundUrl ? "Sharp.js" : null,
          blockedReason: backgroundUrl ? null : "Upload the Alpha Motorsport studio background to enable compositing.",
        },
        enhance: { enabled: true, provider: "Sharp.js" },
        validate: { enabled: true, provider: "built-in" },
        order: { enabled: true, provider: "built-in" },
        export: { enabled: true, provider: "built-in" },
      },
      readyForProduction: !!backgroundUrl,
    });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/setup-status failed");
    res.status(500).json({ error: "Failed to get setup status" });
  }
});

// ── Stats for the dashboard ──────────────────────────────────────────────────
router.get("/photo-studio/stats", async (req: Request, res: Response) => {
  try {
    const [statusCounts] = await db
      .select({
        queued: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Queued')`,
        processing: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Processing')`,
        completed: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Completed')`,
        failed: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Failed')`,
        cancelled: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Cancelled')`,
      })
      .from(aiPhotoJobsTable);

    const [vehicleCounts] = await db
      .select({
        ready: sql<number>`count(*) filter (where ${vehiclesTable.aiPhotoStatus} = 'Ready')`,
        processing: sql<number>`count(*) filter (where ${vehiclesTable.aiPhotoStatus} = 'Processing')`,
        pending: sql<number>`count(*) filter (where ${vehiclesTable.aiPhotoStatus} = 'Pending')`,
        failed: sql<number>`count(*) filter (where ${vehiclesTable.aiPhotoStatus} = 'Failed')`,
        total: sql<number>`count(*)`,
      })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.dealerId, 1));

    const [imageStats] = await db
      .select({
        total: count(aiPhotoImagesTable.id),
        withAI: sql<number>`count(*) filter (where ${aiPhotoImagesTable.processedUrl} is not null)`,
      })
      .from(aiPhotoImagesTable);

    // FAL.ai has no public balance API — estimate spend from processed image count.
    const [falUsageRow] = await db
      .select({
        imagesProcessed: sql<number>`count(*) filter (
          where ${aiPhotoImagesTable.removalProvider} = 'falai'
          and ${aiPhotoImagesTable.usedFallback} = 0
        )`,
      })
      .from(aiPhotoImagesTable);

    const falCostPerImageUsd = parseFloat(process.env["FAL_COST_PER_IMAGE_USD"] ?? "0.01");
    const falThresholdUsd = parseFloat(process.env["FAL_LOW_BALANCE_THRESHOLD_USD"] ?? "10");
    const falImagesProcessed = Number(falUsageRow?.imagesProcessed ?? 0);
    const falEstimatedSpendUsd = Math.round(falImagesProcessed * falCostPerImageUsd * 100) / 100;
    const falLowBalanceWarning = falEstimatedSpendUsd >= falThresholdUsd;

    const [defaultPack] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(and(eq(aiStudioPacksTable.dealerId, 1), eq(aiStudioPacksTable.isDefault, true)))
      .limit(1);

    const backgroundConfigured = !!(defaultPack?.backgroundUrl ?? process.env["AI_STUDIO_BACKGROUND"]);
    const backgroundSource = defaultPack?.backgroundUrl
      ? "upload"
      : process.env["AI_STUDIO_BACKGROUND"]
        ? "env"
        : null;
    const falKey = !!process.env["FAL_KEY"];
    const currentVersion = defaultPack?.backgroundVersion ?? "v1";

    // Count Ready vehicles with stale studioVersion (background changed since last process)
    const staleVehicles =
      backgroundConfigured && (vehicleCounts?.ready ?? 0) > 0
        ? await db
            .select({ vehicleId: vehiclesTable.id })
            .from(vehiclesTable)
            .innerJoin(
              aiPhotoSetsTable,
              and(
                eq(aiPhotoSetsTable.vehicleId, vehiclesTable.id),
                eq(aiPhotoSetsTable.isLatest, true),
              ),
            )
            .where(
              and(
                eq(vehiclesTable.dealerId, 1),
                eq(vehiclesTable.aiPhotoStatus, "Ready"),
                or(
                  isNull(aiPhotoSetsTable.studioVersion),
                  ne(aiPhotoSetsTable.studioVersion, currentVersion),
                ),
              ),
            )
        : [];

    const staleCount = staleVehicles.length;

    const processingMode = defaultPack?.processingMode ?? "enhance_only";
    const isEnhanceOnly = processingMode !== "studio";

    res.json({
      jobs: statusCounts ?? { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 },
      vehicles: vehicleCounts ?? { ready: 0, processing: 0, pending: 0, failed: 0, total: 0 },
      images: imageStats ?? { total: 0, withAI: 0 },
      staleCount,
      fal: {
        imagesProcessed: falImagesProcessed,
        estimatedSpendUsd: falEstimatedSpendUsd,
        lowBalanceWarning: falLowBalanceWarning,
        thresholdUsd: falThresholdUsd,
        costPerImageUsd: falCostPerImageUsd,
      },
      processingMode,
      defaultPack: defaultPack ?? null,
      setup: {
        backgroundConfigured,
        backgroundSource,
        // In enhance_only mode compositing is intentionally off — always ready for production
        compositingEnabled: !isEnhanceOnly && backgroundConfigured,
        backgroundWidth: defaultPack?.backgroundWidth ?? null,
        backgroundHeight: defaultPack?.backgroundHeight ?? null,
        readyForProduction: isEnhanceOnly ? true : backgroundConfigured,
      },
      providers: {
        backgroundRemoval: isEnhanceOnly ? "Disabled (enhancement only)" : (falKey ? "fal.ai (BRIA RMBG 2.0)" : "Not configured"),
        classification: "OpenAI GPT-5-mini vision",
        compositing: isEnhanceOnly ? "Disabled (original background preserved)" : (backgroundConfigured ? "Sharp.js" : "Disabled — background not uploaded"),
        enhancement: "Sharp.js",
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/stats failed");
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
