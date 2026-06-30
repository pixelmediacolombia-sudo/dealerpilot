import { XMLParser } from "fast-xml-parser";

export type NormalizedVehicle = {
  vin: string;
  stockNumber: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  mileage: number | null;
  price: number | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  bodyStyle: string | null;
  transmission: string | null;
  fuelType: string | null;
  description: string | null;
  vdpUrl: string | null;
  images: string[];
  sourceRaw: string;
};

// Repeated element tag names — both bare and Google Base namespaced variants.
// This ensures <g:image>…</g:image> appearing multiple times is parsed as an
// array rather than the last-wins scalar fast-xml-parser default.
const ARRAY_TAG_LOCALS = new Set(["image", "photo", "picture", "item"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: true,
  isArray: (tagName: string) => {
    // tagName may be namespace-prefixed ("g:image"); extract the local part.
    const local = tagName.includes(":") ? tagName.split(":").pop()! : tagName;
    return ARRAY_TAG_LOCALS.has(local.toLowerCase());
  },
});

// Strip namespace prefix ("g:" → ""), lowercase, strip non-alphanumerics.
// "g:body_style" → "bodystyle"  |  "Stock_Number" → "stocknumber"
function normalizeKey(key: string): string {
  const colonIdx = key.indexOf(":");
  const localName = colonIdx >= 0 ? key.slice(colonIdx + 1) : key;
  return localName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build a flat lookup of normalizedKey → value for one vehicle node.
function buildLookup(node: Record<string, unknown>): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  for (const [rawKey, value] of Object.entries(node)) {
    const key = normalizeKey(rawKey);
    if (!lookup.has(key)) lookup.set(key, value);
  }
  return lookup;
}

function firstString(lookup: Map<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = lookup.get(k);
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      // Standard fast-xml-parser text node
      const text = obj["#text"];
      if (text !== undefined && text !== null && String(text).trim() !== "") {
        return String(text).trim();
      }
      // Nested value field: handles Google Base <g:mileage><g:value>N</g:value></g:mileage>
      // After namespace stripping the inner key becomes "value".
      for (const [ck, cv] of Object.entries(obj)) {
        const nk = normalizeKey(ck);
        if (nk === "value" || nk === "text") {
          if (cv !== null && cv !== undefined && String(cv).trim() !== "") {
            return String(cv).trim();
          }
        }
      }
      continue;
    }
    const s = String(v).trim();
    if (s !== "") return s;
  }
  return null;
}

function firstNumber(lookup: Map<string, unknown>, keys: string[]): number | null {
  const s = firstString(lookup, keys);
  if (s === null) return null;
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (cleaned === "") return null;
  const n = Math.round(Number(cleaned));
  return Number.isFinite(n) ? n : null;
}

function extractImages(node: Record<string, unknown>): string[] {
  const lookup = buildLookup(node);
  const urls: string[] = [];

  const pushUrl = (val: unknown) => {
    if (val === undefined || val === null) return;
    if (typeof val === "string") {
      val
        .split(/[,\s]+/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
        .forEach((u) => urls.push(u));
      return;
    }
    if (typeof val === "number") return;
    if (Array.isArray(val)) {
      val.forEach(pushUrl);
      return;
    }
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      // Try direct bare keys first
      let text: unknown =
        obj["#text"] ?? obj.url ?? obj.href ?? obj.src ?? obj.value ?? obj.image;
      // Namespace-prefixed fallback: "g:url" normalizes to "url"
      if (text === undefined) {
        for (const [k, v] of Object.entries(obj)) {
          const nk = normalizeKey(k);
          if (nk === "url" || nk === "href" || nk === "src") {
            text = v;
            break;
          }
        }
      }
      if (text !== undefined) pushUrl(text);
    }
  };

  // Container shapes: <images><image>…</image></images> etc.
  const containerKeys = ["images", "photos", "pictures", "imageurls", "photourls"];
  const itemKeys = ["image", "photo", "picture", "img", "url", "href"];

  for (const ck of containerKeys) {
    const container = lookup.get(ck);
    if (container === undefined || container === null) continue;
    if (typeof container === "string") {
      pushUrl(container);
      continue;
    }
    if (Array.isArray(container)) {
      pushUrl(container);
      continue;
    }
    if (typeof container === "object") {
      const inner = container as Record<string, unknown>;
      let matched = false;
      for (const ik of itemKeys) {
        for (const [rk, rv] of Object.entries(inner)) {
          if (normalizeKey(rk) === ik) {
            pushUrl(rv);
            matched = true;
          }
        }
      }
      if (!matched) pushUrl(Object.values(inner));
    }
  }

  // Flat repeated/single keys: <image>, <g:image> (after normalization → "image"), etc.
  const flatKeys = [
    "imageurl",
    "photourl",
    "image",
    "photo",
    "picture",
    "thumbnail",
    "mainimage",
  ];
  for (const fk of flatKeys) {
    if (lookup.has(fk)) pushUrl(lookup.get(fk));
  }

  // De-duplicate, preserve order, keep only plausible URLs/paths.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    if (!/^(https?:\/\/|\/)/.test(u)) continue;
    seen.add(u);
    result.push(u);
  }
  return result;
}

