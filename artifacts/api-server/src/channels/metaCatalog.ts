import { db, vehiclesTable, vehicleImagesTable, dealersTable, feedRunsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";

interface MetaVehicle {
  vehicleId: string;
  title: string;
  description: string;
  availability: "FOR_SALE" | "NOT_AVAILABLE";
  condition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  price: string;
  url: string;
  imageLinkPrimary: string;
  additionalImageLinks: string[];
  make: string;
  model: string;
  year: number | null;
  trim: string | null;
  bodyStyle: string | null;
  mileageValue: number | null;
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
      vehicleId: v.vin || `stock-${v.stockNumber ?? v.id}`,
      title: title || `Vehicle #${v.id}`,
      description:
        v.description ??
        `${title} available at ${dealerName}. Contact us for more information.`,
      availability: "FOR_SALE",
      condition: "GOOD",
      price: formatPrice(v.price),
      url: v.vdpUrl ?? `${getFeedBase()}/inventory/${v.id}`,
      imageLinkPrimary: primaryImage,
      additionalImageLinks: additionalImages,
      make: v.make,
      model: v.model,
      year: v.year,
      trim: v.trim ?? null,
      bodyStyle: v.bodyStyle ?? null,
      mileageValue: v.mileage ?? null,
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

function cdata(str: string): string {
  return `<![CDATA[${str.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

export async function generateMetaCatalogXml(dealerId: number): Promise<string> {
  const { vehicles, dealerName } = await loadMetaVehicles(dealerId);

  const listings = vehicles
    .map((v) => {
      const additionalImages = v.additionalImageLinks
        .slice(0, 10)
        .map((url) => `    <additional_image_link>${escapeXml(url)}</additional_image_link>`)
        .join("\n");

      const optionalLines = [
        v.trim ? `    <trim>${cdata(v.trim)}</trim>` : "",
        v.bodyStyle ? `    <body_style>${cdata(v.bodyStyle)}</body_style>` : "",
        v.mileageValue != null
          ? `    <mileage>\n      <value>${v.mileageValue}</value>\n      <unit>MI</unit>\n    </mileage>`
          : "",
        v.vin ? `    <vin>${escapeXml(v.vin)}</vin>` : "",
        v.exteriorColor ? `    <exterior_color>${cdata(v.exteriorColor)}</exterior_color>` : "",
        additionalImages,
      ]
        .filter(Boolean)
        .join("\n");

      return `  <listing>
    <vehicle_id>${escapeXml(v.vehicleId)}</vehicle_id>
    <make>${cdata(v.make)}</make>
    <model>${cdata(v.model)}</model>
    <year>${v.year ?? ""}</year>
    <title>${cdata(v.title)}</title>
    <description>${cdata(v.description.slice(0, 5000))}</description>
    <availability>${v.availability}</availability>
    <condition>${v.condition}</condition>
    <price>${escapeXml(v.price)}</price>
    <url>${escapeXml(v.url)}</url>
    <image_link>${escapeXml(v.imageLinkPrimary)}</image_link>
    <dealer_name>${cdata(v.dealerName)}</dealer_name>
${optionalLines}
  </listing>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<listings>
  <!--
    DealerPilot Meta Vehicle Catalog Feed
    Dealer: ${escapeXml(dealerName)}
    Vehicles: ${vehicles.length}
    Generated: ${new Date().toISOString()}
  -->
${listings}
</listings>`;
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
  "vehicle_id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "url",
  "image_link",
  "additional_image_link",
  "make",
  "model",
  "year",
  "trim",
  "body_style",
  "mileage.value",
  "mileage.unit",
  "vin",
  "exterior_color",
  "dealer_name",
];

export async function generateMetaCatalogCsv(dealerId: number): Promise<string> {
  const { vehicles } = await loadMetaVehicles(dealerId);

  const rows = vehicles.map((v) =>
    [
      escapeCsv(v.vehicleId),
      escapeCsv(v.title),
      escapeCsv(v.description.slice(0, 5000)),
      escapeCsv(v.availability),
      escapeCsv(v.condition),
      escapeCsv(v.price),
      escapeCsv(v.url),
      escapeCsv(v.imageLinkPrimary),
      escapeCsv(v.additionalImageLinks.slice(0, 10).join("|")),
      escapeCsv(v.make),
      escapeCsv(v.model),
      escapeCsv(v.year),
      escapeCsv(v.trim),
      escapeCsv(v.bodyStyle),
      escapeCsv(v.mileageValue),
      v.mileageValue != null ? "MI" : "",
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
    if (!v.url || !v.url.startsWith("http")) errors.push("invalid VDP URL");
    if (!v.make) errors.push("missing make");
    if (!v.model) errors.push("missing model");
    if (!v.year) errors.push("missing year");

    if (!v.trim) warnings.push("trim not specified");
    if (!v.exteriorColor) warnings.push("exterior color not specified");
    if (!v.bodyStyle) warnings.push("body style not specified");
    if (v.additionalImageLinks.length === 0) warnings.push("no additional images");
    if (!v.description || v.description.length < 20) warnings.push("description too short");
    if (v.mileageValue == null) warnings.push("mileage not specified");

    return {
      vin: v.vehicleId,
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

  const [latestRun] = await db
    .select()
    .from(feedRunsTable)
    .where(eq(feedRunsTable.dealerId, dealerId))
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(1);

  const totalVehicles = active.length;
  const avgPhotosPerVehicle =
    totalVehicles > 0 ? Math.round((totalPhotos / totalVehicles) * 10) / 10 : 0;

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
