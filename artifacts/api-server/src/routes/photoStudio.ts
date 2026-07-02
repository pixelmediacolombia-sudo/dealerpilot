import { Router, type Request, type Response } from "express";
import {
  db,
  aiPhotoJobsTable,
  aiPhotoSetsTable,
  aiPhotoImagesTable,
  aiStudioPacksTable,
  vehiclesTable,
  vehicleImagesTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { computePhotoHash, hasChanged } from "../photo/changeDetection";

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
        // Vehicle fields
        vehicleYear: vehiclesTable.year,
        vehicleMake: vehiclesTable.make,
        vehicleModel: vehiclesTable.model,
        vehicleTrim: vehiclesTable.trim,
        vehicleStatus: vehiclesTable.status,
        vehicleAiStatus: vehiclesTable.aiPhotoStatus,
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

    for (const v of vehicles) {
      if (v.aiPhotoStatus === "Ready" || v.aiPhotoStatus === "Pending" || v.aiPhotoStatus === "Processing") {
        skipped++;
        continue;
      }

      const images = await db
        .select({ url: vehicleImagesTable.url })
        .from(vehicleImagesTable)
        .where(eq(vehicleImagesTable.vehicleId, v.id))
        .orderBy(asc(vehicleImagesTable.position));

      if (images.length === 0) { skipped++; continue; }

      const imageHash = computePhotoHash({
        photoUrls: images.map((i) => i.url),
        backgroundVersion: defaultPack?.backgroundVersion ?? "v1",
        modelVersion: "bria-rmbg-2.0",
        presetVersion: "v1",
      });

      await db.insert(aiPhotoJobsTable).values({
        vehicleId: v.id,
        dealerId,
        status: "Queued",
        imageHash,
        studioPackId: defaultPack?.id ?? null,
        studioVersion: defaultPack?.backgroundVersion ?? "v1",
        modelVersion: "bria-rmbg-2.0",
        presetVersion: "v1",
        priority: 0,
      });

      await db
        .update(vehiclesTable)
        .set({ aiPhotoStatus: "Pending" })
        .where(eq(vehiclesTable.id, v.id));

      enqueued++;
    }

    req.log.info({ enqueued, skipped, dealerId }, "photo:bulk enqueue");
    res.json({ enqueued, skipped });
  } catch (err) {
    req.log.error({ err }, "POST /photo-studio/enqueue-all failed");
    res.status(500).json({ error: "Failed to bulk enqueue" });
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
    const { backgroundUrl, lightingPreset, vehicleScale, vehicleOffsetX, vehicleOffsetY, logoSafeZoneJson } =
      req.body as {
        backgroundUrl?: string;
        lightingPreset?: string;
        vehicleScale?: number;
        vehicleOffsetX?: number;
        vehicleOffsetY?: number;
        logoSafeZoneJson?: string;
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

    const [avgTime] = await db
      .select({
        avgMs: sql<number>`avg(${aiPhotoJobsTable.completedAt}::timestamp - ${aiPhotoJobsTable.startedAt}::timestamp)`,
      })
      .from(aiPhotoJobsTable)
      .where(eq(aiPhotoJobsTable.status, "Completed"));

    const [imageStats] = await db
      .select({
        total: count(aiPhotoImagesTable.id),
        withAI: sql<number>`count(*) filter (where ${aiPhotoImagesTable.processedUrl} is not null)`,
      })
      .from(aiPhotoImagesTable);

    const [defaultPack] = await db
      .select()
      .from(aiStudioPacksTable)
      .where(and(eq(aiStudioPacksTable.dealerId, 1), eq(aiStudioPacksTable.isDefault, true)))
      .limit(1);

    res.json({
      jobs: statusCounts ?? { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 },
      vehicles: vehicleCounts ?? { ready: 0, processing: 0, pending: 0, failed: 0, total: 0 },
      images: imageStats ?? { total: 0, withAI: 0 },
      defaultPack: defaultPack ?? null,
      providers: {
        backgroundRemoval: process.env["FAL_KEY"] ? "fal.ai (BRIA RMBG 2.0)" : "Not configured",
        classification: "OpenAI GPT-5-mini vision",
        compositing: "Sharp.js",
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /photo-studio/stats failed");
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
