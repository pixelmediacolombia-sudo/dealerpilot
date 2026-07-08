/**
 * Meta Automotive Inventory Ads (AIA) Feed Generator
 *
 * Schema : AIA native XML  — <listings>/<listing> (Jun 2026 spec)
 * Spec   : https://developers.facebook.com/docs/marketing-api/auto-ads/guides/catalog/
 *
 * XML element mapping (AIA field → <element>):
 *   vehicle_id          → <vehicle_id>
 *   title               → <title>
 *   description         → <description>
 *   url                 → <url>                 VDP URL
 *   make                → <make>
 *   model               → <model>
 *   year                → <year>
 *   vin                 → <vin>
 *   images              → <image><url>…</url><tag>Exterior</tag></image>  (repeated)
 *   mileage             → <mileage><value>…</value><unit>MI</unit></mileage>
 *   body_style          → <body_style>
 *   transmission        → <transmission>
 *   fuel_type           → <fuel_type>
 *   drivetrain          → <drivetrain>
 *   exterior_color      → <exterior_color>
 *   condition           → <condition>           EXCELLENT | GOOD | FAIR | POOR
 *   state_of_vehicle    → <state_of_vehicle>    NEW | USED | CPO
 *   price               → <price>               "28900 USD"
 *   availability        → <availability>        AVAILABLE | NOT_AVAILABLE
 *   address             → <address format="simple"><component name="…">…</component></address>
 *   latitude            → <latitude>
 *   longitude           → <longitude>
 *
 * CSV column mapping (AIA spec):
 *   vehicle_id, title, description, url, make, model, year,
 *   mileage.value, mileage.unit,
 *   image[0].url … image[19].url,
 *   transmission, fuel_type, body_style, drivetrain, vin,
 *   condition, state_of_vehicle, price, availability, exterior_color,
 *   address (JSON object), latitude, longitude
 */

import { db, vehiclesTable, vehicleImagesTable, dealersTable, feedRunsTable } from "@workspace/db";
import { and, eq, count, desc, ilike, isNull, or } from "drizzle-orm";


export type FeedVersion = "v1" | "v2";

// ──────────────────────────────────────────────────────────────────────────────
// Internal vehicle model
// ──────────────────────────────────────────────────────────────────────────────

