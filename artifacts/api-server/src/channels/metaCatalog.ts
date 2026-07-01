/**
 * Meta Automotive Inventory Ads (AIA) Feed Generator
 *
 * Schema : RSS 2.0 + Google Base "g:" namespace
 * Spec   : https://developers.facebook.com/docs/marketing-api/auto-ads/guides/catalog/
 *
 * XML tag mapping (Meta field name → XML element):
 *   vehicle_id              → <g:vehicle_id>
 *   title                   → <title>            (standard RSS, no g: prefix)
 *   description             → <description>      (standard RSS, no g: prefix)
 *   link                    → <link>             (standard RSS, no g: prefix) — VDP URL
 *   image_link              → <g:image_link>     — primary photo HTTPS URL
 *   additional_image_link   → <g:additional_image_link>  (repeated, up to 9)
 *   price                   → <g:price>          "28900 USD"
 *   availability            → <g:availability>   "in stock" | "out of stock"
 *   condition               → <g:condition>      "new" | "used" | "certified pre-owned"
 *   year                    → <g:year>
 *   make                    → <g:make>
 *   model                   → <g:model>
 *   trim                    → <g:trim>
 *   vin                     → <g:vin>
 *   mileage                 → <g:mileage>        "48130 mi"
 *   body_style              → <g:body_style>
 *   transmission            → <g:transmission>
 *   fuel_type               → <g:fuel_type>
 *   exterior_color          → <g:exterior_color>
 *   interior_color          → <g:interior_color>
 *   street_address          → <g:street_address>
 *   city                    → <g:city>
 *   region                  → <g:region>         state/province code
 *   country                 → <g:country>        ISO 3166-1 alpha-2
 *   postal_code             → <g:postal_code>
 *   latitude                → <g:latitude>
 *   longitude               → <g:longitude>
 *   dealer_name             → <g:dealer_name>
 */

