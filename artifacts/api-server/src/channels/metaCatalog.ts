import { db, vehiclesTable, vehicleImagesTable, dealersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

interface MetaVehicle {
  id: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock";
  condition: "used" | "new";
  price: string;
  link: string;
  imageLinkPrimary: string;
  additionalImageLinks: string[];
  make: string;
  model: string;
  year: number | null;
  trim: string | null;
  bodyStyle: string | null;
  mileage: string | null;
  vin: string;
  exteriorColor: string | null;
  dealerName: string;
}

export interface MetaVehicleValidation {
  vin: string;
  title: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MetaDiagnostics {
  totalVehicles: number;
  validVehicles: number;
  invalidVehicles: number;
  totalErrors: number;
  totalWarnings: number;
  lastGenerated: string;
  feedXmlUrl: string;
  feedCsvUrl: string;
  vehicles: MetaVehicleValidation[];
}

const ACTIVE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish", "Published"];

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "0 USD";
  return `${Math.round(price)} USD`;
}

function getFeedBase(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]!.trim()}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  return "";
}

async function loadMetaVehicles(
  dealerId: number,
): Promise<{ vehicles: MetaVehicle[]; dealerName: string }> {
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));
  const dealerName = dealer?.name ?? "Unknown Dealer";

  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealerId));

  const active = rows.filter((v) => ACTIVE_STATUSES.includes(v.status));

  const allImages = await db
    .select()
    .from(vehicleImagesTable)
    .orderBy(vehicleImagesTable.position);

  const imagesByVehicle = new Map<number, { url: string; position: number }[]>();
  for (const img of allImages) {
    const list = imagesByVehicle.get(img.vehicleId) ?? [];
    list.push({ url: img.url, position: img.position });
    imagesByVehicle.set(img.vehicleId, list);
  }

  const vehicles: MetaVehicle[] = active.map((v) => {
    const images = (imagesByVehicle.get(v.id) ?? []).sort((a, b) => a.position - b.position);
    const primaryImage = images[0]?.url ?? "";
    const additionalImages = images.slice(1).map((i) => i.url);

    const yearStr = v.year ? String(v.year) : "";
    const title = [yearStr, v.make, v.model, v.trim].filter(Boolean).join(" ");

    return {
      id: v.vin || `stock-${v.stockNumber ?? v.id}`,
      title: title || `Vehicle #${v.id}`,
      description:
        v.description ?? `${title} available at ${dealerName}. Contact us for more information.`,
      availability: "in stock",
      condition: "used",
      price: formatPrice(v.price),
      link: v.vdpUrl ?? `${getFeedBase()}/inventory/${v.id}`,
      imageLinkPrimary: primaryImage,
      additionalImageLinks: additionalImages,
      make: v.make,
      model: v.model,
      year: v.year,
      trim: v.trim ?? null,
      bodyStyle: v.bodyStyle ?? null,
      mileage: v.mileage != null ? `${v.mileage} mi` : null,
      vin: v.vin,
      exteriorColor: v.exteriorColor ?? null,
      dealerName,
    };
  });

  return { vehicles, dealerName };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function generateMetaCatalogXml(dealerId: number): Promise<string> {
  const { vehicles, dealerName } = await loadMetaVehicles(dealerId);

  const items = vehicles
    .map((v) => {
      const additionalImages = v.additionalImageLinks
        .slice(0, 10)
        .map(
          (url) => `    <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`,
        )
        .join("\n");

      const optionalLines = [
        additionalImages,
        v.year ? `    <g:year>${v.year}</g:year>` : "",
        v.trim ? `    <g:trim>${escapeXml(v.trim)}</g:trim>` : "",
        v.bodyStyle ? `    <g:body_style>${escapeXml(v.bodyStyle)}</g:body_style>` : "",
        v.mileage ? `    <g:mileage>${escapeXml(v.mileage)}</g:mileage>` : "",
        v.vin ? `    <g:vin>${escapeXml(v.vin)}</g:vin>` : "",
        v.exteriorColor
          ? `    <g:exterior_color>${escapeXml(v.exteriorColor)}</g:exterior_color>`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      return `  <item>
    <g:id>${escapeXml(v.id)}</g:id>
    <g:title>${escapeXml(v.title)}</g:title>
    <g:description>${escapeXml(v.description.slice(0, 5000))}</g:description>
    <g:availability>${v.availability}</g:availability>
    <g:condition>${v.condition}</g:condition>
    <g:price>${escapeXml(v.price)}</g:price>
    <g:link>${escapeXml(v.link)}</g:link>
    <g:image_link>${escapeXml(v.imageLinkPrimary)}</g:image_link>
    <g:make>${escapeXml(v.make)}</g:make>
    <g:model>${escapeXml(v.model)}</g:model>
    <g:dealer_name>${escapeXml(v.dealerName)}</g:dealer_name>
${optionalLines}
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(dealerName)} — DealerPilot Inventory Catalog</title>
    <link>https://www.facebook.com/marketplace</link>
    <description>DealerPilot-hosted Meta Catalog Feed for ${escapeXml(dealerName)}</description>
    <g:total_vehicles>${vehicles.length}</g:total_vehicles>
    <g:generated_at>${new Date().toISOString()}</g:generated_at>
${items}
  </channel>
</rss>`;
}

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADERS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "additional_image_link",
  "make",
  "model",
  "year",
  "trim",
  "body_style",
  "mileage",
  "vin",
  "exterior_color",
  "dealer_name",
];

export async function generateMetaCatalogCsv(dealerId: number): Promise<string> {
  const { vehicles } = await loadMetaVehicles(dealerId);

  const rows = vehicles.map((v) =>
    [
      escapeCsv(v.id),
      escapeCsv(v.title),
      escapeCsv(v.description.slice(0, 5000)),
      escapeCsv(v.availability),
      escapeCsv(v.condition),
      escapeCsv(v.price),
      escapeCsv(v.link),
      escapeCsv(v.imageLinkPrimary),
      escapeCsv(v.additionalImageLinks.slice(0, 10).join("|")),
      escapeCsv(v.make),
      escapeCsv(v.model),
      escapeCsv(v.year),
      escapeCsv(v.trim),
      escapeCsv(v.bodyStyle),
      escapeCsv(v.mileage),
      escapeCsv(v.vin),
      escapeCsv(v.exteriorColor),
      escapeCsv(v.dealerName),
    ].join(","),
  );

  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

export async function validateMetaCatalog(dealerId: number): Promise<MetaDiagnostics> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const feedBase = getFeedBase();

  const validations: MetaVehicleValidation[] = vehicles.map((v) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!v.vin || v.vin.length < 6) errors.push("missing or invalid VIN");
    if (!v.price || v.price === "0 USD") errors.push("missing or invalid price");
    if (!v.imageLinkPrimary) errors.push("missing primary image");
    else if (!v.imageLinkPrimary.startsWith("http")) errors.push("invalid image URL format");
    if (!v.link || !v.link.startsWith("http")) errors.push("invalid VDP link");

    if (!v.trim) warnings.push("trim not specified");
    if (!v.exteriorColor) warnings.push("exterior color not specified");
    if (!v.bodyStyle) warnings.push("body style not specified");
    if (v.additionalImageLinks.length === 0) warnings.push("no additional images");
    if (!v.description || v.description.length < 20) warnings.push("description too short");

    return {
      vin: v.id,
      title: v.title,
      valid: errors.length === 0,
      errors,
      warnings,
    };
  });

  return {
    totalVehicles: vehicles.length,
    validVehicles: validations.filter((v) => v.valid).length,
    invalidVehicles: validations.filter((v) => !v.valid).length,
    totalErrors: validations.reduce((sum, v) => sum + v.errors.length, 0),
    totalWarnings: validations.reduce((sum, v) => sum + v.warnings.length, 0),
    lastGenerated: new Date().toISOString(),
    feedXmlUrl: `${feedBase}/api/channels/meta-catalog/feed.xml`,
    feedCsvUrl: `${feedBase}/api/channels/meta-catalog/feed.csv`,
    vehicles: validations,
  };
}