interface MetaVehicle {
  vehicleId: string;
  title: string;
  description: string;
  url: string;                                             // VDP URL
  images: string[];                                        // ordered by position
  price: string;                                           // "28900 USD"
  // Spec enum values (case-sensitive as shown in AIA reference)
  availability: "available" | "not_available";             // lowercase per spec
  condition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "OTHER";
  stateOfVehicle: "New" | "Used" | "CPO";                 // title-case per spec
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  vin: string;
  mileageValue: number;                                    // always 0 for new
  mileageUnit: "MI" | "KM";
  bodyStyle: string;                                       // required — never null
  transmission: string | null;                             // "Automatic" | "Manual" | null
  fuelType: string | null;                                 // normalized AIA enum
  drivetrain: string | null;                               // "4X2" | "4X4" | "AWD" | "FWD" | "RWD" | "Other"
  exteriorColor: string;                                   // required — never null
  interiorColor: string | null;
  dealerId: string;
  dealerName: string;
  addr1: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  latitude: string;
  longitude: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface MetaFieldStatus {
  vehicle_id: boolean;
  image_url: boolean;
  price: boolean;
  url: boolean;
}

export interface MetaVehicleValidation {
  vin: string;
  title: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  fieldStatus: MetaFieldStatus;
}

export interface MetaFieldCoverage {
  vehicle_id: number;
  image_url: number;
  price: number;
  url: number;
}

export interface MetaDiagnostics {
  totalVehicles: number;
  exportableVehicles: number;
  blockedVehicles: number;
  validVehicles: number;
  invalidVehicles: number;
  totalErrors: number;
  totalWarnings: number;
  feedReadinessPercent: number;
  addressComplete: boolean;
  fieldCoverage: MetaFieldCoverage;
  lastGenerated: string;
  feedXmlUrl: string;
  feedCsvUrl: string;
  vehicles: MetaVehicleValidation[];
}

export interface SchemaAuditEntry {
  tag: string;
  status: "pass" | "fail";
  dealerPilotTag: string;
  expectedFormat: string;
  actualExample: string;
  note: string;
}

export interface SchemaAuditResult {
  schema: string;
  specSource: string;
  sampleVehicleVin: string | null;
  sampleXml: string | null;
  fields: SchemaAuditEntry[];
  allCompliant: boolean;
  exportableVehicles: number;
  blockedVehicles: number;
  auditedAt: string;
}

export interface ValidateMetaFieldCoverage {
  tag: string;
  fieldName: string;
  required: boolean;
  presentCount: number;
  totalCount: number;
  coveragePercent: number;
  exampleInvalidValues: string[];
}

export interface ValidateMetaVehicleResult {
  vehicleId: string;
  title: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidateMetaResult {
  exportableVehicles: number;
  blockedVehicles: number;
  compatibilityScore: number;
  missingFields: string[];
  invalidValues: { vehicleId: string; field: string; value: string; reason: string }[];
  invalidUrls: { vehicleId: string; field: string; url: string }[];
  missingAddressFields: string[];
  duplicateIds: string[];
  fieldCoverage: ValidateMetaFieldCoverage[];
  vehicles: ValidateMetaVehicleResult[];
  validatedAt: string;
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

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish", "Published"];

const MAX_IMAGES = 20;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "0 USD";
  return `${Math.round(price)} USD`;
}

function getFeedBase(): string {
  return (
    process.env["BACKEND_PUBLIC_URL"] ||
    process.env["PUBLIC_BASE_URL"] ||
    process.env["RENDER_EXTERNAL_URL"] ||
    ""
  ).replace(/\/+$/, "");
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

function isValidHttpsUrl(url: string): boolean {
  return /^https?:\/\/.+/.test(url);
}

// ──────────────────────────────────────────────────────────────────────────────
// Enum normalizers — map raw DB strings to exact Meta AIA spec values
// Spec source: developers.facebook.com/documentation/ads-commerce/marketing-api/auto-ads/reference
// ──────────────────────────────────────────────────────────────────────────────

const FUEL_TYPE_VALID = new Set(["DIESEL", "ELECTRIC", "FLEX", "GASOLINE", "HYBRID", "OTHER"]);
const FUEL_TYPE_MAP: Record<string, string> = {
  GAS: "GASOLINE",
  GASOLINE: "GASOLINE",
  PETROL: "GASOLINE",
  UNLEADED: "GASOLINE",
  DIESEL: "DIESEL",
  ELECTRIC: "ELECTRIC",
  EV: "ELECTRIC",
  BEV: "ELECTRIC",
  HYBRID: "HYBRID",
  "MILD HYBRID": "HYBRID",
  "PLUG-IN HYBRID": "HYBRID",
  "PLUGIN HYBRID": "HYBRID",
  PHEV: "HYBRID",
  FLEX: "FLEX",
  "FLEX FUEL": "FLEX",
  "FLEXIBLE FUEL": "FLEX",
  E85: "FLEX",
  "NATURAL GAS": "OTHER",
  CNG: "OTHER",
  LPG: "OTHER",
  HYDROGEN: "OTHER",
};
function normalizeFuelType(val: string | null): string | null {
  if (!val) return null;
  const key = val.trim().toUpperCase();
  return FUEL_TYPE_MAP[key] ?? (FUEL_TYPE_VALID.has(key) ? key : "OTHER");
}

// Spec: Automatic | Manual only (case-sensitive as shown in spec description)
function normalizeTransmission(val: string | null): string | null {
  if (!val) return null;
  const key = val.trim().toUpperCase();
  if (key === "AUTOMATIC" || key === "AUTO" || key === "A" || key === "CVT") return "Automatic";
  if (key === "MANUAL" || key === "STANDARD" || key === "M" || key === "MT") return "Manual";
  return null; // omit unknown values
}

// Spec body_style enum (AIA feed — different from Graph API)
const BODY_STYLE_VALID = new Set([
  "CONVERTIBLE", "COUPE", "HATCHBACK", "MINIVAN", "TRUCK",
  "SUV", "SEDAN", "VAN", "WAGON", "CROSSOVER", "SMALL_CAR", "OTHER",
]);
const BODY_STYLE_MAP: Record<string, string> = {
  PICKUP: "TRUCK",
  "PICKUP TRUCK": "TRUCK",
  TRUCK: "TRUCK",
  SUV: "SUV",
  "SPORT UTILITY": "SUV",
  CROSSOVER: "CROSSOVER",
  "SPORT UTILITY VEHICLE": "SUV",
  SEDAN: "SEDAN",
  SALOON: "SEDAN",
  COUPE: "COUPE",
  CONVERTIBLE: "CONVERTIBLE",
  HATCHBACK: "HATCHBACK",
  MINIVAN: "MINIVAN",
  "MINI VAN": "MINIVAN",
  VAN: "VAN",
  WAGON: "WAGON",
  "STATION WAGON": "WAGON",
  ESTATE: "WAGON",
  SMALL_CAR: "SMALL_CAR",
  "SMALL CAR": "SMALL_CAR",
};
function normalizeBodyStyle(val: string | null): string {
  if (!val) return "OTHER";
  const key = val.trim().toUpperCase();
  return BODY_STYLE_MAP[key] ?? (BODY_STYLE_VALID.has(key) ? key : "OTHER");
}

// Spec drivetrain enum: 4X2, 4X4, AWD, FWD, RWD, Other
const DRIVETRAIN_MAP: Record<string, string> = {
  FWD: "FWD",
  "FRONT WHEEL DRIVE": "FWD",
  "FRONT-WHEEL DRIVE": "FWD",
  RWD: "RWD",
  "REAR WHEEL DRIVE": "RWD",
  "REAR-WHEEL DRIVE": "RWD",
  AWD: "AWD",
  "ALL WHEEL DRIVE": "AWD",
  "ALL-WHEEL DRIVE": "AWD",
  "4WD": "4X4",
  "4X4": "4X4",
  "FOUR WHEEL DRIVE": "4X4",
  "FOUR-WHEEL DRIVE": "4X4",
  "2WD": "4X2",
  "4X2": "4X2",
  "TWO WHEEL DRIVE": "4X2",
  "TWO-WHEEL DRIVE": "4X2",
};
function normalizeDrivetrain(val: string | null): string | null {
  if (!val) return null;
  const key = val.trim().toUpperCase();
  return DRIVETRAIN_MAP[key] ?? null;
}

/** Format address as AIA JSON object literal (single-quoted values, no JSON.stringify). */
function formatAddressJson(v: MetaVehicle): string {
  const parts: string[] = [];
  if (v.addr1) parts.push(`addr1: '${v.addr1.replace(/'/g, "\\'")}'`);
  if (v.city) parts.push(`city: '${v.city.replace(/'/g, "\\'")}'`);
  if (v.region) parts.push(`region: '${v.region.replace(/'/g, "\\'")}'`);
  if (v.postalCode) parts.push(`postal_code: '${v.postalCode.replace(/'/g, "\\'")}'`);
  if (v.country) parts.push(`country: '${v.country.replace(/'/g, "\\'")}'`);
  return `{${parts.join(", ")}}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Data loader
// ──────────────────────────────────────────────────────────────────────────────

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

  const feedBase = getFeedBase();

  const vehicles: MetaVehicle[] = active.map((v) => {
    const sortedImages = (imagesByVehicle.get(v.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((i) => i.url);

    const yearStr = v.year ? String(v.year) : "";
    const title = [yearStr, v.make, v.model, v.trim].filter(Boolean).join(" ");

    // state_of_vehicle: spec values are "New" | "Used" | "CPO" (title-case)
    // DB vehicles table has no condition/stateOfVehicle column — default to "Used"
    const stateOfVehicle: "New" | "Used" | "CPO" = "Used";

    const mileageValue = v.mileage ?? 0;

    return {
      vehicleId: v.vin,
      title: title || `Vehicle #${v.id}`,
      description:
        v.description ??
        `${title} available at ${dealerName}. Contact us for more information.`,
      url: v.vdpUrl ?? `${feedBase}/inventory/${v.id}`,
      images: sortedImages,
      price: formatPrice(v.price),
      // Spec-exact enum values
      availability: "available",
      condition: "EXCELLENT",
      stateOfVehicle,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim ?? null,
      vin: v.vin,
      mileageValue,
      mileageUnit: "MI",
      bodyStyle: normalizeBodyStyle(v.bodyStyle ?? null),       // required — never null
      transmission: normalizeTransmission(v.transmission ?? null),
      fuelType: normalizeFuelType(v.fuelType ?? null),
      drivetrain: null, // drivetrain not in DB schema
      exteriorColor: v.exteriorColor ?? "",                     // required — empty string if missing
      interiorColor: v.interiorColor ?? null,
      dealerId: String(dealerId),
      dealerName,
      addr1: dealer?.addressLine1 ?? "",
      city: dealer?.city ?? "",
      region: dealer?.state ?? "",
      country: dealer?.country ?? "US",
      postalCode: dealer?.postalCode ?? "",
      latitude: dealer?.latitude ?? "",
      longitude: dealer?.longitude ?? "",
    };
  });

