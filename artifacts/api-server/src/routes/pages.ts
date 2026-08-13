import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  pagePublishSettingsTable,
  pagePublishingBatchesTable,
  pagePublishingJobsTable,
  listingsTable,
  vehiclesTable,
} from "@workspace/db";
import { ensurePagesSchema } from "../pages/schema";
import { createImmediatePagesBatch, pagesPublishingWorker, previewNextPagesBatch, reconcilePagesBatchProgress } from "../pages/pagesPublishing.worker";
import { getMetaPageConnection, getMetaPageConnectionSummary, ensureLegacyAlphaMetaConnection, persistValidatedMetaPageConnection, readBootstrapMetaPageConfig, recordMetaPageValidation } from "../pages/metaPageConnections";
import { validateMetaPageConnection } from "../pages/metaPagesPublisher";
import { runWorkerOnce } from "../workers/scheduler";
import { ALPHA_DEALER_ID } from "../lib/dealer";
import { requireAuthenticatedUser } from "./auth";

const router: IRouter = Router();
const DEFAULT_DEALER_ID = ALPHA_DEALER_ID;
const OPEN_BATCH_STATUSES = ["Scheduled", "Active"];
const PAGE_JOB_STATUSES = ["Scheduled", "Queued", "Publishing", "Published", "Needs Review", "Failed"];

router.use(requireAuthenticatedUser);

function hasDealerAccess(res: Response, dealerId: number): boolean {
  const user = res.locals.authUser as { dealerId?: number } | undefined;
  if (!user || user.dealerId !== dealerId) {
    res.status(403).json({ error: "Dealer access denied" });
    return false;
  }
  return true;
}

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
  if (!hasDealerAccess(res, dealerId)) return;

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
  if (!hasDealerAccess(res, dealerId)) return;
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
  if (!hasDealerAccess(res, dealerId)) return;

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

router.get("/pages/batches/preview", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEFAULT_DEALER_ID;
  if (!Number.isInteger(dealerId) || dealerId < 1) {
    res.status(400).json({ error: "dealerId must be a positive integer" });
    return;
  }
  if (!hasDealerAccess(res, dealerId)) return;

  try {
    await ensurePagesSchema();
    const preview = await previewNextPagesBatch(dealerId);
    res.json(preview);
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to preview next Pages batch");
    res.status(500).json({ error: "Failed to preview next Pages batch" });
  }
});

router.post("/pages/publish-now", async (req, res) => {
  const user = res.locals.authUser as { role?: string } | undefined;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  const dealerId = typeof req.body?.dealerId === "number" ? req.body.dealerId : DEFAULT_DEALER_ID;
  const requestedVehicleId = req.body?.vehicleId == null ? null : Number(req.body.vehicleId);
  if (!Number.isInteger(dealerId) || dealerId < 1 || (requestedVehicleId !== null && (!Number.isInteger(requestedVehicleId) || requestedVehicleId < 1))) {
    res.status(400).json({ error: "Invalid dealerId or vehicleId" });
    return;
  }
  if (!hasDealerAccess(res, dealerId)) return;

  try {
    await ensurePagesSchema();
    const created = await createImmediatePagesBatch(dealerId, requestedVehicleId);
    if (!created.created) {
      const alreadyQueued = "alreadyQueued" in created && created.alreadyQueued;
      res.status(alreadyQueued ? 409 : 422).json({
        ...created,
        error: alreadyQueued ? "This vehicle already has an active Pages publishing job" : created.reason,
      });
      return;
    }
    const outcome = await runWorkerOnce(pagesPublishingWorker, req.log, "manual", null);
    if (outcome.summary.includes("needs review") || outcome.summary.startsWith("Failed:")) {
      res.status(422).json({ ...created, worker: pagesPublishingWorker.id, outcome, error: outcome.summary });
      return;
    }
    res.json({ ...created, worker: pagesPublishingWorker.id, outcome });
  } catch (error) {
    req.log.error({ err: error, dealerId, vehicleId: requestedVehicleId }, "Failed to publish Page vehicle now");
    res.status(500).json({ error: "Failed to publish Page vehicle now" });
  }
});

