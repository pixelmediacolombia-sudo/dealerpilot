import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, vehiclesTable, type Vehicle } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getVehiclePhotos } from "../features/publishing/infrastructure/publishingRepository";

const DEALER_ID = 1;
const ALPHA_PAGE_ID = "265746649947861";
const ALPHA_BUSINESS_ID = "7725528554132936";
const ALPHA_PAGE_NAME = "Alpha MotorSports: Easy Credit / Credito Facil";
const ALPHA_COMPOSER_URL =
  `https://business.facebook.com/latest/composer/?asset_id=${ALPHA_PAGE_ID}` +
  `&business_id=${ALPHA_BUSINESS_ID}&context_ref=HOME&nav_ref=internal_nav&ref=dealerpilot_alpha_page`;
const PAGE_PHOTO_LIMIT = 10;

const router: IRouter = Router();

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().trim().max(80).optional().default(""),
});

function vehicleTitle(vehicle: Vehicle): string {
  return `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`.trim();
}

function formatMoney(value: number | null): string | null {
  if (!value || value <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMiles(value: number | null): string | null {
  if (value === null || value === undefined || value < 0) return null;
  return `${new Intl.NumberFormat("en-US").format(value)} miles`;
}

function normalizeForSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildPagePostText(vehicle: Vehicle): string {
  const title = vehicleTitle(vehicle);
  const lines = [
    `${title}`,
    "",
    formatMoney(vehicle.price) ? `Price: ${formatMoney(vehicle.price)}` : null,
    formatMiles(vehicle.mileage) ? `Mileage: ${formatMiles(vehicle.mileage)}` : null,
    vehicle.vin ? `VIN: ${vehicle.vin}` : null,
    vehicle.stockNumber ? `Stock #: ${vehicle.stockNumber}` : null,
    vehicle.exteriorColor ? `Exterior: ${vehicle.exteriorColor}` : null,
    vehicle.interiorColor ? `Interior: ${vehicle.interiorColor}` : null,
    "",
    "Easy credit options available.",
    "Opciones de credito facil disponibles.",
    "",
    vehicle.vdpUrl ? `More details: ${vehicle.vdpUrl}` : null,
    "",
    "Message Alpha MotorSports for availability and financing details.",
  ];
  return lines.filter((line) => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function loadVehicle(vehicleId: number) {
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId))
    .limit(1);

  if (!vehicle || vehicle.dealerId !== DEALER_ID) return null;
  const photos = await getVehiclePhotos(vehicle.id, vehicle.aiPhotoSetId, vehicle.aiPhotoStatus);
  return { vehicle, photos: photos.filter((photo) => Boolean(photo.url)).slice(0, PAGE_PHOTO_LIMIT) };
}

function readiness(vehicle: Vehicle, photoCount: number) {
  const missing: string[] = [];
  if (!vehicle.price || vehicle.price <= 0) missing.push("price");
  if (photoCount <= 0) missing.push("photos");
  return {
    ready: missing.length === 0,
    missing,
  };
}

router.get("/alpha-page-publisher/vehicles", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }

  const { limit, search } = parsed.data;
  const searchNeedle = normalizeForSearch(search);
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID))
    .orderBy(desc(vehiclesTable.updatedAt))
    .limit(120);

  const filtered = rows
    .filter((vehicle) => {
      if (!searchNeedle) return true;
      return normalizeForSearch(
        [
          vehicle.id,
          vehicle.year,
          vehicle.make,
          vehicle.model,
          vehicle.trim,
          vehicle.vin,
          vehicle.stockNumber,
        ]
          .filter(Boolean)
          .join(" "),
      ).includes(searchNeedle);
    })
    .slice(0, limit);

  res.json({
    target: {
      pageId: ALPHA_PAGE_ID,
      businessId: ALPHA_BUSINESS_ID,
      pageName: ALPHA_PAGE_NAME,
      composerUrl: ALPHA_COMPOSER_URL,
    },
    vehicles: filtered.map((vehicle) => ({
      id: vehicle.id,
      label: vehicleTitle(vehicle),
      vin: vehicle.vin,
      stockNumber: vehicle.stockNumber,
      price: vehicle.price,
      mileage: vehicle.mileage,
      status: vehicle.status,
      updatedAt: vehicle.updatedAt.toISOString(),
    })),
  });
});

router.get("/alpha-page-publisher/vehicles/:id/payload", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid vehicle id" });
    return;
  }

  const loaded = await loadVehicle(id);
  if (!loaded) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const { vehicle, photos } = loaded;
  const state = readiness(vehicle, photos.length);
  res.json({
    target: {
      channel: "facebook_page",
      pageId: ALPHA_PAGE_ID,
      businessId: ALPHA_BUSINESS_ID,
      pageName: ALPHA_PAGE_NAME,
      composerUrl: ALPHA_COMPOSER_URL,
      publishMode: "human_review",
    },
    vehicle: {
      id: vehicle.id,
      label: vehicleTitle(vehicle),
      vin: vehicle.vin,
      stockNumber: vehicle.stockNumber,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      price: vehicle.price,
      mileage: vehicle.mileage,
      vdpUrl: vehicle.vdpUrl,
      status: vehicle.status,
    },
    readiness: state,
    post: {
      text: buildPagePostText(vehicle),
      photoCount: photos.length,
      requiresHumanPublish: true,
      warning:
        "DealerPilot prepares the Business Suite draft only. A human must review the page target, photos, text, and click Publish manually.",
    },
    images: photos.map((photo, index) => ({
      index,
      source: photo.source,
      proxyUrl: `/api/alpha-page-publisher/vehicles/${vehicle.id}/photo/${index}`,
    })),
  });
});

router.get("/alpha-page-publisher/vehicles/:id/photo/:index", async (req, res) => {
  const id = Number(req.params.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(index) || index < 0 || index >= PAGE_PHOTO_LIMIT) {
    res.status(400).json({ error: "Invalid photo request" });
    return;
  }

  const loaded = await loadVehicle(id);
  const photoUrl = loaded?.photos[index]?.url;
  if (!photoUrl) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(photoUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "DealerPilotAlphaPagePublisher/1.0" },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `Photo upstream failed: ${upstream.status}` });
      return;
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(buffer);
  } catch (err) {
    req.log.warn({ vehicleId: id, index, err }, "Alpha page photo proxy failed");
    res.status(502).json({ error: "Photo proxy failed" });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
