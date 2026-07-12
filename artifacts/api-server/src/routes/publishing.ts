import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getCachedGmDecision, recordGmDecision } from "./gm";
import {
  db,
  dealersTable,
  vehiclesTable,
  listingsTable,
  listingVersionsTable,
  publishingJobsTable,
  vehicleIntelligenceTable,
  marketplaceListingsTable,
  autoPublishSettingsTable,
  pool,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getMarketplacePricing } from "../listings/pricing";
import {
  checkPublishGuardrails,
  isExtensionOnline,
  isControlledModeEnabled,
  isFullAutoMode,
  resolvePublishMode,
  LOT_CITY_MAP,
  ACTIVE_PUBLISHING_JOB_STATUSES,
} from "../publishing/controlledMode";
import { getDuplicateConflictVehicleIds } from "../workers/market.worker";
import {
  enrich,
  getVehiclePhotos,
  moveJobToNeedsReviewWithoutListingUrl,
  reconcileBatchProgress,
} from "../features/publishing/infrastructure/publishingRepository";

// Dealer scope: Alpha Motorsport = dealer_id 1.
// Do NOT filter by lot_location — the feed stores the dealer name there, not a city.
const DEALER_ID = 1;

const router: IRouter = Router();

// GET /publishing/jobs — full queue for the UI.
router.get("/publishing/jobs", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const location = typeof req.query.location === "string" ? req.query.location : "";

  let vehicleIdSet: Set<number> | null = null;
  if (location) {
    const matching = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.lotLocation, location));
    vehicleIdSet = new Set(matching.map((v) => v.id));
  }

  const rows = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        status ? eq(publishingJobsTable.status, status) : undefined,
        vehicleIdSet !== null
          ? vehicleIdSet.size > 0
            ? inArray(publishingJobsTable.vehicleId, [...vehicleIdSet])
            : sql`false`
          : undefined,
      ),
    )
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

  const aliases = new Set<string>([extensionId]);
  const connection = await pool.query<{ name: string }>(
    "select name from extension_connections where chrome_extension_id = $1 limit 1",
    [extensionId],
  );
  if (connection.rows[0]?.name) aliases.add(connection.rows[0].name);
  if (!connection.rows[0]?.name) {
    const onlineConnection = await pool.query<{ name: string | null; chrome_extension_id: string | null }>(
      "select name, chrome_extension_id from extension_connections where status = 'online' and last_heartbeat_at > now() - interval '5 minutes' order by last_heartbeat_at desc limit 1",
    );
    const online = onlineConnection.rows[0];
    if (online?.name) aliases.add(online.name);
    if (online?.chrome_extension_id) aliases.add(online.chrome_extension_id);
  }

  const [row] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.status, "Assigned"),
        inArray(publishingJobsTable.assignedExtensionId, [...aliases]),
        or(isNull(publishingJobsTable.scheduledAt), lte(publishingJobsTable.scheduledAt, new Date())),
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
// Sort: publish_now first (direct operator action), then by priority DESC,
// then by created_at ASC (FIFO). This prevents stale Retry jobs from
// blocking fresh publish_now jobs that share the same priority value.
router.get("/publishing/jobs/next", async (req, res) => {
  const now = new Date();
  const [row] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        or(
          and(
            eq(publishingJobsTable.status, "Queued"),
            or(isNull(publishingJobsTable.scheduledAt), lte(publishingJobsTable.scheduledAt, now)),
          ),
          eq(publishingJobsTable.status, "Retry"),
          and(eq(publishingJobsTable.status, "Scheduled"), lte(publishingJobsTable.scheduledAt, now)),
        ),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${publishingJobsTable.source} = 'publish_now' THEN 0 ELSE 1 END`,
      desc(publishingJobsTable.priority),
      asc(publishingJobsTable.createdAt),
    )
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
//
// Never throws a bare 500: all errors are caught, logged, and returned as
// structured JSON so the extension can surface a meaningful message.
router.get("/publishing/jobs/:id/payload", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id", code: "INVALID_ID" });
    return;
  }

  try {
    const [job] = await db.select().from(publishingJobsTable).where(eq(publishingJobsTable.id, id));
    if (!job) {
      res.status(404).json({ error: "Job not found", code: "JOB_NOT_FOUND", jobId: id });
      return;
    }

    // ── Publish mode — always re-derive from server env vars ──────────────────
    // job.mode may be stale ("Assisted") if the job was created before
    // MARKETPLACE_PUBLISH_MODE=full_auto was set. Re-derive every time the
    // payload is fetched so the extension always gets the current mode.
    // resolvePublishMode(true) = same logic as publish-now (treats dealer as opted-in).
    const resolvedMode = resolvePublishMode(true);
    const autoClickPublish = resolvedMode === "Controlled";
    const controlledMode = isControlledModeEnabled();
    const publishMode = isFullAutoMode() ? "full_auto" : autoClickPublish ? "controlled" : "assisted";

    // Heal stale mode in DB so future queries and the UI show the right value.
    if (job.mode !== resolvedMode) {
      req.log.info(
        { jobId: id, oldMode: job.mode, newMode: resolvedMode, publishMode },
        "Payload: healing stale job mode to match current server config",
      );
      await db
        .update(publishingJobsTable)
        .set({ mode: resolvedMode })
        .where(eq(publishingJobsTable.id, id));
    }

    const [version] = job.listingVersionId
      ? await db
          .select()
          .from(listingVersionsTable)
          .where(eq(listingVersionsTable.id, job.listingVersionId))
      : [];
    const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
    const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, job.dealerId));

    // vehicleIntelligence is optional — missing table or row is not fatal.
    let intel: { recommendedDownPayment: number | null } | undefined;
    try {
      const [row] = await db
        .select()
        .from(vehicleIntelligenceTable)
        .where(eq(vehicleIntelligenceTable.vehicleId, job.vehicleId))
        .orderBy(desc(vehicleIntelligenceTable.generatedAt))
        .limit(1);
      intel = row;
    } catch {
      req.log.warn({ jobId: id, vehicleId: job.vehicleId }, "vehicle_intelligence unavailable — using null pricing intel");
    }

    if (!vehicle) {
      res.status(404).json({
        error: "Vehicle not found for job",
        code: "VEHICLE_NOT_FOUND",
        jobId: id,
        vehicleId: job.vehicleId,
      });
      return;
    }

    // ── Lot location guard ────────────────────────────────────────────────────
    const lotCity = vehicle.lotLocation ? LOT_CITY_MAP[vehicle.lotLocation] : undefined;
    if (!lotCity) {
      req.log.warn(
        { jobId: job.id, vehicleId: vehicle.id, lotLocation: vehicle.lotLocation },
        "Publishing blocked: unknown or unmapped lot location",
      );
      res.status(422).json({
        error: `Cannot publish: vehicle lot location "${vehicle.lotLocation ?? "unknown"}" is not mapped to a city. Assign this vehicle to Manassas or Fredericksburg before publishing.`,
        code: "UNKNOWN_LOT",
        jobId: id,
        vehicleId: vehicle.id,
        lotLocation: vehicle.lotLocation ?? null,
      });
      return;
    }

    const images = await getVehiclePhotos(vehicle.id, vehicle.aiPhotoSetId, vehicle.aiPhotoStatus);
    const usingAiPhotos = images.length > 0 && images[0].source === "ai";

    const pricing = getMarketplacePricing(vehicle, intel?.recommendedDownPayment ?? null);

    // "Real prose" test: non-empty after trim, ≥ 15 chars, has a space, not all-digits.
    function isProseText(s: string | null | undefined): s is string {
      if (!s) return false;
      const t = s.trim();
      return t.length >= 15 && /\s/.test(t) && !/^\d+$/.test(t);
    }

    let fillTitle: string;
    let fillDescription: string;
    let fillDescriptionEs: string | null = null;
    let fillDownPayment: number | null = null;

    const yr = vehicle.year ?? "";
    const trimStr = vehicle.trim ? ` ${vehicle.trim}` : "";
    const autoTitle = `${yr} ${vehicle.make} ${vehicle.model}${trimStr}`.trim();

    function buildAISalesCopy(): string {
      const modelKeyword = vehicle.model.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return [
        `🔥 ${autoTitle} lista para manejar`,
        "",
        "💰 Financiamiento desde $1,000, $2,000 o $3,000 de inicial",
        "✅ Identificación válida",
        "✅ Cuenta de banco activa",
        "✅ Precios bajos para compradores serios",
        "⏳ Solo personas interesadas en comprar este mes",
        "",
        `📩 Escríbenos "${modelKeyword}" hoy y te damos más detalles.`,
      ].join("\n");
    }

    if (version) {
      const rawEn  = version.descriptionEn?.trim() ?? "";
      const rawCta = version.callToAction?.trim()  ?? "";
      const descParts = [rawEn, rawCta].filter(isProseText);
      fillTitle         = version.title;
      fillDescriptionEs = version.descriptionEs ?? null;
      fillDownPayment   = version.downPayment ?? null;
      fillDescription   = descParts.length > 0 ? descParts.join("\n\n") : buildAISalesCopy();
    } else {
      fillTitle       = autoTitle;
      fillDescription = buildAISalesCopy();
    }

    // Enrich using the healed mode so the extension always sees the correct value.
    const [enriched] = await enrich([{ ...job, mode: resolvedMode }]);

    req.log.info(
      { jobId: id, vehicleId: job.vehicleId, dealerId: job.dealerId, publishMode, resolvedMode, photoCount: images.length, hasLocation: true },
      "Payload served",
    );

    res.json({
      // ── Debug / diagnostics (top-level for easy inspection) ──────────────
      jobId: id,
      vehicleId: job.vehicleId,
      dealerId: job.dealerId,
      publishMode,          // "full_auto" | "controlled" | "assisted"
      controlledMode,       // true when MARKETPLACE_CONTROLLED_MODE_ENABLED=true
      autoClickPublish,     // true when extension should auto-click Publish
      backendEnvironment: process.env.NODE_ENV ?? "production",
      hasPhotos: images.length > 0,
      photoCount: images.length,
      hasLocation: true,
      location: lotCity,
      // ── Core payload ─────────────────────────────────────────────────────
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
        location: lotCity,
        category: "Vehicle",
        downPayment: fillDownPayment,
        actualVehiclePrice: pricing.actualVehiclePrice,
        marketplaceDisplayedPrice: pricing.marketplaceDisplayedPrice,
        priceMode: pricing.priceMode,
        recommendedDownPayment: pricing.recommendedDownPayment,
        pricingReason: pricing.pricingReason,
      },
      usingAiPhotos,
      images: images.map((img) => {
        const url = img.url;
        if (!url) return url;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
        const host = req.get("host") ?? "localhost";
        const origin = `${proto}://${host}`;
        return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
      }),
    });
  } catch (err) {
    req.log.error({ jobId: id, err }, "GET /publishing/jobs/:id/payload — unhandled error");
    res.status(500).json({
      error: "Failed to build job payload",
      code: "PAYLOAD_ERROR",
      jobId: id,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
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
          and(eq(publishingJobsTable.status, "Scheduled"), lte(publishingJobsTable.scheduledAt, new Date())),
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

  await reconcileBatchProgress(updated.batchId);

  req.log.info({ jobId: id, extensionId: parsed.data.extensionId }, "Publishing job claimed");
  const [enriched] = await enrich([updated]);
  res.json(enriched);
});

const CompleteBody = z.object({
  extensionId: z.string().min(1),
  listingUrl: z.string().url().optional(),
});

// POST /publishing/jobs/:id/complete — extension reports success.
// Idempotent: Facebook publish is the source of truth. Never returns 409 after a
// successful Facebook publish. Accepts any non-terminal status so a mid-flight
// status transition never blocks completion.
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

  // Debug: always log pre-update state for post-mortem analysis.
  req.log.info({
    jobId: id,
    currentStatus: job.status,
    claimedByExtension: job.claimedByExtension,
    extensionId,
    listingUrl: listingUrl ?? null,
    attempts: job.attempts,
  }, "complete: pre-update state");

  // Ownership: only the extension that claimed the job may finalize it.
  // Skip ownership check if the job was never claimed (safety valve for edge cases).
  if (job.claimedByExtension && job.claimedByExtension !== extensionId) {
    req.log.warn({ jobId: id, claimedByExtension: job.claimedByExtension, extensionId },
      "complete: ownership mismatch");
    res.status(403).json({ error: "Job is claimed by another extension" });
    return;
  }

  // ── Already Published → idempotent 200 ───────────────────────────────────
  // Covers duplicate complete calls (e.g. retry after a network timeout).
  if (job.status === "Published") {
    if (!job.listingUrl && !listingUrl) {
      req.log.warn({ jobId: id, extensionId },
        "complete: Published job has no listing URL; moving to Needs Review");
      await moveJobToNeedsReviewWithoutListingUrl(job);
      res.status(422).json({
        error: "Published job has no Marketplace listing URL and was moved to Needs Review",
        code: "PUBLISHED_WITHOUT_LISTING_URL",
        needsReview: true,
        jobId: id,
      });
      return;
    }
    if (!job.listingUrl && listingUrl) {
      req.log.warn({ jobId: id, extensionId, listingUrl },
        "complete: Published job missing URL; backfilling live listing URL");
    } else {
      req.log.info({ jobId: id, extensionId }, "complete: already Published — idempotent 200");
      const [enriched] = await enrich([job]);
      res.json(enriched);
      return;
    }
  }

  if (!listingUrl) {
    req.log.warn({ jobId: id, status: job.status, extensionId },
      "complete: listingUrl missing; refusing to mark Published without live listing proof");
    await moveJobToNeedsReviewWithoutListingUrl(job);
    res.status(422).json({
      error: "listingUrl is required to mark a job Published",
      code: "MISSING_LISTING_URL",
      needsReview: true,
      jobId: id,
    });
    return;
  }

  // ── Terminal non-Published (Failed / Cancelled / Needs Review) ───────────
  // If the extension provides a listingUrl, Facebook published successfully —
  // trust that as the source of truth and force-mark Published.
  // If no listingUrl, we cannot confirm the publish; move to Needs Review so
  // the operator can resolve manually without blocking the queue.
  const TERMINAL_NON_PUBLISHED = ["Failed", "Cancelled", "Needs Review"];
  if (TERMINAL_NON_PUBLISHED.includes(job.status)) {
    if (!listingUrl) {
      req.log.warn({ jobId: id, status: job.status, extensionId },
        "complete: terminal job with no listingUrl — moving to Needs Review");
      await db
        .update(publishingJobsTable)
        .set({
          status: "Needs Review",
          needsReview: true,
          reviewReason: `Published on Facebook but result recording failed — job was "${job.status}" when complete was called`,
        })
        .where(eq(publishingJobsTable.id, id));
      res.json({
        ok: true,
        needsReview: true,
        message:
          `Job moved to Needs Review (was "${job.status}"). ` +
          "Verify the Facebook listing manually and use Mark Published in the extension.",
      });
      return;
    }
    // Has listingUrl → Facebook published → fall through to the publish block.
    req.log.warn({ jobId: id, status: job.status, extensionId, listingUrl },
      "complete: terminal job has listingUrl — Facebook is source of truth; force-publishing");
  }

  // ── Mark Published (any active state, or terminal-but-has-listingUrl) ────
  // Use an ID-only WHERE since ownership was already verified above.
  // This accepts any intermediate status (Queued, Claimed, Filling Form,
  // Publishing, Clicking Publish, Capturing URL, Retry, etc.) without 409.
  const now = new Date();
  const [updated] = await db
    .update(publishingJobsTable)
    .set({
      status: "Published",
      completedAt: now,
      failedReason: null,
      listingUrl: listingUrl ?? job.listingUrl,
      progressPercent: 100,
      currentStep: "Published on Marketplace",
    })
    .where(eq(publishingJobsTable.id, id))
    .returning();

  if (!updated) {
    req.log.error({ jobId: id, extensionId }, "complete: update returned 0 rows — job may have been deleted");
    res.status(500).json({ error: "Failed to update job — it may have been deleted" });
    return;
  }

  await db
    .update(vehiclesTable)
    .set({ status: "Published" })
    .where(eq(vehiclesTable.id, updated.vehicleId));

  // Upsert listing record. Keyed by (vehicle_id, channel) so concurrent
  // completions cannot create duplicates.
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

  // Create or update the Sales AI marketplace_listings record so the published
  // vehicle immediately appears in Sales AI → Marketplace Listings.
  await db
    .insert(marketplaceListingsTable)
    .values({
      vehicleId: updated.vehicleId,
      dealerId: updated.dealerId,
      listingUrl: listingUrl ?? null,
      publishedAt: now,
      status: "Live",
    })
    .onConflictDoUpdate({
      target: [marketplaceListingsTable.vehicleId],
      set: {
        listingUrl: listingUrl ?? null,
        publishedAt: now,
        status: "Live",
      },
    });

  await reconcileBatchProgress(updated.batchId);

  req.log.info({ jobId: id, listingUrl, previousStatus: job.status }, "complete: job Published successfully");
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
      assignedExtensionId: null,
      assignedAt: null,
    })
    .where(
      and(
        eq(publishingJobsTable.id, id),
        or(
          eq(publishingJobsTable.status, "Publishing"),
          eq(publishingJobsTable.status, "Filling Form"),
          eq(publishingJobsTable.status, "Ready for Review"),
          eq(publishingJobsTable.status, "Auto Publishing"),
          eq(publishingJobsTable.status, "Opening Facebook"),
        ),
        eq(publishingJobsTable.claimedByExtension, extensionId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Job is not in a publishing state" });
    return;
  }

  await reconcileBatchProgress(updated.batchId);

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
    .set({
      status: "Cancelled",
      failedReason: reason,
      claimedByExtension: null,
      assignedExtensionId: null,
      assignedAt: null,
    })
    .where(eq(publishingJobsTable.id, id))
    .returning();

  await reconcileBatchProgress(updated.batchId);

  req.log.info({ jobId: id, reason }, "Publishing job cancelled by operator");
  const [enriched] = await enrich([updated]);
  res.json({ job: enriched });
});