router.post("/pages/jobs/:jobId/mark-post-removed", async (req, res) => {
  const user = res.locals.authUser as { role?: string } | undefined;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId < 1) {
    res.status(400).json({ error: "Invalid Pages job id" });
    return;
  }

  try {
    await ensurePagesSchema();
    const [job] = await db
      .select()
      .from(pagePublishingJobsTable)
      .where(eq(pagePublishingJobsTable.id, jobId))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Pages job not found" });
      return;
    }
    if (!hasDealerAccess(res, job.dealerId)) return;
    if (job.status !== "Published") {
      res.status(409).json({ error: "Only a published Pages job can be marked as removed" });
      return;
    }

    const now = new Date();
    const removalReason = "Post removed from Facebook Page by operator";
    await db.transaction(async (tx) => {
      await tx
        .update(pagePublishingJobsTable)
        .set({
          status: "Needs Review",
          currentStep: "Post removed from Facebook Page",
          failedReason: removalReason,
          completedAt: null,
          metaPostId: null,
          postUrl: null,
          updatedAt: now,
        })
        .where(eq(pagePublishingJobsTable.id, job.id));
      await tx
        .update(listingsTable)
        .set({
          status: "Needs Review",
          externalId: null,
          externalUrl: null,
          publishedAt: null,
        })
        .where(and(
          eq(listingsTable.vehicleId, job.vehicleId),
          eq(listingsTable.channel, "facebook_page"),
        ));
    });
    await reconcilePagesBatchProgress(job.batchId, now);
    req.log.info({ jobId: job.id, vehicleId: job.vehicleId }, "Pages post marked as removed by operator");
    res.json({
      ok: true,
      jobId: job.id,
      status: "Needs Review",
      currentStep: "Post removed from Facebook Page",
    });
  } catch (error) {
    req.log.error({ err: error, jobId }, "Failed to mark Pages post as removed");
    res.status(500).json({ error: "Failed to mark Pages post as removed" });
  }
});

router.get("/pages/batches", async (req, res) => {
  const dealerId = typeof req.query.dealerId === "string" ? Number(req.query.dealerId) : DEFAULT_DEALER_ID;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  if (!Number.isInteger(dealerId) || dealerId < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "dealerId must be positive and limit must be between 1 and 100" });
    return;
  }
  if (!hasDealerAccess(res, dealerId)) return;

  try {
    await ensurePagesSchema();
    const batches = await db
      .select()
      .from(pagePublishingBatchesTable)
      .where(eq(pagePublishingBatchesTable.dealerId, dealerId))
      .orderBy(desc(pagePublishingBatchesTable.batchNumber))
      .limit(limit);
    const batchIds = batches.map((batch) => batch.id);
    const jobs = batchIds.length
      ? await db
        .select({
          id: pagePublishingJobsTable.id,
          batchId: pagePublishingJobsTable.batchId,
          vehicleId: pagePublishingJobsTable.vehicleId,
          status: pagePublishingJobsTable.status,
          currentStep: pagePublishingJobsTable.currentStep,
          scheduledAt: pagePublishingJobsTable.scheduledAt,
          startedAt: pagePublishingJobsTable.startedAt,
          completedAt: pagePublishingJobsTable.completedAt,
          metaPostId: pagePublishingJobsTable.metaPostId,
          postUrl: pagePublishingJobsTable.postUrl,
          failedReason: pagePublishingJobsTable.failedReason,
          attempts: pagePublishingJobsTable.attempts,
          year: vehiclesTable.year,
          make: vehiclesTable.make,
          model: vehiclesTable.model,
          trim: vehiclesTable.trim,
          price: vehiclesTable.price,
          stockNumber: vehiclesTable.stockNumber,
        })
        .from(pagePublishingJobsTable)
        .innerJoin(vehiclesTable, eq(pagePublishingJobsTable.vehicleId, vehiclesTable.id))
        .where(inArray(pagePublishingJobsTable.batchId, batchIds))
        .orderBy(asc(pagePublishingJobsTable.scheduledAt), asc(pagePublishingJobsTable.id))
      : [];
    const jobsByBatch = new Map<number, typeof jobs>();
    for (const job of jobs) {
      const current = jobsByBatch.get(job.batchId) ?? [];
      current.push(job);
      jobsByBatch.set(job.batchId, current);
    }
    res.json({
      dealerId,
      batches: batches.map((batch) => ({ ...batch, jobs: jobsByBatch.get(batch.id) ?? [] })),
    });
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
    const [batch] = await db
      .select({ dealerId: pagePublishingBatchesTable.dealerId })
      .from(pagePublishingBatchesTable)
      .where(eq(pagePublishingBatchesTable.id, batchId))
      .limit(1);
    if (!batch) {
      res.status(404).json({ error: "Pages batch not found" });
      return;
    }
    if (!hasDealerAccess(res, batch.dealerId)) return;
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
  const user = res.locals.authUser as { role?: string } | undefined;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  try {
    const outcome = await runWorkerOnce(pagesPublishingWorker, req.log, "manual", null);
    res.json({ worker: pagesPublishingWorker.id, outcome });
  } catch (error) {
    req.log.error({ err: error }, "Failed to run Pages worker");
    res.status(500).json({ error: "Failed to run Pages worker" });
  }
});

