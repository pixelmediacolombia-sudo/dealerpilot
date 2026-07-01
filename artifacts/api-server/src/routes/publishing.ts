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
  vehicleIntelligenceTable,
  type PublishingJob,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getMarketplacePricing } from "../listings/pricing";

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
    mode: j.mode,
    status: j.status,
    currentStep: j.currentStep ?? null,
    progressPercent: j.progressPercent,
    priority: j.priority,
    scheduledAt: j.scheduledAt ? j.scheduledAt.toISOString() : null,
    claimedByExtension: j.claimedByExtension ?? null,
    assignedExtensionId: j.assignedExtensionId ?? null,
    assignedAt: j.assignedAt ? j.assignedAt.toISOString() : null,
    startedAt: j.startedAt ? j.startedAt.toISOString() : null,
    completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    failedReason: j.failedReason ?? null,
    listingUrl: j.listingUrl ?? null,
    needsReview: j.needsReview,
    reviewReason: j.reviewReason ?? null,
    attempts: j.attempts,
    source: j.source ?? null,
    approvedByUser: j.approvedByUser ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    ...extras,
  };
}

async function enrich(jobs: PublishingJob[]) {
  if (jobs.length === 0) return [];
  const vehicleIds = [...new Set(jobs.map((j) => j.vehicleId))];
  const dealerIds = [...new Set(jobs.map((j) => j.dealerId))];
  const versionIds = [...new Set(jobs.map((j) => j.listingVersionId).filter((id): id is number => id !== null))];

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds));
  const dealers = await db
    .select()
    .from(dealersTable)
    .where(inArray(dealersTable.id, dealerIds));
  const versions =
    versionIds.length > 0
      ? await db
          .select()
          .from(listingVersionsTable)
          .where(inArray(listingVersionsTable.id, versionIds))
      : [];

  const vMap = new Map(vehicles.map((v) => [v.id, v]));
  const dMap = new Map(dealers.map((d) => [d.id, d]));
  const verMap = new Map(versions.map((v) => [v.id, v]));

  return jobs.map((j) => {
    const v = vMap.get(j.vehicleId);
    const d = dMap.get(j.dealerId);
    const ver = j.listingVersionId != null ? verMap.get(j.listingVersionId) : undefined;
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

const AssignBody = z.object({ extensionId: z.string().min(1).optional() });

// POST /publishing/jobs/:id/assign — app assigns a queued job to a specific extension.
// Sets status=Assigned and records which extension is expected to claim it.
router.post("/publishing/jobs/:id/assign", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const parsed = AssignBody.safeParse(req.body ?? {});
  const extensionId = parsed.success ? (parsed.data.extensionId ?? null) : null;

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (!["Queued", "Retry"].includes(job.status)) {
    res.status(409).json({ error: `Job is not assignable (status: ${job.status})` });
    return;
  }

  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: "Assigned",
      assignedExtensionId: extensionId,
      assignedAt: new Date(),
    })
    .where(
      and(
        eq(publishingJobsTable.id, id),
        or(eq(publishingJobsTable.status, "Queued"), eq(publishingJobsTable.status, "Retry")),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job could not be assigned" });
    return;
  }

  req.log.info({ jobId: id, extensionId }, "Publishing job assigned to extension");
  const [enriched] = await enrich([updated]);
  res.json({ job: enriched });
});

