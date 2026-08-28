import { Router, type IRouter, type Request, type Response } from "express";
import {
  autoPublishSettingsTable,
  db,
  extensionConnectionsTable,
  feedIngestionsTable,
  listingsTable,
  marketplaceListingsTable,
  publishingJobsTable,
  systemTimelineEventsTable,
  vehicleImagesTable,
  vehiclesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ACTIVE_PUBLISHING_JOB_STATUSES } from "../publishing/controlledMode";
import { vehicleOperationalColumns } from "../lib/vehicleColumns";

const router: IRouter = Router();
const DEFAULT_DEALER_ID = 1;
const PUBLISHING_ALERT_DAYS = 4;
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

type CleanupEvent = { action?: string; listingId?: number; error?: string };

function parseCleanupEvent(value: string | null): CleanupEvent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CleanupEvent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function vehicleLabel(vehicle: { year: number | null; make: string; model: string; trim: string | null }) {
  return `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`.trim();
}

function maxDate(values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    return !latest || value.getTime() > latest.getTime() ? value : latest;
  }, null);
}

router.get("/command-center/alerts", async (req: Request, res: Response) => {
  try {
    const dealerId = Number(req.query["dealerId"] ?? DEFAULT_DEALER_ID);
    const location = typeof req.query["location"] === "string" ? req.query["location"] : "";
    if (!Number.isInteger(dealerId) || dealerId <= 0) {
      res.status(400).json({ error: "Invalid dealerId" });
      return;
    }

    const vehicleConditions = [eq(vehiclesTable.dealerId, dealerId)];
    if (location) vehicleConditions.push(eq(vehiclesTable.lotLocation, location));

    const [vehicles, marketplaceRows, cleanupEvents, jobs, publishedJobs, publishedListings, extensionRows, settings, ingestions] =
      await Promise.all([
        db.select(vehicleOperationalColumns).from(vehiclesTable).where(and(...vehicleConditions)),
        db
          .select({ listing: marketplaceListingsTable, vehicle: vehicleOperationalColumns })
          .from(marketplaceListingsTable)
          .innerJoin(vehiclesTable, eq(vehiclesTable.id, marketplaceListingsTable.vehicleId))
          .where(eq(marketplaceListingsTable.dealerId, dealerId)),
        db
          .select()
          .from(systemTimelineEventsTable)
          .where(eq(systemTimelineEventsTable.category, "marketplace_cleanup"))
          .orderBy(desc(systemTimelineEventsTable.createdAt))
          .limit(500),
        db.select().from(publishingJobsTable).where(eq(publishingJobsTable.dealerId, dealerId)),
        db
          .select({ completedAt: publishingJobsTable.completedAt })
          .from(publishingJobsTable)
          .where(and(eq(publishingJobsTable.dealerId, dealerId), eq(publishingJobsTable.status, "Published"))),
        db
          .select({ publishedAt: listingsTable.publishedAt, vehicleId: listingsTable.vehicleId })
          .from(listingsTable)
          .innerJoin(vehiclesTable, eq(vehiclesTable.id, listingsTable.vehicleId))
          .where(and(eq(listingsTable.channel, "marketplace"), eq(listingsTable.status, "Published"), eq(vehiclesTable.dealerId, dealerId))),
        db.select().from(extensionConnectionsTable),
        db.select().from(autoPublishSettingsTable).where(eq(autoPublishSettingsTable.dealerId, dealerId)),
        db.select().from(feedIngestionsTable).where(eq(feedIngestionsTable.dealerId, dealerId)).orderBy(desc(feedIngestionsTable.ingestedAt)).limit(7),
      ]);

    const latestEventByListingId = new Map<number, { action?: string; createdAt: Date; error?: string }>();
    for (const event of cleanupEvents) {
      const detail = parseCleanupEvent(event.detailJson);
      if (!detail?.listingId || latestEventByListingId.has(detail.listingId)) continue;
      latestEventByListingId.set(detail.listingId, {
        action: detail.action,
        createdAt: event.createdAt,
        error: detail.error,
      });
    }

    const alerts: Array<Record<string, unknown>> = [];
    for (const row of marketplaceRows) {
      const { listing, vehicle } = row;
      if (vehicle.status !== "Sold/Removed" || !listing.listingUrl) continue;
      if (listing.status !== "Live" && listing.status !== "Sold") continue;

      const lastEvent = latestEventByListingId.get(listing.id);
      const confirmed = lastEvent?.action === "completed" && lastEvent.createdAt.getTime() >= listing.updatedAt.getTime();
      if (confirmed) continue;

      alerts.push({
        id: `marketplace-cleanup-${listing.id}`,
        kind: "marketplace_cleanup",
        severity: listing.status === "Live" ? "critical" : "warning",
        title: listing.status === "Live" ? "La publicación todavía está activa en Marketplace" : "La acción de vendido está pendiente en Marketplace",
        message:
          listing.status === "Live"
            ? "Vehicle was removed from inventory, but Facebook still needs the sold action."
            : lastEvent?.action === "failed"
              ? `Facebook action failed${lastEvent.error ? `: ${lastEvent.error}` : "."}`
              : "DealerPilot requested the Facebook sold action and is waiting for confirmation.",
        vehicleId: vehicle.id,
        vehicleLabel: vehicleLabel(vehicle),
        stockNumber: vehicle.stockNumber,
        listingId: listing.id,
        listingUrl: listing.listingUrl,
        detectedAt: (vehicle.lastSyncAt ?? vehicle.updatedAt).toISOString(),
        actionPath: "/listings?tab=to-remove",
      });
    }

    const imageCounts = new Map<number, number>();
    if (vehicles.length > 0) {
      const images = await db
        .select({ vehicleId: vehicleImagesTable.vehicleId })
        .from(vehicleImagesTable)
        .where(inArray(vehicleImagesTable.vehicleId, vehicles.map((vehicle) => vehicle.id)));
      for (const image of images) imageCounts.set(image.vehicleId, (imageCounts.get(image.vehicleId) ?? 0) + 1);
    }

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const genericListings = vehicleIds.length > 0
      ? await db
          .select({ vehicleId: listingsTable.vehicleId, status: listingsTable.status })
          .from(listingsTable)
          .where(and(eq(listingsTable.channel, "marketplace"), inArray(listingsTable.vehicleId, vehicleIds)))
      : [];
    const listingByVehicle = new Map(genericListings.map((listing) => [listing.vehicleId, listing]));
    const eligibleVehicles = vehicles.filter((vehicle) =>
      !["Published", "Sold/Removed", "Sold", "Removed", "Archived"].includes(vehicle.status) &&
      Boolean(vehicle.vin && vehicle.year && vehicle.price && vehicle.mileage && vehicle.lotLocation) &&
      (imageCounts.get(vehicle.id) ?? 0) >= 5 &&
      listingByVehicle.get(vehicle.id)?.status !== "Published",
    );
    const oldestEligibleAt = eligibleVehicles.reduce<Date | null>((oldest, vehicle) => {
      const date = vehicle.firstSeenAt ?? vehicle.createdAt;
      return !oldest || date.getTime() < oldest.getTime() ? date : oldest;
    }, null);

    const latestPublishedAt = maxDate([
      ...publishedJobs.map((job) => job.completedAt),
      ...publishedListings.map((listing) => listing.publishedAt),
      ...marketplaceRows.map((row) => row.listing.publishedAt),
    ]);
    const activeJobs = jobs.filter((job) => ACTIVE_PUBLISHING_JOB_STATUSES.includes(job.status as never));
    const needsReviewCount = jobs.filter((job) => job.status === "Needs Review").length;
    const failedCount = jobs.filter((job) => job.status === "Failed").length;
    const extensionOnline = extensionRows.some(
      (connection) => connection.status === "online" && connection.lastHeartbeatAt && Date.now() - connection.lastHeartbeatAt.getTime() <= ONLINE_THRESHOLD_MS,
    );
    const autoPublishEnabled = settings[0]?.enabled === true;
    const hasAutoPublishWork = jobs.some((job) => job.source === "auto_publish_batch" && ACTIVE_PUBLISHING_JOB_STATUSES.includes(job.status as never));
    const monitorsPublishing = autoPublishEnabled || hasAutoPublishWork || activeJobs.length > 0;
    const publishAgeDays = latestPublishedAt
      ? Math.floor((Date.now() - latestPublishedAt.getTime()) / (24 * 60 * 60 * 1000))
      : oldestEligibleAt
        ? Math.floor((Date.now() - oldestEligibleAt.getTime()) / (24 * 60 * 60 * 1000))
        : null;
    const publishingStalled = monitorsPublishing && eligibleVehicles.length > 0 && publishAgeDays !== null && publishAgeDays >= PUBLISHING_ALERT_DAYS;

    if (publishingStalled) {
      const reason = !extensionOnline
        ? "La extensión de Marketplace no está conectada."
        : activeJobs.length > 0
          ? `${activeJobs.length} job${activeJobs.length === 1 ? " está" : "s están"} pendiente${activeJobs.length === 1 ? "" : "s"} en la cola.`
          : needsReviewCount > 0
            ? `${needsReviewCount} vehículo${needsReviewCount === 1 ? " requiere" : "s requieren"} revisión antes de publicar.`
            : "Hay vehículos elegibles sin una publicación confirmada.";
      alerts.push({
        id: "publishing-stalled",
        kind: "publishing_stalled",
        severity: "critical",
        title: `No hay publicaciones confirmadas hace ${publishAgeDays} días`,
        message: reason,
        lastPublishedAt: latestPublishedAt?.toISOString() ?? null,
        eligibleVehicleCount: eligibleVehicles.length,
        activeJobCount: activeJobs.length,
        needsReviewCount,
        failedCount,
        extensionOnline,
        actionPath: "/listings?tab=queue",
      });
    }

    const latestIngestion = ingestions[0];
    const feedGuardrailAlert = latestIngestion && latestIngestion.status !== "ok" && latestIngestion.status !== "running";
    if (feedGuardrailAlert) {
      alerts.push({
        id: `feed-ingestion-${latestIngestion.id}`,
        kind: "feed_guardrail",
        severity: "critical",
        title: latestIngestion.status === "aborted_empty" ? "La ingesta de inventario llegó vacía" : "La ingesta de inventario fue bloqueada",
        message: latestIngestion.abortReason ?? "No se modificó el inventario para proteger los listings de Marketplace.",
        detectedAt: latestIngestion.ingestedAt.toISOString(),
        actionPath: "/inventory",
      });
    }

    res.json({
      alerts: alerts.sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1)),
      summary: {
        marketplaceCleanupCount: alerts.filter((alert) => alert.kind === "marketplace_cleanup").length,
        toRemoveCount: alerts.filter((alert) => alert.kind === "marketplace_cleanup").length,
        feedGuardrailAlert: Boolean(feedGuardrailAlert),
        publishingStalled,
        lastPublishedAt: latestPublishedAt?.toISOString() ?? null,
        publishAgeDays,
        eligibleVehicleCount: eligibleVehicles.length,
        activeJobCount: activeJobs.length,
        extensionOnline,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /command-center/alerts failed");
    res.status(500).json({ error: "Failed to load Command Center alerts" });
  }
});

export default router;