router.get("/pages/connection/:dealerId", async (req, res) => {
  const dealerId = dealerIdFromParam(req.params.dealerId);
  if (!dealerId) {
    res.status(400).json({ error: "Invalid dealerId" });
    return;
  }
  if (!hasDealerAccess(res, dealerId)) return;

  try {
    await ensurePagesSchema();
    const connection = await getMetaPageConnectionSummary(dealerId);
    res.json({
      dealerId,
      configured: Boolean(connection),
      connection,
    });
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to load Meta Page connection");
    res.status(500).json({ error: "Failed to load Meta Page connection" });
  }
});

router.post("/pages/connection/:dealerId/validate", async (req, res) => {
  const dealerId = dealerIdFromParam(req.params.dealerId);
  if (!dealerId) {
    res.status(400).json({ error: "Invalid dealerId" });
    return;
  }
  if (!hasDealerAccess(res, dealerId)) return;

  try {
    await ensurePagesSchema();
    await ensureLegacyAlphaMetaConnection(dealerId);
    let connection = await getMetaPageConnection(dealerId);
    if (!connection) {
      const bootstrap = readBootstrapMetaPageConfig();
      if (!bootstrap) {
        res.status(404).json({ error: "Meta Page credentials are not configured for this dealer" });
        return;
      }
      connection = {
        dealerId,
        pageId: bootstrap.pageId,
        pageAccessToken: bootstrap.pageAccessToken,
        graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || "v23.0",
        businessId: null,
        pageName: null,
        scopes: [],
        expiresAt: null,
      };
    }

    const validation = await validateMetaPageConnection(
      connection,
      connection.scopes,
    );
    if (validation.ok) {
      await persistValidatedMetaPageConnection(dealerId, {
        pageId: connection.pageId,
        pageAccessToken: connection.pageAccessToken,
      }, validation);
    } else {
      const bootstrap = readBootstrapMetaPageConfig();
      const canRepair = Boolean(bootstrap && bootstrap.pageId === connection.pageId && bootstrap.pageAccessToken !== connection.pageAccessToken);
      if (canRepair && bootstrap) {
        const replacement = {
          ...connection,
          pageAccessToken: bootstrap.pageAccessToken,
          pageName: null,
          scopes: [],
        };
        const replacementValidation = await validateMetaPageConnection(replacement, []);
        if (replacementValidation.ok) {
          await persistValidatedMetaPageConnection(dealerId, bootstrap, replacementValidation);
          connection = replacement;
          Object.assign(validation, replacementValidation);
        } else {
          await recordMetaPageValidation(dealerId, {
            pageName: validation.pageName,
            lastError: replacementValidation.error,
            valid: false,
          });
        }
      } else {
        await recordMetaPageValidation(dealerId, {
          pageName: validation.pageName,
          lastError: validation.error,
          valid: false,
        });
      }
    }
    res.status(validation.ok ? 200 : 422).json({
      dealerId,
      validation,
      connection: await getMetaPageConnectionSummary(dealerId),
    });
  } catch (error) {
    req.log.error({ err: error, dealerId }, "Failed to validate Meta Page connection");
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to validate Meta Page connection" });
  }
});

export default router;