// GET /publishing/jobs/assigned — extension polls for a job assigned to it.
// Returns the first Assigned job for this extensionId, or { job: null }.
router.get("/publishing/jobs/assigned", async (req, res) => {
  const extensionId = typeof req.query.extensionId === "string" ? req.query.extensionId : null;
  if (!extensionId) {
    res.status(400).json({ error: "extensionId query param is required" });
    return;
  }

  const [row] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.status, "Assigned"),
        eq(publishingJobsTable.assignedExtensionId, extensionId),
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

// GET /publishing/jobs/next — next claimable job for the Chrome extension.
router.get("/publishing/jobs/next", async (req, res) => {
  const [row] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        or(
          eq(publishingJobsTable.status, "Queued"),
          eq(publishingJobsTable.status, "Retry"),
        ),
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

  const [version] = job.listingVersionId
    ? await db
        .select()
        .from(listingVersionsTable)
        .where(eq(listingVersionsTable.id, job.listingVersionId))
    : [];
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, job.dealerId));
  const [intel] = await db
    .select()
    .from(vehicleIntelligenceTable)
    .where(eq(vehicleIntelligenceTable.vehicleId, job.vehicleId))
    .orderBy(desc(vehicleIntelligenceTable.generatedAt))
    .limit(1);
  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, job.vehicleId))
    .orderBy(asc(vehicleImagesTable.position));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found for job" });
    return;
  }

  const pricing = getMarketplacePricing(vehicle, intel?.recommendedDownPayment ?? null);

  // Build fill content — prefer an existing listing version; auto-generate from inventory otherwise.
  let fillTitle: string;
  let fillDescription: string;
  let fillDescriptionEs: string | null = null;
  let fillDownPayment: number | null = null;

  if (version) {
    const descriptionParts = [version.descriptionEn?.trim(), version.callToAction?.trim()].filter(
      (p): p is string => !!p,
    );
    fillTitle = version.title;
    fillDescription = descriptionParts.join("\n\n");
    fillDescriptionEs = version.descriptionEs ?? null;
    fillDownPayment = version.downPayment ?? null;
  } else {
    // Auto-generate minimal copy from inventory data — no listing version required.
    const yr = vehicle.year ?? "";
    const trimStr = vehicle.trim ? ` ${vehicle.trim}` : "";
    fillTitle = `${yr} ${vehicle.make} ${vehicle.model}${trimStr}`.trim();
    const parts: string[] = [];
    if (vehicle.mileage != null) parts.push(`${vehicle.mileage.toLocaleString()} miles`);
    if (vehicle.transmission) parts.push(vehicle.transmission);
    if (vehicle.fuelType) parts.push(vehicle.fuelType);
    if (vehicle.exteriorColor) parts.push(vehicle.exteriorColor);
    if (dealer?.name) parts.push(`Listed by ${dealer.name}`);
    fillDescription = parts.length > 0 ? parts.join(" · ") : fillTitle;
  }

  const [enriched] = await enrich([job]);
  res.json({
    job: enriched,
    fill: {
      title: fillTitle,
      price: pricing.marketplaceDisplayedPrice,
      description: fillDescription,
      descriptionEs: fillDescriptionEs,
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
      downPayment: fillDownPayment,
      actualVehiclePrice: pricing.actualVehiclePrice,
      marketplaceDisplayedPrice: pricing.marketplaceDisplayedPrice,
      priceMode: pricing.priceMode,
      recommendedDownPayment: pricing.recommendedDownPayment,
      pricingReason: pricing.pricingReason,
    },
    images: images.map((img) => {
      const url = img.url;
      if (!url) return url;
      if (url.startsWith("http://") || url.startsWith("https://")) return url;
      // Relative URL — build an absolute URL from the request origin.
      // Prefer X-Forwarded-Proto (set by Replit's reverse proxy) over req.protocol,
      // which stays "http" for internal traffic even on HTTPS deployments.
      const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
      const host = req.get("host") ?? "localhost";
      const origin = `${proto}://${host}`;
      return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
    }),
  });
});

const ClaimBody = z.object({ extensionId: z.string().min(1) });

