import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  dealersTable,
  listingsTable,
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

// GET /publishing/jobs/:id/payload — full data the extension needs to fill the
// Marketplace form for a (claimed) job. Grounded entirely in inventory + the
// specific listing version this job references.
router.get("/publishing/jobs/:id/payload", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const [job] = await db.select().from(publishingJobsTable).where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [version] = await db
    .select()
    .from(listingVersionsTable)
    .where(eq(listingVersionsTable.id, job.listingVersionId));
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, job.dealerId));
  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, job.vehicleId))
    .orderBy(asc(vehicleImagesTable.position));

  if (!version || !vehicle) {
    res.status(404).json({ error: "Listing data not found for job" });
    return;
  }

  const descriptionParts = [version.descriptionEn?.trim(), version.callToAction?.trim()].filter(
    (p): p is string => !!p,
  );

  const [enriched] = await enrich([job]);
  res.json({
    job: enriched,
    fill: {
      title: version.title,
      price: version.askingPrice ?? vehicle.price ?? null,
      description: descriptionParts.join("\n\n"),
      descriptionEs: version.descriptionEs ?? null,
      mileage: vehicle.mileage ?? null,
      year: vehicle.year ?? null,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim ?? null,
      vin: vehicle.vin,
      bodyStyle: vehicle.bodyStyle ?? null,
      exteriorColor: vehicle.exteriorColor ?? null,
      fuelType: vehicle.fuelType ?? null,
      transmission: vehicle.transmission ?? null,
      location: dealer?.name ?? null,
      category: "Vehicle",
      downPayment: version.downPayment ?? null,
    },
    images: images.map((img) => img.url),
  });
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

const CompleteBody = z.object({
  extensionId: z.string().min(1),
  listingUrl: z.string().url().optional(),
});

// POST /publishing/jobs/:id/complete — extension reports success.
router.post("/publishing/jobs/:id/complete", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = CompleteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "extensionId is required; listingUrl must be a valid URL" });
    return;
  }
  const { extensionId, listingUrl } = parsed.data;

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Ownership: only the extension that claimed the job may finalize it.
  if (job.claimedByExtension && job.claimedByExtension !== extensionId) {
    res.status(403).json({ error: "Job is claimed by another extension" });
    return;
  }

  // Atomic, ownership-scoped transition: only a Publishing job claimed by this
  // extension can be completed.
  const [updated] = await db
    .update(publishingJobsTable)
    .set({ status: "Published", completedAt: new Date(), failedReason: null })
    .where(
      and(
        eq(publishingJobsTable.id, id),
        eq(publishingJobsTable.status, "Publishing"),
        eq(publishingJobsTable.claimedByExtension, extensionId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job is not in a publishing state" });
    return;
  }

  await db
    .update(vehiclesTable)
    .set({ status: "Published" })
    .where(eq(vehiclesTable.id, updated.vehicleId));

  // Record the published Marketplace listing. Atomic upsert keyed by the
  // (vehicle_id, channel) unique constraint so concurrent completions cannot
  // create duplicates; omit externalUrl from the conflict update so a re-publish
  // without a URL keeps the previously stored one.
  const conflictSet: { status: string; externalUrl?: string } = { status: "Published" };
  if (listingUrl) conflictSet.externalUrl = listingUrl;
  await db
    .insert(listingsTable)
    .values({
      vehicleId: updated.vehicleId,
      channel: "marketplace",
      status: "Published",
      externalUrl: listingUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [listingsTable.vehicleId, listingsTable.channel],
      set: conflictSet,
    });

  req.log.info({ jobId: id, listingUrl }, "Publishing job completed");
  const [enriched] = await enrich([updated]);
  res.json(enriched);
});

const FailBody = z.object({
  extensionId: z.string().min(1),
  reason: z.string().optional(),
});
const MAX_ATTEMPTS = 3;

// POST /publishing/jobs/:id/fail — extension reports failure (eligible for retry).
router.post("/publishing/jobs/:id/fail", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = FailBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "extensionId is required" });
    return;
  }
  const { extensionId } = parsed.data;
  const reason = parsed.data.reason ?? null;

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Ownership: only the extension that claimed the job may fail it.
  if (job.claimedByExtension && job.claimedByExtension !== extensionId) {
    res.status(403).json({ error: "Job is claimed by another extension" });
    return;
  }

  const nextStatus = job.attempts >= MAX_ATTEMPTS ? "Failed" : "Retry";
  // Atomic, ownership-scoped transition: only a Publishing job claimed by this
  // extension can be failed/retried.
  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: nextStatus,
      failedReason: reason,
      claimedByExtension: null,
    })
    .where(
      and(
        eq(publishingJobsTable.id, id),
        eq(publishingJobsTable.status, "Publishing"),
        eq(publishingJobsTable.claimedByExtension, extensionId),
      ),
    )
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
