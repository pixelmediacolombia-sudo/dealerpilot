import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  marketplaceListingsTable,
  listingsTable,
  publishingJobsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

const router: IRouter = Router();

const ReconcilePublishedBody = z.object({
  dealerId: z.number().int().positive().optional().default(1),
  publishedVehicleIds: z.array(z.number().int().positive()).min(1),
  note: z.string().optional(),
});

router.post("/marketplace-listings/reconcile-published", async (req: Request, res: Response) => {
  try {
    const parsed = ReconcilePublishedBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const { dealerId, publishedVehicleIds, note } = parsed.data;
    const keepIds = [...new Set(publishedVehicleIds)];
    const now = new Date();
    const liveRows = await db
      .select({ vehicleId: marketplaceListingsTable.vehicleId })
      .from(marketplaceListingsTable)
      .where(and(eq(marketplaceListingsTable.dealerId, dealerId), eq(marketplaceListingsTable.status, "Live")));
    const demoteIds = liveRows.map((row) => row.vehicleId).filter((vehicleId) => !keepIds.includes(vehicleId));

    await db.transaction(async (tx) => {
      await tx
        .insert(marketplaceListingsTable)
        .values(
          keepIds.map((vehicleId) => ({
            vehicleId,
            dealerId,
            status: "Live",
            publishedAt: now,
            notes: note ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [marketplaceListingsTable.vehicleId],
          set: {
            dealerId,
            status: "Live",
            publishedAt: now,
            notes: note ?? null,
          },
        });

      await tx
        .insert(listingsTable)
        .values(
          keepIds.map((vehicleId) => ({
            vehicleId,
            channel: "marketplace",
            status: "Published",
            publishedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [listingsTable.vehicleId, listingsTable.channel],
          set: {
            status: "Published",
            publishedAt: now,
          },
        });

      await tx
        .update(vehiclesTable)
        .set({ status: "Published" })
        .where(inArray(vehiclesTable.id, keepIds));

      await tx
        .update(publishingJobsTable)
        .set({ status: "Published", completedAt: now, currentStep: "Published", progressPercent: 100 })
        .where(and(eq(publishingJobsTable.dealerId, dealerId), inArray(publishingJobsTable.vehicleId, keepIds), ne(publishingJobsTable.status, "Published")));

      if (demoteIds.length > 0) {
        await tx
          .update(marketplaceListingsTable)
          .set({
            status: "Needs Review",
            publishedAt: null,
            listingUrl: null,
            notes: note ?? "Demoted during Marketplace live-list reconciliation.",
          })
          .where(and(eq(marketplaceListingsTable.dealerId, dealerId), inArray(marketplaceListingsTable.vehicleId, demoteIds)));

        await tx
          .update(listingsTable)
          .set({ status: "Needs Review", publishedAt: null, externalUrl: null })
          .where(and(eq(listingsTable.channel, "marketplace"), inArray(listingsTable.vehicleId, demoteIds)));

        await tx
          .update(vehiclesTable)
          .set({ status: "Active" })
          .where(inArray(vehiclesTable.id, demoteIds));

        await tx
          .update(publishingJobsTable)
          .set({
            status: "Needs Review",
            needsReview: true,
            reviewReason: note ?? "Not present in operator-confirmed Marketplace live list.",
            listingUrl: null,
            completedAt: null,
            currentStep: "Needs Review",
            progressPercent: 100,
          })
          .where(and(eq(publishingJobsTable.dealerId, dealerId), inArray(publishingJobsTable.vehicleId, demoteIds)));
      }
    });

    res.json({ ok: true, keptLiveVehicleIds: keepIds, demotedVehicleIds: demoteIds });
  } catch (err) {
    req.log.error({ err }, "POST /marketplace-listings/reconcile-published failed");
    res.status(500).json({ error: "Failed to reconcile marketplace listings" });
  }
});

// ── List marketplace listings ─────────────────────────────────────────────────
// GET /api/marketplace-listings?dealerId=1&status=Live
// Returns all marketplace listings joined with vehicle + primary thumbnail.
router.get("/marketplace-listings", async (req: Request, res: Response) => {
  try {
    const dealerId = Number(req.query["dealerId"] ?? 1);
    const statusFilter = req.query["status"] as string | undefined;
    const locationFilter = req.query["location"] as string | undefined;

    const rows = await db
      .select({
        listing: marketplaceListingsTable,
        vehicle: {
          id: vehiclesTable.id,
          year: vehiclesTable.year,
          make: vehiclesTable.make,
          model: vehiclesTable.model,
          trim: vehiclesTable.trim,
          price: vehiclesTable.price,
          mileage: vehiclesTable.mileage,
          stockNumber: vehiclesTable.stockNumber,
          vin: vehiclesTable.vin,
          bodyStyle: vehiclesTable.bodyStyle,
          status: vehiclesTable.status,
        },
      })
      .from(marketplaceListingsTable)
      .innerJoin(vehiclesTable, eq(vehiclesTable.id, marketplaceListingsTable.vehicleId))
      .where(
        and(
          eq(marketplaceListingsTable.dealerId, dealerId),
          statusFilter ? eq(marketplaceListingsTable.status, statusFilter) : undefined,
          locationFilter ? eq(vehiclesTable.lotLocation, locationFilter) : undefined,
        ),
      )
      .orderBy(desc(marketplaceListingsTable.publishedAt));

    if (rows.length === 0) {
      res.json({ listings: [] });
      return;
    }

    // Fetch primary image for each vehicle in one query
    const vehicleIds = rows.map((r) => r.vehicle.id);
    const primaryImages = await db
      .select({
        vehicleId: vehicleImagesTable.vehicleId,
        url: vehicleImagesTable.url,
      })
      .from(vehicleImagesTable)
      .where(
        and(
          eq(vehicleImagesTable.position, 0),
          vehicleIds.length === 1
            ? eq(vehicleImagesTable.vehicleId, vehicleIds[0]!)
            : or(...vehicleIds.map((id) => eq(vehicleImagesTable.vehicleId, id))),
        ),
      );

    const primaryImageMap = new Map(primaryImages.map((i) => [i.vehicleId, i.url]));

    const listings = rows.map((r) => ({
      ...r.listing,
      publishedAt: r.listing.publishedAt?.toISOString() ?? null,
      lastMessageAt: r.listing.lastMessageAt?.toISOString() ?? null,
      createdAt: r.listing.createdAt.toISOString(),
      updatedAt: r.listing.updatedAt.toISOString(),
      vehicle: r.vehicle,
      thumbnailUrl: primaryImageMap.get(r.vehicle.id) ?? null,
    }));

    res.json({ listings });
  } catch (err) {
    req.log.error({ err }, "GET /marketplace-listings failed");
    res.status(500).json({ error: "Failed to fetch marketplace listings" });
  }
});

// ── Get single listing ────────────────────────────────────────────────────────
router.get("/marketplace-listings/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db
      .select()
      .from(marketplaceListingsTable)
      .where(eq(marketplaceListingsTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "GET /marketplace-listings/:id failed");
    res.status(500).json({ error: "Failed to fetch listing" });
  }
});

// ── Update listing status / assignee / lead quality ──────────────────────────
// PATCH /api/marketplace-listings/:id
const PatchBody = z.object({
  status: z.enum(["Live", "Needs Review", "Appointment", "Sold", "Failed"]).optional(),
  assignedTo: z.string().optional(),
  leadQuality: z.enum(["Hot", "Warm", "Cold"]).optional(),
  notes: z.string().optional(),
});

router.patch("/marketplace-listings/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = PatchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const [existing] = await db
      .select()
      .from(marketplaceListingsTable)
      .where(eq(marketplaceListingsTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    const { status, assignedTo, leadQuality, notes } = parsed.data;
    if (status !== undefined) updateFields["status"] = status;
    if (assignedTo !== undefined) updateFields["assignedTo"] = assignedTo;
    if (leadQuality !== undefined) updateFields["leadQuality"] = leadQuality;
    if (notes !== undefined) updateFields["notes"] = notes;

    if (Object.keys(updateFields).length === 0) {
      res.json(existing);
      return;
    }

    const [updated] = await db
      .update(marketplaceListingsTable)
      .set(updateFields)
      .where(eq(marketplaceListingsTable.id, id))
      .returning();

    req.log.info({ listingId: id, ...updateFields }, "marketplace-listing updated");
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /marketplace-listings/:id failed");
    res.status(500).json({ error: "Failed to update listing" });
  }
});

export default router;