// POST /publishing/jobs/:id/claim — extension takes ownership of a job.
router.post("/publishing/jobs/:id/claim", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }
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
        or(
          eq(publishingJobsTable.status, "Queued"),
          eq(publishingJobsTable.status, "Retry"),
          eq(publishingJobsTable.status, "Assigned"),
        ),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job is not available to claim" });
    return;
  }

  if (updated.listingVersionId) {
    await db
      .update(listingVersionsTable)
      .set({ status: "Approved" })
      .where(eq(listingVersionsTable.id, updated.listingVersionId));
  }

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

  // Atomic, ownership-scoped transition: accepts Publishing, Filling Form, or
  // Ready for Review so the operator can confirm from any in-progress state.
  const [updated] = await db
    .update(publishingJobsTable)
    .set({ status: "Published", completedAt: new Date(), failedReason: null })
    .where(
      and(
        eq(publishingJobsTable.id, id),
        or(
          eq(publishingJobsTable.status, "Publishing"),
          eq(publishingJobsTable.status, "Filling Form"),
          eq(publishingJobsTable.status, "Ready for Review"),
        ),
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
  const now = new Date();
  const conflictSet: { status: string; externalUrl?: string; publishedAt: Date; publishedByExtensionId?: string } = {
    status: "Published",
    publishedAt: now,
    publishedByExtensionId: extensionId,
  };
  if (listingUrl) conflictSet.externalUrl = listingUrl;
  await db
    .insert(listingsTable)
    .values({
      vehicleId: updated.vehicleId,
      channel: "marketplace",
      status: "Published",
      externalUrl: listingUrl ?? null,
      publishedAt: now,
      publishedByExtensionId: extensionId,
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
  // Atomic, ownership-scoped transition: accepts Publishing, Filling Form, or
  // Ready for Review so the operator/extension can fail from any in-progress state.
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
        or(
          eq(publishingJobsTable.status, "Publishing"),
          eq(publishingJobsTable.status, "Filling Form"),
          eq(publishingJobsTable.status, "Ready for Review"),
        ),
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

const CancelBody = z.object({ reason: z.string().optional() });

// POST /publishing/jobs/:id/cancel — operator cancels a job from the dashboard.
// Moves the job to Failed so it is removed from the active queue.
router.post("/publishing/jobs/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const parsed = CancelBody.safeParse(req.body ?? {});
  const reason =
    parsed.success ? (parsed.data.reason ?? "Cancelled by operator") : "Cancelled by operator";

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (["Published", "Failed"].includes(job.status)) {
    res.status(409).json({ error: `Cannot cancel a ${job.status} job` });
    return;
  }

  const [updated] = await db
    .update(publishingJobsTable)
    .set({ status: "Failed", failedReason: reason, claimedByExtension: null })
    .where(eq(publishingJobsTable.id, id))
    .returning();

  req.log.info({ jobId: id, reason }, "Publishing job cancelled by operator");
  const [enriched] = await enrich([updated]);
  res.json({ job: enriched });
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
        source: "queue_from_listing",
        approvedByUser: true,
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

// ── Bulk Schedule ─────────────────────────────────────────────────────────────

const BulkScheduleBody = z.object({
  vehicleIds: z.array(z.number().int().positive()).min(1).max(100),
  scheduledAt: z.string().optional(),
  spacingMinutes: z.number().int().min(0).max(120).optional().default(30),
  priority: z.number().int().min(0).max(100).optional().default(50),
  notes: z.string().optional(),
});

router.post("/publishing/bulk-schedule", async (req, res) => {
  const parsed = BulkScheduleBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bulk-schedule request" });
    return;
  }
  const { vehicleIds, scheduledAt: scheduledAtStr, spacingMinutes, priority, notes: _notes } = parsed.data;

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds));

  if (vehicles.length === 0) {
    res.status(404).json({ error: "No matching vehicles found" });
    return;
  }

  // Skip vehicles that already have an active publishing job
  const activeJobs = await db
    .select({ vehicleId: publishingJobsTable.vehicleId })
    .from(publishingJobsTable)
    .where(
      and(
        inArray(publishingJobsTable.vehicleId, vehicleIds),
        inArray(publishingJobsTable.status, ["Queued", "Scheduled", "Publishing"]),
      ),
    );
  const alreadyQueued = new Set(activeJobs.map((j) => j.vehicleId));

  const eligible = vehicles.filter((v) => !alreadyQueued.has(v.id));
  const skipped = vehicles.length - eligible.length;

  if (eligible.length === 0) {
    res.status(202).json({ enqueued: 0, skipped });
    return;
  }

  const baseTime = scheduledAtStr ? new Date(scheduledAtStr) : new Date();
  const enqueued: number[] = [];

  for (let i = 0; i < eligible.length; i++) {
    const vehicle = eligible[i]!;
    const scheduledAt = new Date(baseTime.getTime() + i * spacingMinutes * 60_000);

    const [job] = await db
      .insert(publishingJobsTable)
      .values({
        vehicleId: vehicle.id,
        dealerId: vehicle.dealerId,
        listingVersionId: null,
        mode: "Assisted",
        status: scheduledAtStr ? "Scheduled" : "Queued",
        priority,
        scheduledAt,
        source: "bulk_schedule",
        approvedByUser: true,
      })
      .returning({ id: publishingJobsTable.id });

    enqueued.push(job!.id);
  }

  req.log.info(
    { vehicleIds: eligible.map((v) => v.id), enqueued: enqueued.length, skipped },
    "Bulk publishing jobs scheduled",
  );
  res.status(202).json({ enqueued: enqueued.length, skipped });
});

// ── Publish Now ────────────────────────────────────────────────────────────────
// Creates a high-priority Controlled-mode job for a single vehicle, bypassing
// the listing-version approval flow. Listing copy is auto-generated at payload
// time if no version exists. Rejects when an active job already exists.

const PublishNowBody = z.object({
  vehicleId: z.number().int().positive(),
});

router.post("/publishing/jobs/publish-now", async (req, res) => {
  const parsed = PublishNowBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "vehicleId is required" });
    return;
  }
  const { vehicleId } = parsed.data;
  const DEALER_ID = 1;

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, DEALER_ID)));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // If an active job already exists, return it instead of creating a duplicate
  const [existing] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.vehicleId, vehicleId),
        inArray(publishingJobsTable.status, [
          "Queued", "Scheduled", "Claimed", "Publishing",
          "Opening Facebook", "Filling Form", "Auto Publishing",
        ]),
      ),
    )
    .limit(1);
  if (existing) {
    const [enriched] = await enrich([existing]);
    req.log.info({ vehicleId, jobId: existing.id, source: "publish_now_resume" }, "Publish Now: existing active job returned (idempotent)");
    res.status(200).json({
      jobId: existing.id,
      job: enriched,
      resumed: true,
      message: `Publishing already in progress — resuming job #${existing.id}`,
    });
    return;
  }

  const [job] = await db
    .insert(publishingJobsTable)
    .values({
      vehicleId,
      dealerId: DEALER_ID,
      listingVersionId: null,
      mode: "Controlled",
      status: "Queued",
      priority: 100,
      progressPercent: 0,
      source: "publish_now",
      approvedByUser: true,
    })
    .returning();

  req.log.info({ vehicleId, jobId: job.id, source: "publish_now" }, "Publish Now job created (Controlled mode)");
  const [enriched] = await enrich([job]);
  res.status(201).json({ jobId: job.id, job: enriched });
});