import { db, vehiclesTable, vehicleImagesTable, dealersTable, feedRunsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";

export type FeedVersion = "v1" | "v2"; // both versions produce identical RSS output

// ──────────────────────────────────────────────────────────────────────────────
// Internal vehicle model
// ──────────────────────────────────────────────────────────────────────────────

interface MetaVehicle {
  vehicleId: string;                             // g:vehicle_id (VIN)
  title: string;                                 // <title>
  description: string;                           // <description>
  link: string;                                  // <link> VDP URL
  imageLink: string;                             // g:image_link
  additionalImageLinks: string[];                // g:additional_image_link (repeated)
  price: string;                                 // g:price "28900 USD"
  availability: "in stock" | "out of stock";    // g:availability
  condition: "new" | "used" | "certified pre-owned"; // g:condition
  year: number | null;                           // g:year
  make: string;                                  // g:make
  model: string;                                 // g:model
  trim: string | null;                           // g:trim
  vin: string;                                   // g:vin
  mileage: string | null;                        // g:mileage "48130 mi"
  bodyStyle: string | null;                      // g:body_style
  transmission: string | null;                   // g:transmission
  fuelType: string | null;                       // g:fuel_type
  exteriorColor: string | null;                  // g:exterior_color
  interiorColor: string | null;                  // g:interior_color
  dealerName: string;                            // g:dealer_name
  streetAddress: string;                         // g:street_address
  city: string;                                  // g:city
  region: string;                                // g:region
  country: string;                               // g:country
  postalCode: string;                            // g:postal_code
  latitude: string;                              // g:latitude
  longitude: string;                             // g:longitude
}

// ──────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ──────────────────────────────────────────────────────────────────────────────

export interface MetaFieldStatus {
  vehicle_id: boolean;
  image_link: boolean;
  price: boolean;
  link: boolean;
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
  image_link: number;
  price: number;
  link: number;
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

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "0 USD";
  return `${Math.round(price)} USD`;
}

function formatMileage(mileage: number | null): string | null {
  if (mileage == null) return null;
  return `${mileage} mi`;
}

function getFeedBase(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]!.trim()}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  return "";
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
    const images = (imagesByVehicle.get(v.id) ?? []).sort((a, b) => a.position - b.position);
    const primaryImage = images[0]?.url ?? "";
    const additionalImages = images.slice(1, 10).map((i) => i.url); // up to 9 additional

    const yearStr = v.year ? String(v.year) : "";
    const title = [yearStr, v.make, v.model, v.trim].filter(Boolean).join(" ");

    return {
      vehicleId: v.vin,
      title: title || `Vehicle #${v.id}`,
      description:
        v.description ??
        `${title} available at ${dealerName}. Contact us for more information.`,
      link: v.vdpUrl ?? `${feedBase}/inventory/${v.id}`,
      imageLink: primaryImage,
      additionalImageLinks: additionalImages,
      price: formatPrice(v.price),
      availability: "in stock",
      condition: "used",
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim ?? null,
      vin: v.vin,
      mileage: formatMileage(v.mileage),
      bodyStyle: v.bodyStyle ?? null,
      transmission: v.transmission ?? null,
      fuelType: v.fuelType ?? null,
      exteriorColor: v.exteriorColor ?? null,
      interiorColor: v.interiorColor ?? null,
      dealerName,
      streetAddress: dealer?.addressLine1 ?? "",
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
// XML builder — RSS 2.0 + g: namespace
// ──────────────────────────────────────────────────────────────────────────────

function g(tag: string, value: string | number): string {
  return `    <g:${tag}>${escapeXml(String(value))}</g:${tag}>`;
}

function gCdata(tag: string, value: string): string {
  return `    <g:${tag}>${cdata(value)}</g:${tag}>`;
}

function buildItemXml(v: MetaVehicle): string {
  const additionalImages = v.additionalImageLinks
    .map((url) => `    <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`)
    .join("\n");

  const optional = [
    v.trim ? gCdata("trim", v.trim) : "",
    v.mileage ? g("mileage", v.mileage) : "",
    v.bodyStyle ? gCdata("body_style", v.bodyStyle) : "",
    v.transmission ? gCdata("transmission", v.transmission) : "",
    v.fuelType ? gCdata("fuel_type", v.fuelType) : "",
    v.exteriorColor ? gCdata("exterior_color", v.exteriorColor) : "",
    v.interiorColor ? gCdata("interior_color", v.interiorColor) : "",
    additionalImages,
    v.latitude ? g("latitude", v.latitude) : "",
    v.longitude ? g("longitude", v.longitude) : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Meta-native plain fields (no g: prefix) — added alongside g: namespace fields
  // so the feed satisfies both parsers. These are the names Meta reports as
  // "missing" when it reads the Google Base g: namespace versions as unknown.
  const condition = v.condition === "certified pre-owned" ? "cpo" : v.condition;

  return `  <item>
    <g:vehicle_id>${escapeXml(v.vehicleId)}</g:vehicle_id>
    <title>${cdata(v.title)}</title>
    <description>${cdata(v.description.slice(0, 5000))}</description>
    <link>${escapeXml(v.link)}</link>
    <g:image_link>${escapeXml(v.imageLink)}</g:image_link>
    ${g("price", v.price).trim()}
    ${g("availability", v.availability).trim()}
    ${g("condition", v.condition).trim()}
    ${g("year", String(v.year ?? "")).trim()}
    ${gCdata("make", v.make).trim()}
    ${gCdata("model", v.model).trim()}
    ${g("vin", v.vin).trim()}
    ${g("street_address", v.streetAddress).trim()}
    ${g("city", v.city).trim()}
    ${g("region", v.region).trim()}
    ${g("country", v.country).trim()}
    ${g("postal_code", v.postalCode).trim()}
    ${gCdata("dealer_name", v.dealerName).trim()}
    <vehicle_offer_id>${escapeXml(v.vehicleId)}</vehicle_offer_id>
    <image>${escapeXml(v.imageLink)}</image>
    <state_of_vehicle>${escapeXml(condition)}</state_of_vehicle>
    <street_address>${escapeXml(v.streetAddress)}</street_address>
    <city>${escapeXml(v.city)}</city>
    <region>${escapeXml(v.region)}</region>
    <country>${escapeXml(v.country)}</country>
    <postal_code>${escapeXml(v.postalCode)}</postal_code>
${optional}
  </item>`;
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

  const items = exportable.map((v) => buildItemXml(v)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>${escapeXml(dealerName)} Vehicle Inventory</title>
    <link>${getFeedBase()}</link>
    <description>${escapeXml(dealerName)} — Vehicle Inventory Feed for Meta Automotive Inventory Ads</description>
    <!--
      DealerPilot Meta Automotive Inventory Ads Feed
      Schema  : RSS 2.0 + Google Base g: namespace
      Spec    : developers.facebook.com/docs/marketing-api/auto-ads/guides/catalog/
      Dealer  : ${escapeXml(dealerName)}
      Exported: ${exportable.length} / ${vehicles.length} vehicles
      Generated: ${new Date().toISOString()}
    -->
${items}
  </channel>
</rss>`;
}

/** Minimal 1-vehicle test feed — used to isolate whether the RSS wrapper is the problem */
export async function generateMetaTestFeedXml(dealerId: number): Promise<string> {
  const { vehicles, dealerName } = await loadMetaVehicles(dealerId);
  const exportable = vehicles.filter((v) => validateVehicle(v).valid);
  const sample = exportable[0];

  const sCondition = (sample?.condition === "certified pre-owned" ? "cpo" : sample?.condition) ?? "used";

  if (!sample) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>${escapeXml(dealerName)} Vehicle Inventory (Test)</title>
    <link>${getFeedBase()}</link>
    <description>No exportable vehicles found</description>
  </channel>
</rss>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>${escapeXml(dealerName)} Vehicle Inventory (Test)</title>
    <link>${getFeedBase()}</link>
    <description>${escapeXml(dealerName)} — 1-Vehicle Test Feed for Meta Automotive Inventory Ads</description>
  <item>
    <g:vehicle_id>${escapeXml(sample.vehicleId)}</g:vehicle_id>
    <title>${cdata(sample.title)}</title>
    <description>${cdata(sample.description.slice(0, 5000))}</description>
    <link>${escapeXml(sample.link)}</link>
    <g:image_link>${escapeXml(sample.imageLink)}</g:image_link>
    <g:price>${escapeXml(sample.price)}</g:price>
    <g:availability>${escapeXml(sample.availability)}</g:availability>
    <g:condition>${escapeXml(sample.condition)}</g:condition>
    <g:year>${escapeXml(String(sample.year ?? ""))}</g:year>
    <g:make>${escapeXml(sample.make)}</g:make>
    <g:model>${escapeXml(sample.model)}</g:model>
    <g:vin>${escapeXml(sample.vin)}</g:vin>
    <g:street_address>${escapeXml(sample.streetAddress)}</g:street_address>
    <g:city>${escapeXml(sample.city)}</g:city>
    <g:region>${escapeXml(sample.region)}</g:region>
    <g:country>${escapeXml(sample.country)}</g:country>
    <g:postal_code>${escapeXml(sample.postalCode)}</g:postal_code>
    <g:dealer_name>${escapeXml(sample.dealerName)}</g:dealer_name>
    <vehicle_offer_id>${escapeXml(sample.vehicleId)}</vehicle_offer_id>
    <image>${escapeXml(sample.imageLink)}</image>
    <state_of_vehicle>${escapeXml(sCondition)}</state_of_vehicle>
    <street_address>${escapeXml(sample.streetAddress)}</street_address>
    <city>${escapeXml(sample.city)}</city>
    <region>${escapeXml(sample.region)}</region>
    <country>${escapeXml(sample.country)}</country>
    <postal_code>${escapeXml(sample.postalCode)}</postal_code>
  </item>
  </channel>
</rss>`;
}

// Meta Automotive Inventory Ads — CSV feed
// Column order matches Meta's required headers exactly.
const META_CSV_HEADERS = [
  "id",
  "vehicle_id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "additional_image_link",
  "brand",
  "make",
  "model",
  "year",
  "vin",
  "mileage",
  "body_style",
  "fuel_type",
  "transmission",
  "color",
  "street_address",
  "city",
  "region",
  "postal_code",
  "country",
  "latitude",
  "longitude",
];

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Strip the " mi" unit suffix — Meta wants a bare number for mileage. */
function mileageNumber(raw: string | null): string {
  if (!raw) return "";
  return raw.replace(/\s*mi\s*$/i, "").trim();
}

function vehicleToCsvRow(v: MetaVehicle): string {
  return [
    escapeCsv(v.vehicleId),                                  // id
    escapeCsv(v.vehicleId),                                  // vehicle_id
    escapeCsv(v.title),                                      // title
    escapeCsv(v.description.slice(0, 5000)),                 // description
    escapeCsv(v.availability),                               // availability
    escapeCsv(v.condition),                                  // condition
    escapeCsv(v.price),                                      // price
    escapeCsv(v.link),                                       // link
    escapeCsv(v.imageLink),                                  // image_link
    escapeCsv(v.additionalImageLinks.slice(0, 9).join(",")), // additional_image_link
    escapeCsv(v.make),                                       // brand
    escapeCsv(v.make),                                       // make
    escapeCsv(v.model),                                      // model
    escapeCsv(v.year ?? ""),                                 // year
    escapeCsv(v.vin),                                        // vin
    escapeCsv(mileageNumber(v.mileage)),                     // mileage (number only)
    escapeCsv(v.bodyStyle ?? ""),                            // body_style
    escapeCsv(v.fuelType ?? ""),                             // fuel_type
    escapeCsv(v.transmission ?? ""),                         // transmission
    escapeCsv(v.exteriorColor ?? ""),                        // color
    escapeCsv(v.streetAddress),                              // street_address
    escapeCsv(v.city),                                       // city
    escapeCsv(v.region),                                     // region
    escapeCsv(v.postalCode),                                 // postal_code
    escapeCsv(v.country),                                    // country
    escapeCsv(v.latitude),                                   // latitude
    escapeCsv(v.longitude),                                  // longitude
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
  const hasImageLink = isValidHttpsUrl(v.imageLink);
  const hasPrice = !!(v.price && v.price !== "0 USD");
  const hasLink = isValidHttpsUrl(v.link);

  if (!hasVehicleId) errors.push("vehicle_id missing or too short (need VIN ≥6 chars)");
  if (!hasImageLink) errors.push("image_link missing or not a valid HTTPS URL");
  if (!hasPrice) errors.push("price missing or zero");
  if (!hasLink) errors.push("link (VDP URL) missing or not a valid HTTPS URL");
  if (!v.make) errors.push("make missing");
  if (!v.model) errors.push("model missing");
  if (!v.year) errors.push("year missing");

  if (!v.mileage) warnings.push("mileage not specified");
  if (!v.bodyStyle) warnings.push("body_style not specified");
  if (!v.trim) warnings.push("trim not specified");
  if (!v.exteriorColor) warnings.push("exterior_color not specified");
  if (!v.transmission) warnings.push("transmission not specified");
  if (!v.fuelType) warnings.push("fuel_type not specified");
  if (v.additionalImageLinks.length === 0) warnings.push("no additional images");
  if (!v.description || v.description.length < 20) warnings.push("description too short");

  return {
    vin: v.vehicleId,
    title: v.title,
    valid: errors.length === 0,
    errors,
    warnings,
    fieldStatus: {
      vehicle_id: hasVehicleId,
      image_link: hasImageLink,
      price: hasPrice,
      link: hasLink,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Validate endpoint (existing /validate and /diagnostics)
// ──────────────────────────────────────────────────────────────────────────────

export async function validateMetaCatalog(dealerId: number): Promise<MetaDiagnostics> {
  const { vehicles } = await loadMetaVehicles(dealerId);
  const feedBase = getFeedBase();
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, dealerId));

  const validations = vehicles.map(validateVehicle);

  const fieldCoverage: MetaFieldCoverage = {
    vehicle_id: validations.filter((v) => v.fieldStatus.vehicle_id).length,
    image_link: validations.filter((v) => v.fieldStatus.image_link).length,
    price: validations.filter((v) => v.fieldStatus.price).length,
    link: validations.filter((v) => v.fieldStatus.link).length,
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
  const sampleXml = sample ? buildItemXml(sample) : null;
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
      tag: "g:vehicle_id",
      dealerPilotTag: "g:vehicle_id",
      expectedFormat: "<g:vehicle_id>VIN</g:vehicle_id>",
      check: (x) => x.includes("<g:vehicle_id>"),
      example: (v) => (v ? `<g:vehicle_id>${v.vehicleId}</g:vehicle_id>` : ""),
      note: "RSS 2.0 + g: namespace — unique vehicle identifier (VIN)",
    },
    {
      tag: "g:street_address",
      dealerPilotTag: "g:street_address",
      expectedFormat: "<g:street_address>410 Hudgins Road</g:street_address>",
      check: (x) => x.includes("<g:street_address>"),
      example: (v) => (v ? `<g:street_address>${v.streetAddress}</g:street_address>` : ""),
      note: "Flat field — not nested in <address>",
    },
    {
      tag: "g:city",
      dealerPilotTag: "g:city",
      expectedFormat: "<g:city>Fredericksburg</g:city>",
      check: (x) => x.includes("<g:city>"),
      example: (v) => (v ? `<g:city>${v.city}</g:city>` : ""),
      note: "Flat field — dealer city",
    },
    {
      tag: "g:region",
      dealerPilotTag: "g:region",
      expectedFormat: "<g:region>VA</g:region>",
      check: (x) => x.includes("<g:region>"),
      example: (v) => (v ? `<g:region>${v.region}</g:region>` : ""),
      note: "Flat field — state/province code",
    },
    {
      tag: "g:country",
      dealerPilotTag: "g:country",
      expectedFormat: "<g:country>US</g:country>",
      check: (x) => x.includes("<g:country>"),
      example: (v) => (v ? `<g:country>${v.country}</g:country>` : ""),
      note: "Flat field — ISO 3166-1 alpha-2",
    },
    {
      tag: "g:image_link",
      dealerPilotTag: "g:image_link",
      expectedFormat: "<g:image_link>https://…</g:image_link>",
      check: (x) => x.includes("<g:image_link>"),
      example: (v) => (v ? `<g:image_link>${v.imageLink}</g:image_link>` : ""),
      note: "Primary photo — HTTPS URL, min 500×500 px",
    },
    {
      tag: "g:price",
      dealerPilotTag: "g:price",
      expectedFormat: "<g:price>28900 USD</g:price>",
      check: (x) => x.includes("<g:price>"),
      example: (v) => (v ? `<g:price>${v.price}</g:price>` : ""),
      note: "Amount + ISO 4217 currency code",
    },
    {
      tag: "g:availability",
      dealerPilotTag: "g:availability",
      expectedFormat: '<g:availability>in stock</g:availability>',
      check: (x) => x.includes("<g:availability>in stock") || x.includes("<g:availability>out of stock"),
      example: (v) => (v ? `<g:availability>${v.availability}</g:availability>` : ""),
      note: '"in stock" or "out of stock" — not AVAILABLE/FOR_SALE',
    },
    {
      tag: "g:condition",
      dealerPilotTag: "g:condition",
      expectedFormat: "<g:condition>used</g:condition>",
      check: (x) => x.includes("<g:condition>used") || x.includes("<g:condition>new") || x.includes("<g:condition>certified pre-owned"),
      example: (v) => (v ? `<g:condition>${v.condition}</g:condition>` : ""),
      note: '"new" | "used" | "certified pre-owned" — not GOOD/EXCELLENT',
    },
    {
      tag: "link",
      dealerPilotTag: "link",
      expectedFormat: "<link>https://…/inventory/VIN</link>",
      check: (x) => /<link>https?:\/\//.test(x),
      example: (v) => (v ? `<link>${v.link}</link>` : ""),
      note: "Standard RSS <link> element — no g: prefix, HTTPS VDP URL",
    },
  ];

  const fields: SchemaAuditEntry[] = CHECKS.map(
    ({ tag, dealerPilotTag, expectedFormat, check, example, note }) => ({
      tag,
      status: sample && check(xml) ? "pass" : "fail",
      dealerPilotTag,
      expectedFormat,
      actualExample: example(sample),
      note,
    }),
  );

  return {
    schema: "Meta Automotive Inventory Ads — RSS 2.0 + g: namespace",
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

  const REQUIRED_FIELDS: { key: keyof MetaVehicle; tag: string; fieldName: string }[] = [
    { key: "vehicleId", tag: "g:vehicle_id", fieldName: "vehicle_id" },
    { key: "imageLink", tag: "g:image_link", fieldName: "image_link" },
    { key: "price", tag: "g:price", fieldName: "price" },
    { key: "link", tag: "link", fieldName: "link" },
    { key: "make", tag: "g:make", fieldName: "make" },
    { key: "model", tag: "g:model", fieldName: "model" },
    { key: "year", tag: "g:year", fieldName: "year" },
    { key: "vin", tag: "g:vin", fieldName: "vin" },
    { key: "streetAddress", tag: "g:street_address", fieldName: "street_address" },
    { key: "city", tag: "g:city", fieldName: "city" },
    { key: "region", tag: "g:region", fieldName: "region" },
    { key: "country", tag: "g:country", fieldName: "country" },
    { key: "postalCode", tag: "g:postal_code", fieldName: "postal_code" },
  ];

  const OPTIONAL_FIELDS: { key: keyof MetaVehicle; tag: string; fieldName: string }[] = [
    { key: "mileage", tag: "g:mileage", fieldName: "mileage" },
    { key: "bodyStyle", tag: "g:body_style", fieldName: "body_style" },
    { key: "transmission", tag: "g:transmission", fieldName: "transmission" },
    { key: "fuelType", tag: "g:fuel_type", fieldName: "fuel_type" },
    { key: "exteriorColor", tag: "g:exterior_color", fieldName: "exterior_color" },
    { key: "trim", tag: "g:trim", fieldName: "trim" },
  ];

  const validationResults = vehicles.map((v) => validateVehicle(v));
  const exportable = vehicles.filter((_, i) => validationResults[i]!.valid);
  const blocked = vehicles.filter((_, i) => !validationResults[i]!.valid);

  // Check for duplicate vehicleIds
  const idCounts = new Map<string, number>();
  for (const v of vehicles) {
    idCounts.set(v.vehicleId, (idCounts.get(v.vehicleId) ?? 0) + 1);
  }
  const duplicateIds = [...idCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([id]) => id);

  // Check missing address fields on dealer record
  const missingAddressFields: string[] = [];
  if (!dealer?.addressLine1) missingAddressFields.push("street_address");
  if (!dealer?.city) missingAddressFields.push("city");
  if (!dealer?.state) missingAddressFields.push("region");
  if (!dealer?.country) missingAddressFields.push("country");
  if (!dealer?.postalCode) missingAddressFields.push("postal_code");
  if (!dealer?.latitude) missingAddressFields.push("latitude");
  if (!dealer?.longitude) missingAddressFields.push("longitude");

  // Invalid values
  const invalidValues: ValidateMetaResult["invalidValues"] = [];
  for (const v of vehicles) {
    if (v.price === "0 USD" || !v.price) {
      invalidValues.push({ vehicleId: v.vehicleId, field: "g:price", value: v.price, reason: "Price is zero or missing — vehicle excluded from feed" });
    }
    if (!isValidHttpsUrl(v.imageLink)) {
      invalidValues.push({ vehicleId: v.vehicleId, field: "g:image_link", value: v.imageLink, reason: "Not a valid HTTPS URL" });
    }
    if (!isValidHttpsUrl(v.link)) {
      invalidValues.push({ vehicleId: v.vehicleId, field: "link", value: v.link, reason: "Not a valid HTTPS URL" });
    }
  }

  // Invalid URLs check
  const invalidUrls: ValidateMetaResult["invalidUrls"] = [];
  for (const v of vehicles) {
    if (v.imageLink && !isValidHttpsUrl(v.imageLink)) {
      invalidUrls.push({ vehicleId: v.vehicleId, field: "g:image_link", url: v.imageLink });
    }
    if (v.link && !isValidHttpsUrl(v.link)) {
      invalidUrls.push({ vehicleId: v.vehicleId, field: "link", url: v.link });
    }
  }

  // Field coverage
  const allFieldDefs = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  const fieldCoverage: ValidateMetaFieldCoverage[] = allFieldDefs.map(({ key, tag, fieldName }) => {
    const required = REQUIRED_FIELDS.some((f) => f.key === key);
    let presentCount = 0;
    const exampleInvalidValues: string[] = [];
    for (const v of vehicles) {
      const val = v[key];
      const present = val != null && val !== "" && val !== "0 USD";
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
      coveragePercent: vehicles.length > 0 ? Math.round((presentCount / vehicles.length) * 100) : 100,
      exampleInvalidValues,
    };
  });

  // Compatibility score
  // Base: percent of exportable vs total
  // Deduct: missing required fields at dealer level (address), duplicates
  let score = vehicles.length > 0 ? Math.round((exportable.length / vehicles.length) * 100) : 100;
  if (missingAddressFields.length > 0) score = Math.max(0, score - missingAddressFields.length * 5);
  if (duplicateIds.length > 0) score = Math.max(0, score - duplicateIds.length * 2);

  // Missing fields (fields with 0% coverage across all vehicles)
  const missingFields = fieldCoverage
    .filter((f) => f.required && f.presentCount === 0)
    .map((f) => f.fieldName);

  // Per-vehicle results
  const vehicleResults: ValidateMetaVehicleResult[] = validationResults.map((r) => ({
    vehicleId: r.vin,
    title: r.title,
    valid: r.valid,
    errors: r.errors,
    warnings: r.warnings,
  }));

  void blocked; // used indirectly via validationResults

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
