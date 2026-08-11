import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  pagePublishSettingsTable,
  pagePublishingBatchesTable,
  pagePublishingJobsTable,
  vehiclesTable,
} from "@workspace/db";
import { ensurePagesSchema } from "../pages/schema";
import { pagesPublishingWorker } from "../pages/pagesPublishing.worker";
import { runWorkerOnce } from "../workers/scheduler";
import { ALPHA_DEALER_ID } from "../lib/dealer";

const router: IRouter = Router();
const DEFAULT_DEALER_ID = ALPHA_DEALER_ID;
const OPEN_BATCH_STATUSES = ["Scheduled", "Active"];
const PAGE_JOB_STATUSES = ["Scheduled", "Queued", "Publishing", "Published", "Needs Review", "Failed"];

const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  vehiclesPerBatch: z.number().int().min(1).max(20).optional(),
  frequencyDays: z.number().int().min(1).max(30).optional(),
  preferredWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  preferredWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxPostsPerDay: z.number().int().min(1).max(50).optional(),
  minDelayMinutes: z.number().int().min(0).max(1440).optional(),
  requireApproval: z.boolean().optional(),
  useOriginalPhotos: z.boolean().optional(),
  aiCreativeIfLow: z.boolean().optional(),
  photoScoreThreshold: z.number().int().min(0).max(100).optional(),
});

function dealerIdFromParam(value: string | undefined): number | null {
  const dealerId = Number(value);
  return Number.isInteger(dealerId) && dealerId > 0 ? dealerId : null;
}

router.get("/pages/settings/:dealerId", async (req, res) => {
  const dealerId = dealerIdFromParam(req.params.dealerId);
  if (!dealerId) {
    res.status(400).json({ error: "Invalid dealerId" });
    return;
  }

  try {
    await ensurePagesSchema();
    const [settings] = await db
      .select()
      .from(pagePublishSettingsTable)
      .where(eq(pagePublishSettingsTable.dealerId, dealerId));
    res.json({ dealerId, configured: Boolean(settings), settings: settings ?? null });
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to load Pages settings");
    res.status(500).json({ error: "Failed to load Pages settings" });
  }
});

router.put("/pages/settings/:dealerId", async (req, res) => {
  const dealerId = dealerIdFromParam(req.params.dealerId);
  if (!dealerId) {
    res.status(400).json({ error: "Invalid dealerId" });
    return;
  }
  const parsed = settingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Pages settings", details: parsed.error.flatten() });
    return;
  }

  try {
    await ensurePagesSchema();
    const [settings] = await db
      .insert(pagePublishSettingsTable)
      .values({ dealerId, ...parsed.data })
      .onConflictDoUpdate({
        target: pagePublishSettingsTable.dealerId,
        set: { ...parsed.data, updatedAt: new Date() },
      })
      .returning();
    res.json({ dealerId, settings });
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to save Pages settings");
    res.status(500).json({ error: "Failed to save Pages settings" });
  }
});

router.get("/pages/batches/next", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEFAULT_DEALER_ID;
  if (!Number.isInteger(dealerId) || dealerId < 1) {
    res.status(400).json({ error: "dealerId must be a positive integer" });
    return;
  }

  try {
    await ensurePagesSchema();
    const [batch] = await db
      .select()
      .from(pagePublishingBatchesTable)
      .where(and(
        eq(pagePublishingBatchesTable.dealerId, dealerId),
        inArray(pagePublishingBatchesTable.status, OPEN_BATCH_STATUSES),
      ))
      .orderBy(asc(pagePublishingBatchesTable.scheduledAt), asc(pagePublishingBatchesTable.id))
      .limit(1);

    if (!batch) {
      res.json({ dealerId, batch: null, message: "No Pages batch is currently queued" });
      return;
    }

    const jobs = await db
      .select({
        id: pagePublishingJobsTable.id,
        vehicleId: pagePublishingJobsTable.vehicleId,
        status: pagePublishingJobsTable.status,
        currentStep: pagePublishingJobsTable.currentStep,
        scheduledAt: pagePublishingJobsTable.scheduledAt,
        metaPostId: pagePublishingJobsTable.metaPostId,
        postUrl: pagePublishingJobsTable.postUrl,
        failedReason: pagePublishingJobsTable.failedReason,
        year: vehiclesTable.year,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        trim: vehiclesTable.trim,
        price: vehiclesTable.price,
        stockNumber: vehiclesTable.stockNumber,
        vin: vehiclesTable.vin,
      })
      .from(pagePublishingJobsTable)
      .innerJoin(vehiclesTable, eq(pagePublishingJobsTable.vehicleId, vehiclesTable.id))
      .where(eq(pagePublishingJobsTable.batchId, batch.id))
      .orderBy(asc(pagePublishingJobsTable.scheduledAt), asc(pagePublishingJobsTable.id));

    res.json({
      dealerId,
      generatedAt: new Date().toISOString(),
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        status: batch.status,
        scheduledAt: batch.scheduledAt,
        totalVehicles: batch.totalVehicles,
        completedCount: batch.completedCount,
        failedCount: batch.failedCount,
        vehicles: jobs,
      },
    });
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to load next Pages batch");
    res.status(500).json({ error: "Failed to load next Pages batch" });
  }
});

router.get("/pages/batches", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEFAULT_DEALER_ID;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  if (!Number.isInteger(dealerId) || dealerId < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "dealerId must be positive and limit must be between 1 and 100" });
    return;
  }

  try {
    await ensurePagesSchema();
    const batches = await db
      .select()
      .from(pagePublishingBatchesTable)
      .where(eq(pagePublishingBatchesTable.dealerId, dealerId))
      .orderBy(desc(pagePublishingBatchesTable.batchNumber))
      .limit(limit);
    res.json({ dealerId, batches });
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to load Pages batches");
    res.status(500).json({ error: "Failed to load Pages batches" });
  }
});

router.get("/pages/batches/:batchId/jobs", async (req, res) => {
  const batchId = Number(req.params.batchId);
  if (!Number.isInteger(batchId) || batchId < 1) {
    res.status(400).json({ error: "Invalid batchId" });
    return;
  }

  try {
    await ensurePagesSchema();
    const jobs = await db
      .select()
      .from(pagePublishingJobsTable)
      .where(and(
        eq(pagePublishingJobsTable.batchId, batchId),
        inArray(pagePublishingJobsTable.status, PAGE_JOB_STATUSES),
      ))
      .orderBy(asc(pagePublishingJobsTable.scheduledAt), asc(pagePublishingJobsTable.id));
    res.json({ batchId, jobs });
  } catch (error) {
    req.log.error({ err: error, batchId }, "Failed to load Pages batch jobs");
    res.status(500).json({ error: "Failed to load Pages batch jobs" });
  }
});

router.post("/pages/worker/run", async (req, res) => {
  try {
    const outcome = await runWorkerOnce(pagesPublishingWorker, req.log, "manual", null);
    res.json({ worker: pagesPublishingWorker.id, outcome });
  } catch (error) {
    req.log.error({ err: error }, "Failed to run Pages worker");
    res.status(500).json({ error: "Failed to run Pages worker" });
  }
});

export default router;
