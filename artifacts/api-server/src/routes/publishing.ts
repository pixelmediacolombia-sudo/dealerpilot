import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  dealersTable,
  listingVersionsTable,
  publishingJobsTable,
  type PublishingJob,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";

const router: IRouter = Router();

type JobExtras = {
  vehicleLabel: string | null;
  dealerName: string | null;
  listingTitle: string | null;
};

function toJob(j: PublishingJob, extras: JobExtras = {
  vehicleLabel: null,
  dealerName: null,
  listingTitle: null,
}) {
  return {
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
    ...extras,
  };
}

async function enrich(jobs: PublishingJob[]) {
  if (jobs.length === 0) return [];
  const vehicleIds = [...new Set(jobs.map((j) => j.vehicleId))];
  const dealerIds = [...new Set(jobs.map((j) => j.dealerId))];
  const versionIds = [...new Set(jobs.map((j) => j.listingVersionId))];

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds));
  const dealers = await db
    .select()
    .from(dealersTable)
    .where(inArray(dealersTable.id, dealerIds));
  const versions = await db
    .select()
    .from(listingVersionsTable)
    .where(inArray(listingVersionsTable.id, versionIds));

  const vMap = new Map(vehicles.map((v) => [v.id, v]));
  const dMap = new Map(dealers.map((d) => [d.id, d]));
  const verMap = new Map(versions.map((v) => [v.id, v]));

  return jobs.map((j) => {
    const v = vMap.get(j.vehicleId);
    const d = dMap.get(j.dealerId);
    const ver = verMap.get(j.listingVersionId);
    return toJob(j, {
      vehicleLabel: v
        ? `${v.year ?? ""} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`.trim()
        : null,
      dealerName: d?.name ?? null,
      listingTitle: ver?.title ?? null,
    });
  });
}

// GET /publishing/jobs — full queue for the UI.
router.get("/publishing/jobs", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const rows = await db
    .select()
    .from(publishingJobsTable)
    .where(status ? eq(publishingJobsTable.status, status) : undefined)
    .orderBy(desc(publishingJobsTable.priority), asc(publishingJobsTable.createdAt));
  res.json({ jobs: await enrich(rows) });
});

// GET /publishing/jobs/next — next claimable job for the Chrome extension.
router.get("/publishing/jobs/next", async (req, res) => {
  const [row] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        or(eq(publishingJobsTable.status, "Queued"), eq(publishingJobsTable.status, "Retry")),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    )
    .orderBy(desc(publishingJobsTable.priority), asc(publishingJobsTable.createdAt))
    .limit(1);
  if (!row) {
    res.json({ job: null });
    return;
  }
  const [enriched] = await enrich([row]);
  res.json({ job: enriched });
});

const ClaimBody = z.object({ extensionId: z.string().min(1) });

// POST /publishing/jobs/:id/claim — extension takes ownership of a job.
router.post("/publishing/jobs/:id/claim", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = ClaimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "extensionId is required" });
    return;
  }

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Atomic claim: the conditional WHERE guarantees only one extension can win
  // the race even if several call claim concurrently for the same job.
  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: "Publishing",
      claimedByExtension: parsed.data.extensionId,
      startedAt: new Date(),
      attempts: job.attempts + 1,
    })
    .where(
      and(
        eq(publishingJobsTable.id, id),
        or(eq(publishingJobsTable.status, "Queued"), eq(publishingJobsTable.status, "Retry")),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job is not available to claim" });
    return;
  }

  await db
    .update(listingVersionsTable)
    .set({ status: "Approved" })
    .where(eq(listingVersionsTable.id, updated.listingVersionId));

  req.log.info({ jobId: id, extensionId: parsed.data.extensionId }, "Publishing job claimed");
  const [enriched] = await enrich([updated]);
  res.json(enriched);
});

// POST /publishing/jobs/:id/complete — extension reports success.
router.post("/publishing/jobs/:id/complete", async (req, res) => {
  const id = Number(req.params.id);
  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Only a job that is currently being published can be completed.
  const [updated] = await db
    .update(publishingJobsTable)
    .set({ status: "Published", completedAt: new Date(), failedReason: null })
    .where(and(eq(publishingJobsTable.id, id), eq(publishingJobsTable.status, "Publishing")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job is not in a publishing state" });
    return;
  }

  await db
    .update(vehiclesTable)
    .set({ status: "Published" })
    .where(eq(vehiclesTable.id, updated.vehicleId));

  req.log.info({ jobId: id }, "Publishing job completed");
  const [enriched] = await enrich([updated]);
  res.json(enriched);
});

const FailBody = z.object({ reason: z.string().optional() });
const MAX_ATTEMPTS = 3;

// POST /publishing/jobs/:id/fail — extension reports failure (eligible for retry).
router.post("/publishing/jobs/:id/fail", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = FailBody.safeParse(req.body);
  const reason = parsed.success ? (parsed.data.reason ?? null) : null;

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const nextStatus = job.attempts >= MAX_ATTEMPTS ? "Failed" : "Retry";
  // Only a job that is currently being published can be failed/retried.
  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: nextStatus,
      failedReason: reason,
      claimedByExtension: null,
    })
    .where(and(eq(publishingJobsTable.id, id), eq(publishingJobsTable.status, "Publishing")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job is not in a publishing state" });
    return;
  }

  req.log.warn({ jobId: id, reason, nextStatus }, "Publishing job failed");
  const [enriched] = await enrich([updated]);
  res.json(enriched);
});

const QueueBody = z.object({
  scheduledAt: z.string().optional(),
  priority: z.number().int().optional(),
});

// POST /listing-versions/:id/queue — approve a version and enqueue a job.
router.post("/listing-versions/:id/queue", async (req, res) => {
  const versionId = Number(req.params.id);
  const parsed = QueueBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid queue request" });
    return;
  }

  const [version] = await db
    .select()
    .from(listingVersionsTable)
    .where(eq(listingVersionsTable.id, versionId));
  if (!version) {
    res.status(404).json({ error: "Listing version not found" });
    return;
  }

  const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
  const priority = parsed.data.priority ?? 0;

  const [job] = await db.transaction(async (tx) => {
    await tx
      .update(listingVersionsTable)
      .set({ status: "Approved" })
      .where(eq(listingVersionsTable.id, versionId));
    return tx
      .insert(publishingJobsTable)
      .values({
        listingVersionId: version.id,
        vehicleId: version.vehicleId,
        dealerId: version.dealerId,
        status: "Queued",
        priority,
        scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
      })
      .returning();
  });

  await db
    .update(vehiclesTable)
    .set({ status: "Ready to Publish" })
    .where(eq(vehiclesTable.id, version.vehicleId));

  req.log.info({ versionId, jobId: job.id }, "Listing version queued for publishing");
  const [enriched] = await enrich([job]);
  res.json(enriched);
});

export default router;