const NeedsReviewBody = z.object({
  reason: z.string().optional(),
});

// POST /publishing/jobs/:id/needs-review — operator repair path for a job that
// was incorrectly marked Published without a real Facebook listing URL.
router.post("/publishing/jobs/:id/needs-review", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const parsed = NeedsReviewBody.safeParse(req.body ?? {});
  const reason = parsed.success
    ? parsed.data.reason ?? "Manually moved to Needs Review by operator"
    : "Manually moved to Needs Review by operator";

  const [job] = await db
    .select()
    .from(publishingJobsTable)
    .where(eq(publishingJobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const updated = await moveJobToNeedsReviewWithoutListingUrl(job, reason);
  if (!updated) {
    res.status(500).json({ error: "Failed to move job to Needs Review" });
    return;
  }

  req.log.warn({ jobId: id, vehicleId: job.vehicleId, reason }, "Publishing job moved to Needs Review");
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
  // Vehicle IDs the operator has explicitly acknowledged and overridden a HOLD/RECONSIDER decision for
  gmOverrides: z.array(z.number().int()).optional().default([]),
});

router.post("/publishing/bulk-schedule", async (req, res) => {
  const parsed = BulkScheduleBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bulk-schedule request" });
    return;
  }
  const { vehicleIds, scheduledAt: scheduledAtStr, spacingMinutes, priority, notes: _notes, gmOverrides } = parsed.data;
  const gmOverrideSet = new Set(gmOverrides);

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds));

  if (vehicles.length === 0) {
    res.status(404).json({ error: "No matching vehicles found" });
    return;
  }

  // Resolve mode once for the whole batch: Controlled only if the global
  // launch switch AND the dealer's autoClickPublish setting both allow it.
  const [dealerSettings] = await db
    .select()
    .from(autoPublishSettingsTable)
    .where(eq(autoPublishSettingsTable.dealerId, DEALER_ID));
  const mode = resolvePublishMode(dealerSettings?.autoClickPublish ?? false);
  const isImmediate = !scheduledAtStr;

  // Skip vehicles that already have an active publishing job
  const activeJobs = await db
    .select({ vehicleId: publishingJobsTable.vehicleId })
    .from(publishingJobsTable)
    .where(
      and(
        inArray(publishingJobsTable.vehicleId, vehicleIds),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
      ),
    );
  const alreadyQueued = new Set(activeJobs.map((j) => j.vehicleId));
  const duplicateConflictIds = await getDuplicateConflictVehicleIds();
  const extensionOnline = mode === "Controlled" && isImmediate ? await isExtensionOnline() : true;

  // ── GM Coach + lot-location + duplicate-conflict + extension guardrails ────
  // Block any vehicle the GM has flagged HOLD or RECONSIDER unless the operator
  // explicitly acknowledged and overrode the decision; block unmapped lots and
  // Market Agent duplicate-listing conflicts; require an online extension
  // before dispatching Controlled Mode jobs immediately.
  const gmBlocked: { vehicleId: number; recommendation: string; confidence: number }[] = [];
  const otherBlocked: { vehicleId: number; code: string; reason: string }[] = [];
  const eligible = vehicles.filter((v) => {
    if (alreadyQueued.has(v.id)) return false;

    if (mode === "Controlled" && !extensionOnline) {
      otherBlocked.push({ vehicleId: v.id, code: "EXTENSION_OFFLINE", reason: "Extension offline" });
      return false;
    }
    const lotCity = v.lotLocation ? LOT_CITY_MAP[v.lotLocation] : undefined;
    if (!lotCity) {
      otherBlocked.push({ vehicleId: v.id, code: "UNKNOWN_LOT", reason: `Unmapped lot location "${v.lotLocation ?? "unknown"}"` });
      return false;
    }

    const gm = getCachedGmDecision(v.id);
    const overridden = gmOverrideSet.has(v.id);

    req.log.info({
      vehicleId: v.id,
      gmRecommendation: gm?.recommendation ?? "NO_REVIEW",
      gmConfidence: gm?.confidence ?? null,
      gmOverride: overridden,
      finalPublish: !gm || gm.recommendation === "PUBLISH" || overridden,
    }, "GM guardrail bulk-schedule check");

    const vLabel = `${v.year ?? ""} ${v.make} ${v.model}`.trim();
    if (gm && (gm.recommendation === "HOLD" || gm.recommendation === "RECONSIDER") && !overridden) {
      gmBlocked.push({ vehicleId: v.id, recommendation: gm.recommendation, confidence: gm.confidence });
      void recordGmDecision({
        vehicleId: v.id,
        vehicleLabel: vLabel,
        gmRecommendation: gm.recommendation,
        gmConfidence: gm.confidence,
        operatorAction: "batch_blocked",
        overridden: false,
        finalPublishStatus: "batch_blocked",
        notes: "Blocked during bulk-schedule",
      });
      return false;
    }
    if (duplicateConflictIds.has(v.id) && !overridden) {
      otherBlocked.push({ vehicleId: v.id, code: "DUPLICATE_LISTING_CONFLICT", reason: "Market Agent flagged a duplicate-listing conflict" });
      return false;
    }
    if (gm) {
      void recordGmDecision({
        vehicleId: v.id,
        vehicleLabel: vLabel,
        gmRecommendation: gm.recommendation,
        gmConfidence: gm.confidence,
        operatorAction: overridden ? "overridden" : "batch_published",
        overridden,
        finalPublishStatus: "published",
        notes: "Included in bulk-schedule",
      });
    }
    return true;
  });

  if (gmBlocked.length > 0) {
    req.log.warn({ gmBlocked }, "Bulk-schedule blocked vehicles due to GM Coach recommendation");
  }
  if (otherBlocked.length > 0) {
    req.log.warn({ otherBlocked }, "Bulk-schedule blocked vehicles due to lot/duplicate/extension guardrails");
  }

  const skipped = vehicles.length - eligible.length - gmBlocked.length - otherBlocked.length;

  if (eligible.length === 0) {
    res.status(202).json({ enqueued: 0, skipped, gmBlocked, otherBlocked });
    return;
  }

  const baseTime = scheduledAtStr ? new Date(scheduledAtStr) : new Date();
  const nowMs = Date.now();
  const enqueued: number[] = [];
  const claimableNow: number[] = [];

  for (let i = 0; i < eligible.length; i++) {
    const vehicle = eligible[i]!;
    const scheduledAt = new Date(baseTime.getTime() + i * spacingMinutes * 60_000);
    const jobDueNow = scheduledAt.getTime() <= nowMs + 1000;

    const [job] = await db
      .insert(publishingJobsTable)
      .values({
        vehicleId: vehicle.id,
        dealerId: vehicle.dealerId,
        listingVersionId: null,
        mode,
        status: jobDueNow ? "Queued" : "Scheduled",
        priority,
        scheduledAt,
        source: "bulk_schedule",
        approvedByUser: true,
      })
      .returning({ id: publishingJobsTable.id });

    enqueued.push(job!.id);
    if (jobDueNow) claimableNow.push(job!.id);
  }

  // If this is an immediate batch (not scheduled) and an extension is online,
  // assign the newly created jobs directly to the extension so the extension
  // can pick them up immediately without requiring the operator to press
  // "Check For Approved Job" in the popup.
  if (claimableNow.length > 0 && extensionOnline) {
    try {
      const conn = await pool.query(
        "select id, name, chrome_extension_id from extension_connections where status = 'online' and last_heartbeat_at > now() - interval '5 minutes' order by last_heartbeat_at desc limit 1",
      );
      const row = conn.rows[0];
      if (row) {
        const extensionId = row.chrome_extension_id ?? row.name ?? null;
        if (extensionId) {
          await db
            .update(publishingJobsTable)
            .set({ status: "Assigned", assignedExtensionId: extensionId, assignedAt: new Date() })
            .where(inArray(publishingJobsTable.id, claimableNow));
          req.log.info({ assigned: claimableNow.length, extensionId }, "Bulk-schedule: assigned due jobs to online extension");
        }
      }
    } catch (err) {
      req.log.warn({ err }, "Bulk-schedule: failed to auto-assign jobs to extension — will remain queued");
    }
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
  gmOverride: z.boolean().optional().default(false),
});