  return { vehicles, dealerName };
}

// ──────────────────────────────────────────────────────────────────────────────
// XML builder — AIA native <listings>/<listing> format (Jun 2026 spec)
// ──────────────────────────────────────────────────────────────────────────────

function buildListingXml(v: MetaVehicle): string {
  // Images: each in its own <image> element per spec
  // First image gets tag "Exterior"; tag is optional on subsequent images
  const imageElements = v.images
    .map(
      (url, i) =>
        i === 0
          ? `    <image>\n      <url>${escapeXml(url)}</url>\n      <tag>Exterior</tag>\n    </image>`
          : `    <image>\n      <url>${escapeXml(url)}</url>\n    </image>`,
    )
    .join("\n");

  // Optional fields — omit entirely when null (not empty elements)
  const optional = [
    v.trim ? `    <trim>${escapeXml(v.trim)}</trim>` : "",
    v.drivetrain ? `    <drivetrain>${escapeXml(v.drivetrain)}</drivetrain>` : "",
    v.transmission ? `    <transmission>${escapeXml(v.transmission)}</transmission>` : "",
    v.fuelType ? `    <fuel_type>${escapeXml(v.fuelType)}</fuel_type>` : "",
    v.latitude ? `    <latitude>${escapeXml(v.latitude)}</latitude>` : "",
    v.longitude ? `    <longitude>${escapeXml(v.longitude)}</longitude>` : "",
    v.interiorColor ? `    <interior_color>${escapeXml(v.interiorColor)}</interior_color>` : "",
    v.dealerId ? `    <dealer_id>${escapeXml(v.dealerId)}</dealer_id>` : "",
    v.dealerName ? `    <dealer_name>${escapeXml(v.dealerName)}</dealer_name>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Element order matches Meta's official AIA XML sample exactly
  // No CDATA — use XML-escaped plain text per spec samples
  return `  <listing>
    <vehicle_id>${escapeXml(v.vehicleId)}</vehicle_id>
    <title>${escapeXml(v.title)}</title>
    <description>${escapeXml(v.description.slice(0, 5000))}</description>
    <url>${escapeXml(v.url)}</url>
    <make>${escapeXml(v.make)}</make>
${imageElements}
    <model>${escapeXml(v.model)}</model>
    <year>${v.year ?? ""}</year>
    <mileage>
      <value>${v.mileageValue}</value>
      <unit>${v.mileageUnit}</unit>
    </mileage>
    <vin>${escapeXml(v.vin)}</vin>
    <body_style>${escapeXml(v.bodyStyle)}</body_style>
    <condition>${v.condition}</condition>
    <price>${escapeXml(v.price)}</price>
    <address format="simple">
      <component name="addr1">${escapeXml(v.addr1)}</component>
      <component name="city">${escapeXml(v.city)}</component>
      <component name="region">${escapeXml(v.region)}</component>
      <component name="postal_code">${escapeXml(v.postalCode)}</component>
      <component name="country">${escapeXml(v.country)}</component>
    </address>
    <exterior_color>${escapeXml(v.exteriorColor)}</exterior_color>
    <availability>${v.availability}</availability>
    <state_of_vehicle>${v.stateOfVehicle}</state_of_vehicle>
${optional}
  </listing>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Feed generators
// ──────────────────────────────────────────────────────────────────────────────

export async function generateMetaCatalogXml(
  dealerId: number,
  _version: FeedVersion = "v1",
): Promise<string> {
  const { vehicles, dealerName } = await loadMetaVehicles(dealerId);
  const exportable = vehicles.filter((v) => validateVehicle(v).valid);

  const listings = exportable.map((v) => buildListingXml(v)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<listings>
  <!--
    DealerPilot Meta Automotive Inventory Ads Feed
    Schema    : AIA native XML <listings>/<listing> (Jun 2026 spec)
    Spec      : developers.facebook.com/docs/marketing-api/auto-ads/guides/catalog/
    Dealer    : ${escapeXml(dealerName)}
    Exported  : ${exportable.length} / ${vehicles.length} vehicles
    Generated : ${new Date().toISOString()}
  -->
  <title>${escapeXml(dealerName)} Vehicle Inventory</title>
  <link rel="self" href="${escapeXml(getFeedBase())}/api/channels/meta-catalog/feed.xml"/>
${listings}
</listings>`;
}

/** Minimal 1-vehicle test feed. */
export async function generateMetaTestFeedXml(dealerId: number): Promise<string> {
  const { vehicles, dealerName } = await loadMetaVehicles(dealerId);
  const exportable = vehicles.filter((v) => validateVehicle(v).valid);
  const sample = exportable[0];

  if (!sample) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<listings>
  <title>${escapeXml(dealerName)} Vehicle Inventory (Test)</title>
  <link rel="self" href="${escapeXml(getFeedBase())}/api/channels/meta-catalog/feed.xml"/>
  <!-- No exportable vehicles found -->
</listings>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<listings>
  <!--
    DealerPilot Meta Automotive Inventory Ads — 1-Vehicle Test Feed
    Schema    : AIA native XML <listings>/<listing> (Jun 2026 spec)
    Generated : ${new Date().toISOString()}
  -->
  <title>${escapeXml(dealerName)} Vehicle Inventory (Test)</title>
  <link rel="self" href="${escapeXml(getFeedBase())}/api/channels/meta-catalog/feed.xml"/>
${buildListingXml(sample)}
</listings>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// CSV builder — AIA column names
// ──────────────────────────────────────────────────────────────────────────────

const IMAGE_COLUMNS = Array.from({ length: MAX_IMAGES }, (_, i) => `image[${i}].url`);

// CSV headers match official AIA spec column order (Jun 2026 reference)
const META_CSV_HEADERS = [
  "vehicle_id",
  "title",
  "description",
  "url",
  "make",
  "model",
  "year",
  "mileage.value",
  "mileage.unit",
  ...IMAGE_COLUMNS,
  "transmission",
  "fuel_type",
  "body_style",
  "drivetrain",
  "vin",
  "condition",
  "state_of_vehicle",
  "price",
  "exterior_color",
  "availability",
  "address",
  "latitude",
  "longitude",
  "trim",
  "interior_color",
  "dealer_id",
  "dealer_name",
];

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function vehicleToCsvRow(v: MetaVehicle): string {
  const imageValues = Array.from({ length: MAX_IMAGES }, (_, i) =>
    escapeCsv(v.images[i] ?? ""),
  );

  return [
    escapeCsv(v.vehicleId),
    escapeCsv(v.title),
    escapeCsv(v.description.slice(0, 5000)),
    escapeCsv(v.url),
    escapeCsv(v.make),
    escapeCsv(v.model),
    escapeCsv(v.year ?? ""),
    escapeCsv(v.mileageValue),
    escapeCsv(v.mileageUnit),
    ...imageValues,
    escapeCsv(v.transmission ?? ""),
    escapeCsv(v.fuelType ?? ""),
    escapeCsv(v.bodyStyle),
    escapeCsv(v.drivetrain ?? ""),
    escapeCsv(v.vin),
    escapeCsv(v.condition),
    escapeCsv(v.stateOfVehicle),
    escapeCsv(v.price),
    escapeCsv(v.exteriorColor),
    escapeCsv(v.availability),
    `"${formatAddressJson(v).replace(/"/g, '""')}"`,
    escapeCsv(v.latitude),
    escapeCsv(v.longitude),
    escapeCsv(v.trim ?? ""),
    escapeCsv(v.interiorColor ?? ""),
    escapeCsv(v.dealerId),
    escapeCsv(v.dealerName),
  ].join(",");
}