// Recursively find the largest array of nodes that look like vehicles.
function findVehicleNodes(value: unknown): Record<string, unknown>[] {
  let best: Record<string, unknown>[] = [];

  const looksLikeVehicle = (node: unknown): boolean => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
    const lookup = buildLookup(node as Record<string, unknown>);
    // After namespace stripping, "g:make" → "make", "g:vin" → "vin", etc.
    const signals = ["vin", "make", "model", "year", "stocknumber", "stockno", "stock", "price", "vehicleid"];
    let hits = 0;
    for (const s of signals) if (lookup.has(s)) hits++;
    return hits >= 2;
  };

  const visit = (val: unknown) => {
    if (Array.isArray(val)) {
      const vehicles = val.filter(looksLikeVehicle) as Record<string, unknown>[];
      if (vehicles.length > best.length) best = vehicles;
      val.forEach(visit);
      return;
    }
    if (typeof val === "object" && val !== null) {
      if (looksLikeVehicle(val) && best.length === 0) {
        best = [val as Record<string, unknown>];
      }
      for (const child of Object.values(val)) visit(child);
    }
  };

  visit(value);
  return best;
}

function normalizeNode(node: Record<string, unknown>): NormalizedVehicle | null {
  const lookup = buildLookup(node);

  const make = firstString(lookup, ["make", "manufacturer", "brand", "makename"]);
  const model = firstString(lookup, ["model", "modelname"]);
  // "g:vin" → "vin" after namespace strip; "g:vehicle_id" → "vehicleid" (stock number, VIN fallback).
  let vin = firstString(lookup, ["vin", "vinnumber", "vehicleidnumber"]);
  const stockNumber = firstString(lookup, [
    "stocknumber",
    "stockno",
    "stock",
    "stockid",
    "dealerstocknumber",
    "vehicleid",   // Google Base: g:vehicle_id is the stock/dealer number
  ]);

  if (!make || !model) return null;
  if (!vin) {
    // Last-resort: use vehicleid as surrogate VIN (feeds that have no vin field)
    const vid = firstString(lookup, ["vehicleid"]);
    if (vid) vin = `VID-${vid}`;
    else if (stockNumber) vin = `STOCK-${stockNumber}`;
    else return null;
  }

  return {
    vin,
    stockNumber,
    year: firstNumber(lookup, ["year", "modelyear", "vehicleyear"]),
    make,
    model,
    trim: firstString(lookup, ["trim", "trimlevel", "series", "subseries"]),
    // Google Base mileage: <g:mileage><g:value>N</g:value></g:mileage>
    // firstString handles the nested "value" child automatically.
    mileage: firstNumber(lookup, ["mileage", "miles", "odometer", "kilometers"]),
    price: firstNumber(lookup, [
      "price",
      "sellingprice",
      "askingprice",
      "internetprice",
      "saleprice",
      "listprice",
      "msrp",
    ]),
    exteriorColor: firstString(lookup, [
      "exteriorcolor",
      "extcolor",
      "color",
      "colour",
      "exterior",
    ]),
    interiorColor: firstString(lookup, ["interiorcolor", "intcolor", "interior"]),
    bodyStyle: firstString(lookup, ["bodystyle", "body", "bodytype", "style"]),
    transmission: firstString(lookup, ["transmission", "trans", "gearbox"]),
    fuelType: firstString(lookup, ["fueltype", "fuel", "enginefuel"]),
    description: firstString(lookup, [
      "description",
      "comments",
      "sellercomments",
      "dealercomments",
      "details",
      "vehiclecomments",
    ]),
    vdpUrl: firstString(lookup, [
      "vdpurl",
      "vdp",
      "detailurl",
      "detailspageurl",
      "link",
      "url",
    ]),
    images: extractImages(node),
    sourceRaw: JSON.stringify(node),
  };
}

export type ParseResult = {
  vehicles: NormalizedVehicle[];
  rawCount: number;
  errors: number;
};

export function parseInventoryXml(xml: string): ParseResult {
  const parsed = parser.parse(xml);
  const nodes = findVehicleNodes(parsed);
  const vehicles: NormalizedVehicle[] = [];
  for (const node of nodes) {
    const normalized = normalizeNode(node);
    if (normalized) vehicles.push(normalized);
  }
  return { vehicles, rawCount: nodes.length, errors: nodes.length - vehicles.length };
}
