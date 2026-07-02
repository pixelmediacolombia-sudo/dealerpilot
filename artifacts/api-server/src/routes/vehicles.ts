import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  vehiclesTable,
  vehicleImagesTable,
  vehicleChangesTable,
  type Vehicle,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";

const router: IRouter = Router();

function toVehicle(
  v: Vehicle,
  primaryImageUrl: string | null,
  imageCount: number,
) {
  return {
    id: v.id,
    dealerId: v.dealerId,
    vin: v.vin,
    stockNumber: v.stockNumber ?? null,
    year: v.year ?? null,
    make: v.make,
    model: v.model,
    trim: v.trim ?? null,
    mileage: v.mileage ?? null,
    price: v.price ?? null,
    exteriorColor: v.exteriorColor ?? null,
    interiorColor: v.interiorColor ?? null,
    bodyStyle: v.bodyStyle ?? null,
    transmission: v.transmission ?? null,
    fuelType: v.fuelType ?? null,
    description: v.description ?? null,
    vdpUrl: v.vdpUrl ?? null,
    lotLocation: v.lotLocation ?? null,
    status: v.status,
    primaryImageUrl,
    imageCount,
    lastSyncAt: v.lastSyncAt ? v.lastSyncAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

async function attachImages(vehicles: Vehicle[]) {
  if (vehicles.length === 0) return [];
  const ids = vehicles.map((v) => v.id);
  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(inArray(vehicleImagesTable.vehicleId, ids));
  const byVehicle = new Map<number, { url: string; position: number }[]>();
  for (const im of images) {
    const list = byVehicle.get(im.vehicleId) ?? [];
    list.push({ url: im.url, position: im.position });
    byVehicle.set(im.vehicleId, list);
  }
  return vehicles.map((v) => {
    const list = (byVehicle.get(v.id) ?? []).sort((a, b) => a.position - b.position);
    return toVehicle(v, list[0]?.url ?? null, list.length);
  });
}

router.get("/vehicles/stats", async (req, res) => {
  const rows = await db
    .select({ status: vehiclesTable.status, lotLocation: vehiclesTable.lotLocation })
    .from(vehiclesTable);
  const by = (s: string) => rows.filter((r) => r.status === s).length;

  // Location breakdown — only count active inventory (not sold/removed/archived)
  const active = rows.filter((r) => !["Sold/Removed", "Removed", "Archived"].includes(r.status));
  const manassas = active.filter((r) => r.lotLocation && r.lotLocation.toLowerCase().includes("manassas")).length;
  const fredericksburg = active.filter((r) => r.lotLocation && r.lotLocation.toLowerCase().includes("fredericksburg")).length;
  const unknownLocation = active.filter((r) => !r.lotLocation || (!r.lotLocation.toLowerCase().includes("manassas") && !r.lotLocation.toLowerCase().includes("fredericksburg"))).length;

  res.json({
    total: rows.length,
    active: by("Active"),
    new: by("New"),
    readyToPublish: by("Ready to Publish"),
    published: by("Published"),
    soldRemoved: by("Sold/Removed"),
    priceChanged: by("Price Changed"),
    locationBreakdown: { manassas, fredericksburg, unknownLocation },
  });
});

router.get("/vehicles", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "newest";

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(vehiclesTable.status, status));
  if (q) {
    const like = `%${q}%`;
    const search = or(
      ilike(vehiclesTable.vin, like),
      ilike(vehiclesTable.stockNumber, like),
      ilike(vehiclesTable.make, like),
      ilike(vehiclesTable.model, like),
      ilike(vehiclesTable.trim, like),
    );
    if (search) conditions.push(search);
  }

  let orderBy: SQL;
  switch (sort) {
    case "price_high":
      orderBy = desc(vehiclesTable.price);
      break;
    case "price_low":
      orderBy = asc(vehiclesTable.price);
      break;
    case "mileage_low":
      orderBy = asc(vehiclesTable.mileage);
      break;
    default:
      orderBy = desc(vehiclesTable.createdAt);
  }

  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderBy);

  const vehicles = await attachImages(rows);
  res.json({ vehicles });
});

router.get("/vehicles/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, id))
    .orderBy(asc(vehicleImagesTable.position));

  const changes = await db
    .select()
    .from(vehicleChangesTable)
    .where(eq(vehicleChangesTable.vehicleId, id))
    .orderBy(desc(vehicleChangesTable.createdAt));

  const [withImages] = await attachImages([vehicle]);

  res.json({
    vehicle: withImages,
    images: images.map((im) => ({
      id: im.id,
      url: im.url,
      position: im.position,
      category: im.category ?? null,
      isPrimary: im.isPrimary,
    })),
    changes: changes.map((c) => ({
      id: c.id,
      changeType: c.changeType,
      field: c.field ?? null,
      oldValue: c.oldValue ?? null,
      newValue: c.newValue ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    sourceRaw: vehicle.sourceRaw ?? null,
  });
});

const BulkActionBody = z.object({
  vehicleIds: z.array(z.number().int().positive()).min(1).max(100),
  action: z.enum(["mark_ready", "mark_sold", "archive", "mark_new"]),
});

const STATUS_MAP: Record<string, string> = {
  mark_ready: "Ready to Publish",
  mark_sold: "Sold/Removed",
  archive: "Archived",
  mark_new: "New",
};

router.post("/vehicles/bulk", async (req, res) => {
  const parsed = BulkActionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bulk action request" });
    return;
  }
  const { vehicleIds, action } = parsed.data;
  const status = STATUS_MAP[action]!;

  const updated = await db
    .update(vehiclesTable)
    .set({ status })
    .where(inArray(vehiclesTable.id, vehicleIds))
    .returning({ id: vehiclesTable.id });

  if (updated.length > 0) {
    await db.insert(vehicleChangesTable).values(
      updated.map((v) => ({
        vehicleId: v.id,
        changeType: "status_change",
        field: "status",
        oldValue: null,
        newValue: status,
      })),
    );
  }

  req.log.info({ vehicleIds, action, status, updated: updated.length }, "Bulk vehicle action");
  res.json({ updated: updated.length });
});

const StatusBody = z.object({ status: z.string().min(1) });

router.patch("/vehicles/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = StatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const [updated] = await db
    .update(vehiclesTable)
    .set({ status: parsed.data.status })
    .where(eq(vehiclesTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  await db.insert(vehicleChangesTable).values({
    vehicleId: id,
    changeType: "status_change",
    field: "status",
    oldValue: null,
    newValue: parsed.data.status,
  });
  req.log.info({ vehicleId: id, status: parsed.data.status }, "Updated vehicle status");
  const [withImages] = await attachImages([updated]);
  res.json(withImages);
});

export default router;