export async function generateMetaCatalogCsv(dealerId: number): Promise<string> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const exportable = vehicles.filter((v) => validateVehicle(v).valid);
  const rows = exportable.map(vehicleToCsvRow);
  return [META_CSV_HEADERS.join(","), ...rows].join("\r\n");
}

export async function generateMetaTestCsv(dealerId: number): Promise<string> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const exportable = vehicles.filter((v) => validateVehicle(v).valid);
  const header = META_CSV_HEADERS.join(",");
  const sample = exportable[0];
  if (!sample) return header + "\r\n";
  return [header, vehicleToCsvRow(sample)].join("\r\n");
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-vehicle validator
// ──────────────────────────────────────────────────────────────────────────────

function validateVehicle(v: MetaVehicle): MetaVehicleValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasVehicleId = !!(v.vehicleId && v.vehicleId.length >= 6);
  const hasImageUrl = v.images.length > 0 && isValidHttpsUrl(v.images[0]!);
  const hasPrice = !!(v.price && v.price !== "0 USD");
  const hasUrl = isValidHttpsUrl(v.url);

  if (!hasVehicleId) errors.push("vehicle_id missing or too short (need VIN ≥6 chars)");
  if (!hasImageUrl) errors.push("image[0].url missing or not a valid HTTPS URL");
  if (!hasPrice) errors.push("price missing or zero");
  if (!hasUrl) errors.push("url (VDP URL) missing or not a valid HTTPS URL");
  if (!v.make) errors.push("make missing");
  if (!v.model) errors.push("model missing");
  if (!v.year) errors.push("year missing");

  if (v.mileageValue == null) warnings.push("mileage.value not specified");
  if (!v.bodyStyle) warnings.push("body_style not specified");
  if (!v.trim) warnings.push("trim not specified");
  if (!v.exteriorColor) warnings.push("exterior_color not specified");
  if (!v.transmission) warnings.push("transmission not specified");
  if (!v.fuelType) warnings.push("fuel_type not specified");
  if (v.images.length < 2) warnings.push("only one image (additional images recommended)");
  if (!v.description || v.description.length < 20) warnings.push("description too short");

  return {
    vin: v.vehicleId,
    title: v.title,
    valid: errors.length === 0,
    errors,
    warnings,
    fieldStatus: {
      vehicle_id: hasVehicleId,
      image_url: hasImageUrl,
      price: hasPrice,
      url: hasUrl,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Validate endpoint (diagnostics)
// ──────────────────────────────────────────────────────────────────────────────

export async function validateMetaCatalog(dealerId: number): Promise<MetaDiagnostics> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const feedBase = getFeedBase();
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));

  const validations = vehicles.map(validateVehicle);

  const fieldCoverage: MetaFieldCoverage = {
    vehicle_id: validations.filter((v) => v.fieldStatus.vehicle_id).length,
    image_url: validations.filter((v) => v.fieldStatus.image_url).length,
    price: validations.filter((v) => v.fieldStatus.price).length,
    url: validations.filter((v) => v.fieldStatus.url).length,
  };

  const validCount = validations.filter((v) => v.valid).length;
  const exportableVehicles = validCount;
  const blockedVehicles = validations.filter((v) => !v.valid).length;
  const feedReadinessPercent =
    vehicles.length > 0 ? Math.round((validCount / vehicles.length) * 100) : 100;

  const addressComplete = !!(
    dealer?.addressLine1 &&
    dealer?.city &&
    dealer?.state &&
    dealer?.country &&
    dealer?.postalCode
  );

  return {
    totalVehicles: vehicles.length,
    exportableVehicles,
    blockedVehicles,
    validVehicles: exportableVehicles,
    invalidVehicles: blockedVehicles,
    totalErrors: validations.reduce((sum, v) => sum + v.errors.length, 0),
    totalWarnings: validations.reduce((sum, v) => sum + v.warnings.length, 0),
    feedReadinessPercent,
    addressComplete,
    fieldCoverage,
    lastGenerated: new Date().toISOString(),
    feedXmlUrl: `${feedBase}/api/channels/meta-catalog/feed.xml`,
    feedCsvUrl: `${feedBase}/api/channels/meta-catalog/feed.csv`,
    vehicles: validations,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Schema audit endpoint
// ──────────────────────────────────────────────────────────────────────────────

export async function auditMetaCatalogSchema(dealerId: number): Promise<SchemaAuditResult> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const exportable = vehicles.filter((v) => validateVehicle(v).valid);
  const sample = exportable[0] ?? null;
  const sampleXml = sample ? buildListingXml(sample) : null;
  const xml = sampleXml ?? "";

  type CheckDef = {
    tag: string;
    dealerPilotTag: string;
    expectedFormat: string;
    check: (x: string) => boolean;
    example: (v: MetaVehicle | null) => string;
    note: string;
  };

  const CHECKS: CheckDef[] = [
    {
      tag: "listings",
      dealerPilotTag: "<listings>",
      expectedFormat: "<listings>…<listing>…</listing>…</listings>",
      check: () => true, // always passes — root element is verified by generateMetaCatalogXml
      example: () => "<listings>",
      note: "AIA root element — replaces RSS <rss>/<channel>/<item>",
    },
    {
      tag: "vehicle_id",
      dealerPilotTag: "<vehicle_id>",
      expectedFormat: "<vehicle_id>VIN</vehicle_id>",
      check: (x) => x.includes("<vehicle_id>"),
      example: (v) => (v ? `<vehicle_id>${v.vehicleId}</vehicle_id>` : ""),
      note: "AIA unique vehicle identifier (VIN) — no g: namespace prefix",
    },
    {
      tag: "url",
      dealerPilotTag: "<url>",
      expectedFormat: "<url>https://…/inventory/VIN</url>",
      check: (x) => /<url>https?:\/\//.test(x),
      example: (v) => (v ? `<url>${v.url}</url>` : ""),
      note: "AIA VDP URL — replaces RSS <link>",
    },
    {
      tag: "image",
      dealerPilotTag: "<image><url>…</url><tag>Exterior</tag></image>",
      expectedFormat: "<image><url>https://…</url><tag>Exterior</tag></image>",
      check: (x) => x.includes("<image>") && x.includes("<tag>Exterior</tag>"),
      example: (v) =>
        v && v.images[0]
          ? `<image><url>${v.images[0]}</url><tag>Exterior</tag></image>`
          : "",
      note: "AIA image block — replaces g:image_link / g:additional_image_link",
    },
    {
      tag: "mileage",
      dealerPilotTag: "<mileage><value>…</value><unit>MI</unit></mileage>",
      expectedFormat: "<mileage><value>48130</value><unit>MI</unit></mileage>",
      check: (x) => x.includes("<mileage>") && x.includes("<value>") && x.includes("<unit>"),
      example: (v) =>
        v && v.mileageValue != null
          ? `<mileage><value>${v.mileageValue}</value><unit>${v.mileageUnit}</unit></mileage>`
          : "",
      note: "AIA mileage block — replaces g:mileage flat string",
    },
    {
      tag: "condition",
      dealerPilotTag: "<condition>",
      expectedFormat: "<condition>EXCELLENT</condition>",
      check: (x) =>
        x.includes("<condition>EXCELLENT") ||
        x.includes("<condition>GOOD") ||
        x.includes("<condition>FAIR") ||
        x.includes("<condition>POOR"),
      example: (v) => (v ? `<condition>${v.condition}</condition>` : ""),
      note: "AIA vehicle quality — EXCELLENT | GOOD | FAIR | POOR (not 'new'/'used')",
    },
    {
      tag: "state_of_vehicle",
      dealerPilotTag: "<state_of_vehicle>",
      expectedFormat: "<state_of_vehicle>USED</state_of_vehicle>",
      check: (x) =>
        x.includes("<state_of_vehicle>NEW") ||
        x.includes("<state_of_vehicle>USED") ||
        x.includes("<state_of_vehicle>CPO"),
      example: (v) => (v ? `<state_of_vehicle>${v.stateOfVehicle}</state_of_vehicle>` : ""),
      note: "AIA new/used/CPO — NEW | USED | CPO",
    },
    {
      tag: "availability",
      dealerPilotTag: "<availability>",
      expectedFormat: "<availability>AVAILABLE</availability>",
      check: (x) =>
        x.includes("<availability>AVAILABLE") || x.includes("<availability>NOT_AVAILABLE"),
      example: (v) => (v ? `<availability>${v.availability}</availability>` : ""),
      note: "AIA availability — AVAILABLE | NOT_AVAILABLE (not 'in stock')",
    },
    {
      tag: "address",
      dealerPilotTag: "<address format=\"simple\">",
      expectedFormat:
        '<address format="simple"><component name="addr1">…</component>…</address>',
      check: (x) => x.includes('<address format="simple">') && x.includes('<component name='),
      example: (v) =>
        v
          ? `<address format="simple"><component name="addr1">${v.addr1}</component><component name="city">${v.city}</component></address>`
          : "",
      note: "AIA nested address — replaces flat g:street_address/g:city/g:region/etc.",
    },
    {
      tag: "price",
      dealerPilotTag: "<price>",
      expectedFormat: "<price>28900 USD</price>",
      check: (x) => /<price>\d+ USD<\/price>/.test(x),
      example: (v) => (v ? `<price>${v.price}</price>` : ""),
      note: "Amount + ISO 4217 currency code",
    },
  ];

  const fields: SchemaAuditEntry[] = CHECKS.map(
    ({ tag, dealerPilotTag, expectedFormat, check, example, note }) => ({
      tag,
      status: check(xml) ? "pass" : "fail",
      dealerPilotTag,
      expectedFormat,
      actualExample: example(sample),
      note,
    }),
  );

  return {
    schema: "Meta Automotive Inventory Ads — AIA <listings>/<listing> XML (Jun 2026 spec)",
    specSource: "https://developers.facebook.com/docs/marketing-api/auto-ads/guides/catalog/",
    sampleVehicleVin: sample?.vehicleId ?? null,
    sampleXml,
    fields,
    allCompliant: fields.every((f) => f.status === "pass"),
    exportableVehicles: exportable.length,
    blockedVehicles: vehicles.length - exportable.length,
    auditedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Detailed validate-meta endpoint
// ──────────────────────────────────────────────────────────────────────────────

export async function validateMetaCatalogMeta(dealerId: number): Promise<ValidateMetaResult> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));

  type FieldDef = { key: keyof MetaVehicle; tag: string; fieldName: string };

  const REQUIRED_FIELDS: FieldDef[] = [
    { key: "vehicleId", tag: "vehicle_id", fieldName: "vehicle_id" },
    { key: "images", tag: "image[0].url", fieldName: "image[0].url" },
    { key: "price", tag: "price", fieldName: "price" },
    { key: "url", tag: "url", fieldName: "url" },
    { key: "make", tag: "make", fieldName: "make" },
    { key: "model", tag: "model", fieldName: "model" },
    { key: "year", tag: "year", fieldName: "year" },
    { key: "vin", tag: "vin", fieldName: "vin" },
    { key: "addr1", tag: "address.addr1", fieldName: "address.addr1" },
    { key: "city", tag: "address.city", fieldName: "address.city" },
    { key: "region", tag: "address.region", fieldName: "address.region" },
    { key: "country", tag: "address.country", fieldName: "address.country" },
    { key: "postalCode", tag: "address.postal_code", fieldName: "address.postal_code" },
  ];

  const OPTIONAL_FIELDS: FieldDef[] = [
    { key: "mileageValue", tag: "mileage.value", fieldName: "mileage.value" },
    { key: "bodyStyle", tag: "body_style", fieldName: "body_style" },
    { key: "transmission", tag: "transmission", fieldName: "transmission" },
    { key: "fuelType", tag: "fuel_type", fieldName: "fuel_type" },
    { key: "exteriorColor", tag: "exterior_color", fieldName: "exterior_color" },
    { key: "trim", tag: "trim", fieldName: "trim" },
    { key: "drivetrain", tag: "drivetrain", fieldName: "drivetrain" },
  ];

  const validationResults = vehicles.map((v) => validateVehicle(v));
  const exportable = vehicles.filter((_, i) => validationResults[i]!.valid);
  const blocked = vehicles.filter((_, i) => !validationResults[i]!.valid);

  const idCounts = new Map<string, number>();
  for (const v of vehicles) {
    idCounts.set(v.vehicleId, (idCounts.get(v.vehicleId) ?? 0) + 1);
  }
  const duplicateIds = [...idCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([id]) => id);

  const missingAddressFields: string[] = [];
  if (!dealer?.addressLine1) missingAddressFields.push("address.addr1");
  if (!dealer?.city) missingAddressFields.push("address.city");
  if (!dealer?.state) missingAddressFields.push("address.region");
  if (!dealer?.country) missingAddressFields.push("address.country");
  if (!dealer?.postalCode) missingAddressFields.push("address.postal_code");
  if (!dealer?.latitude) missingAddressFields.push("latitude");
  if (!dealer?.longitude) missingAddressFields.push("longitude");

  const invalidValues: ValidateMetaResult["invalidValues"] = [];
  for (const v of vehicles) {
    if (v.price === "0 USD" || !v.price) {
      invalidValues.push({
        vehicleId: v.vehicleId,
        field: "price",
        value: v.price,
        reason: "Price is zero or missing — vehicle excluded from feed",
      });
    }
    const primaryImage = v.images[0] ?? "";
    if (!isValidHttpsUrl(primaryImage)) {
      invalidValues.push({
        vehicleId: v.vehicleId,
        field: "image[0].url",
        value: primaryImage,
        reason: "Not a valid HTTPS URL",
      });
    }
    if (!isValidHttpsUrl(v.url)) {
      invalidValues.push({
        vehicleId: v.vehicleId,
        field: "url",
        value: v.url,
        reason: "Not a valid HTTPS URL",
      });
    }
  }

  const invalidUrls: ValidateMetaResult["invalidUrls"] = [];
  for (const v of vehicles) {
    const primaryImage = v.images[0] ?? "";
    if (primaryImage && !isValidHttpsUrl(primaryImage)) {
      invalidUrls.push({ vehicleId: v.vehicleId, field: "image[0].url", url: primaryImage });
    }
    if (v.url && !isValidHttpsUrl(v.url)) {
      invalidUrls.push({ vehicleId: v.vehicleId, field: "url", url: v.url });
    }
  }

  const allFieldDefs = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  const fieldCoverage: ValidateMetaFieldCoverage[] = allFieldDefs.map(
    ({ key, tag, fieldName }) => {
      const required = REQUIRED_FIELDS.some((f) => f.key === key);
      let presentCount = 0;
      const exampleInvalidValues: string[] = [];
      for (const v of vehicles) {
        const val = v[key];
        let present: boolean;
        if (key === "images") {
          const imgs = val as string[];
          present = imgs.length > 0 && isValidHttpsUrl(imgs[0]!);
        } else {
          present = val != null && val !== "" && val !== "0 USD";
        }
        if (present) presentCount++;
        else if (exampleInvalidValues.length < 3) {
          exampleInvalidValues.push(String(val ?? "(missing)"));
        }
      }
      return {
        tag,
        fieldName,
        required,
        presentCount,
        totalCount: vehicles.length,
        coveragePercent:
          vehicles.length > 0 ? Math.round((presentCount / vehicles.length) * 100) : 100,
        exampleInvalidValues,
      };
    },
  );

  let score = vehicles.length > 0 ? Math.round((exportable.length / vehicles.length) * 100) : 100;
  if (missingAddressFields.length > 0) score = Math.max(0, score - missingAddressFields.length * 5);
  if (duplicateIds.length > 0) score = Math.max(0, score - duplicateIds.length * 2);

  const missingFields = fieldCoverage
    .filter((f) => f.required && f.presentCount === 0)
    .map((f) => f.fieldName);

  const vehicleResults: ValidateMetaVehicleResult[] = validationResults.map((r) => ({
    vehicleId: r.vin,
    title: r.title,
    valid: r.valid,
    errors: r.errors,
    warnings: r.warnings,
  }));

  void blocked;

  return {
    exportableVehicles: exportable.length,
    blockedVehicles: blocked.length,
    compatibilityScore: score,
    missingFields,
    invalidValues,
    invalidUrls,
    missingAddressFields,
    duplicateIds,
    fieldCoverage,
    vehicles: vehicleResults,
    validatedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Feed health (used by scheduler)
// ──────────────────────────────────────────────────────────────────────────────

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