// POST /publishing/jobs/:id/retry — operator manually resets a Failed job back to Queued.
// Resets attempts to 0 so the extension can try again from scratch.
router.post("/publishing/jobs/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
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
  if (!["Failed", "Retry"].includes(job.status)) {
    res.status(409).json({ error: `Only Failed or Retry jobs can be manually retried (status: ${job.status})` });
    return;
  }

  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: "Queued",
      attempts: 0,
      claimedByExtension: null,
      failedReason: null,
    })
    .where(eq(publishingJobsTable.id, id))
    .returning();

  req.log.info({ jobId: id }, "Publishing job manually retried by operator");
  const [enriched] = await enrich([updated]);
  res.json({ job: enriched });
});

// GET /publishing/jobs/:id/progress — lightweight polling endpoint for the progress modal.
router.get("/publishing/jobs/:id/progress", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
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
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, job.vehicleId));
  const vehicleLabel = vehicle
    ? `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`.trim()
    : null;

  res.json({
    id: job.id,
    mode: job.mode,
    status: job.status,
    currentStep: job.currentStep ?? null,
    progressPercent: job.progressPercent,
    failedReason: job.failedReason ?? null,
    listingUrl: job.listingUrl ?? null,
    vehicleId: job.vehicleId,
    vehicleLabel,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
  });
});

// ── Photo Proxy ───────────────────────────────────────────────────────────────
// GET /publishing/jobs/:id/photo/:index
// Downloads the vehicle image at `index` server-side and streams the raw bytes.
// The extension calls this instead of fetching CDN URLs directly, which avoids
// CORS failures and CDN authentication issues entirely.