router.post("/publishing/jobs/publish-now", async (req, res) => {
  const parsed = PublishNowBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "vehicleId is required" });
    return;
  }
  const { vehicleId, gmOverride } = parsed.data;
  const DEALER_ID = 1;

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, DEALER_ID)));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Publish Now bypasses batching but never bypasses the guardrails: real
  // inventory, mapped lot location, GM Coach, duplicate conflicts, and (for
  // Controlled Mode) an online extension all must pass before a job is created.
  const mode = resolvePublishMode(true);

  // Cancel stale active jobs (>10 min old) for this DEALER before creating a new one.
  // Any stale job from any vehicle blocks the extension queue — clear them all.
  // Failed jobs are intentionally excluded; they do not block the queue.
  const STALE_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);
  await db
    .update(publishingJobsTable)
    .set({ status: "Cancelled", failedReason: "Auto-cancelled: stale job older than 10 minutes" })
    .where(
      and(
        eq(publishingJobsTable.dealerId, DEALER_ID),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
        lt(publishingJobsTable.createdAt, STALE_THRESHOLD),
      ),
    );

  // If a RECENT active job already exists, return it (idempotent)
  const [existing] = await db
    .select()
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.vehicleId, vehicleId),
        inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
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

  const guardrail = await checkPublishGuardrails({
    vehicle: { id: vehicle.id, status: vehicle.status, lotLocation: vehicle.lotLocation },
    gmOverride,
    requireExtensionOnline: mode === "Controlled",
  });
  if (!guardrail.ok) {
    req.log.warn({ vehicleId, code: guardrail.code, reason: guardrail.reason }, "Publish Now blocked by guardrail");
    res.status(422).json({ error: guardrail.reason, code: guardrail.code });
    return;
  }

  const [job] = await db
    .insert(publishingJobsTable)
    .values({
      vehicleId,
      dealerId: DEALER_ID,
      listingVersionId: null,
      mode,
      status: "Queued",
      priority: 100,
      progressPercent: 0,
      source: "publish_now",
      approvedByUser: true,
    })
    .returning();

  req.log.info({ vehicleId, jobId: job.id, source: "publish_now", mode }, "Publish Now job created");
  // If Controlled Mode and an extension is online, assign the new job immediately
  // so the extension will pick it up without manual intervention.
  if (mode === "Controlled") {
    try {
      const conn = await pool.query(
        "select id, name, chrome_extension_id from extension_connections where status = 'online' and last_heartbeat_at > now() - interval '5 minutes' order by last_heartbeat_at desc limit 1",
      );
      const row = conn.rows[0];
      if (row) {
        const extensionId = row.chrome_extension_id ?? row.name ?? null;
        if (extensionId) {
          await db
            .update(publishingJobsTable)
            .set({ status: "Assigned", assignedExtensionId: extensionId, assignedAt: new Date() })
            .where(eq(publishingJobsTable.id, job.id));
          req.log.info({ jobId: job.id, extensionId }, "Publish Now: job assigned to online extension");
        }
      }
    } catch (err) {
      req.log.warn({ err }, "Publish Now: failed to auto-assign job to extension — will remain queued");
    }
  }

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
      assignedExtensionId: null,
      assignedAt: null,
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

  const [vehicle] = await db
    .select({ id: vehiclesTable.id, aiPhotoStatus: vehiclesTable.aiPhotoStatus, aiPhotoSetId: vehiclesTable.aiPhotoSetId })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, job.vehicleId));

  const images = await getVehiclePhotos(
    job.vehicleId,
    vehicle?.aiPhotoSetId ?? null,
    vehicle?.aiPhotoStatus ?? null,
  );

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

  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    req.log.warn({ jobId: id, index, imageUrl, contentType }, "Photo proxy: upstream returned non-image content");
    res.status(502).json({ error: `Upstream image returned non-image content type ${contentType}` });
    return;
  }

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
  dealerId: z.number().int().positive().optional().default(DEALER_ID),
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
    inArray(publishingJobsTable.status, [...ACTIVE_PUBLISHING_JOB_STATUSES]),
    lt(publishingJobsTable.createdAt, cutoff),
    eq(publishingJobsTable.dealerId, dealerId),
  ];

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
  dealerId: z.number().int().positive().optional().default(DEALER_ID),
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
    eq(publishingJobsTable.dealerId, dealerId),
  ];

  const cancelled = await db
    .update(publishingJobsTable)
    .set({ status: "Cancelled", failedReason: `Cancelled by cancel-stale after ${olderThanMinutes} min` })
    .where(and(...conditions))
    .returning({ id: publishingJobsTable.id, vehicleId: publishingJobsTable.vehicleId });

  req.log.info({ count: cancelled.length, olderThanMinutes, dealerId }, "Stale jobs cancelled");
  res.json({ cancelled: cancelled.length, ids: cancelled.map((j) => j.id) });
});

export default router;