export interface FeedHealthReport {
  feedUrl: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastSyncStatus: string | null;
  totalVehicles: number;
  newVehicles: number;
  updatedVehicles: number;
  removedVehicles: number;
  totalPhotos: number;
  avgPhotosPerVehicle: number;
  vehiclesMissingPrice: number;
  vehiclesMissingImages: number;
  duplicateVins: number;
  healthScore: number;
  healthStatus: "Healthy" | "Needs Attention" | "Critical";
}

export async function computeFeedHealth(
  dealerId: number,
  nextSyncAt: Date | null,
): Promise<FeedHealthReport> {
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealerId));

  const active = vehicles.filter((v) => ACTIVE_STATUSES.includes(v.status));

  const [{ value: totalPhotos }] = await db
    .select({ value: count() })
    .from(vehicleImagesTable)
    .innerJoin(vehiclesTable, eq(vehicleImagesTable.vehicleId, vehiclesTable.id))
    .where(eq(vehiclesTable.dealerId, dealerId));

  const imageCountRows = await db
    .select({ vehicleId: vehicleImagesTable.vehicleId, cnt: count() })
    .from(vehicleImagesTable)
    .groupBy(vehicleImagesTable.vehicleId);

  const imageCountByVehicle = new Map(imageCountRows.map((r) => [r.vehicleId, r.cnt]));

  const vehiclesMissingImages = active.filter(
    (v) => !imageCountByVehicle.has(v.id) || imageCountByVehicle.get(v.id)! === 0,
  ).length;

  const vehiclesMissingPrice = active.filter((v) => !v.price || v.price <= 0).length;

  const vinCounts = new Map<string, number>();
  for (const v of active) {
    vinCounts.set(v.vin, (vinCounts.get(v.vin) ?? 0) + 1);
  }
  const duplicateVins = [...vinCounts.values()].filter((c) => c > 1).length;

  const { db: db2, feedRunsTable, desc } = await import("@workspace/db").then(async (m) => {
    const { desc } = await import("drizzle-orm");
    return { ...m, desc };
  });

  const [latestRun] = await db2
    .select()
    .from(feedRunsTable)
    .where(eq(feedRunsTable.dealerId, dealerId))
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(1);

  const totalVehicles = active.length;
  const avgPhotosPerVehicle =
    totalVehicles > 0 ? Math.round((totalPhotos / totalVehicles) * 10) / 10 : 0;

  // Health score
  let score = 100;
  if (vehiclesMissingPrice > 0) score -= Math.min(20, vehiclesMissingPrice * 2);
  if (vehiclesMissingImages > 0) score -= Math.min(25, vehiclesMissingImages * 2);
  if (duplicateVins > 0) score -= Math.min(20, duplicateVins * 5);
  if (latestRun?.status === "error") score -= 15;
  if (!dealer?.xmlFeedUrl) score -= 20;
  score = Math.max(0, score);

  const healthStatus: FeedHealthReport["healthStatus"] =
    score >= 80 ? "Healthy" : score >= 60 ? "Needs Attention" : "Critical";

  return {
    feedUrl: dealer?.xmlFeedUrl ?? null,
    lastSyncAt: latestRun ? (latestRun.finishedAt ?? latestRun.startedAt).toISOString() : null,
    nextSyncAt: nextSyncAt ? nextSyncAt.toISOString() : null,
    lastSyncStatus: latestRun?.status ?? null,
    totalVehicles,
    newVehicles: latestRun?.vehiclesNew ?? 0,
    updatedVehicles: latestRun?.vehiclesUpdated ?? 0,
    removedVehicles: latestRun?.vehiclesRemoved ?? 0,
    totalPhotos,
    avgPhotosPerVehicle,
    vehiclesMissingPrice,
    vehiclesMissingImages,
    duplicateVins,
    healthScore: score,
    healthStatus,
  };
}