router.get("/publishing/jobs/:id/photo/:index", async (req, res) => {
  const id = Number(req.params.id);
  const index = Number(req.params.index);

  if (Number.isNaN(id) || Number.isNaN(index) || index < 0) {
    res.status(400).json({ error: "Invalid job id or photo index" });
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

  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, job.vehicleId))
    .orderBy(asc(vehicleImagesTable.position));

  const image = images[index];
  if (!image || !image.url) {
    res.status(404).json({ error: `No image at index ${index} (vehicle has ${images.length} images)` });
    return;
  }

  // Resolve relative URLs to absolute using the incoming request's origin
  const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
  const host = req.get("host") ?? "localhost";
  const origin = `${proto}://${host}`;
  const imageUrl = image.url.startsWith("http")
    ? image.url
    : `${origin}${image.url.startsWith("/") ? "" : "/"}${image.url}`;

  req.log.info({ jobId: id, index, imageUrl }, "Photo proxy: fetching image");

  let upstream: Response;
  try {
    upstream = await fetch(imageUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DealerPilotBot/1.0)",
        "Accept": "image/*,*/*;q=0.8",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ jobId: id, index, imageUrl, err: msg }, "Photo proxy: fetch threw");
    res.status(502).json({ error: `Backend could not fetch image: ${msg}` });
    return;
  }

  if (!upstream.ok) {
    req.log.warn({ jobId: id, index, imageUrl, status: upstream.status }, "Photo proxy: upstream non-200");
    res.status(502).json({ error: `Upstream image returned HTTP ${upstream.status} for ${imageUrl}` });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await upstream.arrayBuffer());

  res.set({
    "Content-Type": contentType,
    "Content-Length": String(buffer.length),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.send(buffer);
  req.log.info({ jobId: id, index, bytes: buffer.length, contentType }, "Photo proxy: served OK");
});

// ── Clear Queue ───────────────────────────────────────────────────────────────
// POST /publishing/jobs/clear-queue
// Dashboard admin action: cancels ALL in-flight jobs older than N minutes.
// Covers Queued, Scheduled, Retry, Claimed, and Publishing — never touches Published.

const ClearQueueBody = z.object({
  olderThanMinutes: z.number().int().min(0).max(1440).optional().default(10),
  dealerId: z.number().int().positive().optional(),
});

router.post("/publishing/jobs/clear-queue", async (req, res) => {
  const parsed = ClearQueueBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { olderThanMinutes, dealerId } = parsed.data;
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  const conditions = [
    inArray(publishingJobsTable.status, ["Queued", "Scheduled", "Retry", "Claimed", "Publishing"]),
    lt(publishingJobsTable.createdAt, cutoff),
  ];
  if (dealerId != null) {
    conditions.push(eq(publishingJobsTable.dealerId, dealerId));
  }

  const cleared = await db
    .update(publishingJobsTable)
    .set({ status: "Cancelled", failedReason: `Cleared by operator (clear-queue, >${olderThanMinutes} min)` })
    .where(and(...conditions))
    .returning({ id: publishingJobsTable.id });

  req.log.info({ count: cleared.length, olderThanMinutes }, "Queue cleared by operator");
  res.json({ cleared: cleared.length, ids: cleared.map((j) => j.id) });
});

// ── Cancel Stale Jobs ─────────────────────────────────────────────────────────
// POST /publishing/jobs/cancel-stale
// Cancels all Queued/Scheduled jobs older than `olderThanMinutes` (default 60).
// Safety valve for the dashboard — never touches jobs in progress (Publishing/Claimed).

const CancelStaleBody = z.object({
  dealerId: z.number().int().positive().optional(),
  olderThanMinutes: z.number().int().min(1).max(1440).optional().default(60),
});

router.post("/publishing/jobs/cancel-stale", async (req, res) => {
  const parsed = CancelStaleBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { dealerId, olderThanMinutes } = parsed.data;
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  const conditions = [
    inArray(publishingJobsTable.status, ["Queued", "Scheduled"]),
    lt(publishingJobsTable.createdAt, cutoff),
  ];
  if (dealerId != null) {
    conditions.push(eq(publishingJobsTable.dealerId, dealerId));
  }

  const cancelled = await db
    .update(publishingJobsTable)
    .set({ status: "Cancelled", failedReason: `Cancelled by cancel-stale after ${olderThanMinutes} min` })
    .where(and(...conditions))
    .returning({ id: publishingJobsTable.id, vehicleId: publishingJobsTable.vehicleId });

  req.log.info({ count: cancelled.length, olderThanMinutes, dealerId }, "Stale jobs cancelled");
  res.json({ cancelled: cancelled.length, ids: cancelled.map((j) => j.id) });
});

export default router;
