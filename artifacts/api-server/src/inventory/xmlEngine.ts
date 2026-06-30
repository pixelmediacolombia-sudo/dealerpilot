import { XMLParser } from "fast-xml-parser";

export type FeedImage = {
  url: string;
  category?: string; // e.g. "exterior", "other" from Google Base <g:tag>
};

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
  images: FeedImage[];
  sourceRaw: string;
};

// Repeated element tag names — bare and Google Base namespaced variants.
const ARRAY_TAG_LOCALS = new Set(["image", "photo", "picture", "item"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: true,
  isArray: (tagName: string) => {
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
      const text = obj["#text"];
      if (text !== undefined && text !== null && String(text).trim() !== "") {
        return String(text).trim();
      }
      // Nested value field: handles Google Base <g:mileage><g:value>N</g:value></g:mileage>
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

// Collect URL strings from arbitrary nested structures (generic fallback).
function collectUrls(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  if (typeof val === "string") {
    return val
      .split(/[,\s]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }
  if (typeof val === "number") return [];
  if (Array.isArray(val)) return val.flatMap(collectUrls);
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    let text: unknown =
      obj["#text"] ?? obj.url ?? obj.href ?? obj.src ?? obj.value ?? obj.image;
    if (text === undefined) {
      for (const [k, v] of Object.entries(obj)) {
        const nk = normalizeKey(k);
        if (nk === "url" || nk === "href" || nk === "src") {
          text = v;
          break;
        }
      }
    }
    if (text !== undefined) return collectUrls(text);
  }
  return [];
}

function extractImages(node: Record<string, unknown>): FeedImage[] {
  const lookup = buildLookup(node);
  const results: FeedImage[] = [];
  const seen = new Set<string>();

  const addUrl = (url: string, category?: string) => {
    if (seen.has(url)) return;
    if (!/^(https?:\/\/|\/)/.test(url)) return;
    seen.add(url);
    results.push(category ? { url, category } : { url });
  };

  // --- Google Base structured image array (primary path) ---
  // After namespace stripping: lookup.get("image") = [{url:…, tag:…}, …]
  const imageVal = lookup.get("image");
  if (Array.isArray(imageVal)) {
    for (const item of imageVal) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      let url: string | undefined;
      let category: string | undefined;
      for (const [k, v] of Object.entries(obj)) {
        const nk = normalizeKey(k);
        if (nk === "url" && typeof v === "string" && v.trim()) url = v.trim();
        if (nk === "tag" && typeof v === "string" && v.trim())
          category = v.trim().toLowerCase();
      }
      if (url) addUrl(url, category);
    }
    if (results.length > 0) return results;
  }

  // --- Generic fallback: container shapes ---
  const containerKeys = ["images", "photos", "pictures", "imageurls", "photourls"];
  for (const ck of containerKeys) {
    const container = lookup.get(ck);
    if (container === undefined || container === null) continue;
    if (typeof container === "string") {
      collectUrls(container).forEach((u) => addUrl(u));
      continue;
    }
    if (Array.isArray(container)) {
      collectUrls(container).forEach((u) => addUrl(u));
      continue;
    }
    if (typeof container === "object") {
      const inner = container as Record<string, unknown>;
      const itemKeys = ["image", "photo", "picture", "img", "url", "href"];
      let matched = false;
      for (const ik of itemKeys) {
        for (const [rk, rv] of Object.entries(inner)) {
          if (normalizeKey(rk) === ik) {
            collectUrls(rv).forEach((u) => addUrl(u));
            matched = true;
          }
        }
      }
      if (!matched) collectUrls(Object.values(inner)).forEach((u) => addUrl(u));
    }
  }

  // --- Generic fallback: flat repeated/single keys ---
  const flatKeys = [
    "imageurl", "photourl", "image", "photo", "picture", "thumbnail", "mainimage",
  ];
  for (const fk of flatKeys) {
    if (lookup.has(fk)) collectUrls(lookup.get(fk)).forEach((u) => addUrl(u));
  }

  return results;
}

function findVehicleNodes(value: unknown): Record<string, unknown>[] {
  let best: Record<string, unknown>[] = [];

  const looksLikeVehicle = (node: unknown): boolean => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
    const lookup = buildLookup(node as Record<string, unknown>);
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
  let vin = firstString(lookup, ["vin", "vinnumber", "vehicleidnumber"]);
  const stockNumber = firstString(lookup, [
    "stocknumber", "stockno", "stock", "stockid", "dealerstocknumber",
    "vehicleid", // Google Base: g:vehicle_id is the stock/dealer number
  ]);

  if (!make || !model) return null;
  if (!vin) {
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
    mileage: firstNumber(lookup, ["mileage", "miles", "odometer", "kilometers"]),
    price: firstNumber(lookup, [
      "price", "sellingprice", "askingprice", "internetprice",
      "saleprice", "listprice", "msrp",
    ]),
    exteriorColor: firstString(lookup, ["exteriorcolor", "extcolor", "color", "colour", "exterior"]),
    interiorColor: firstString(lookup, ["interiorcolor", "intcolor", "interior"]),
    bodyStyle: firstString(lookup, ["bodystyle", "body", "bodytype", "style"]),
    transmission: firstString(lookup, ["transmission", "trans", "gearbox"]),
    fuelType: firstString(lookup, ["fueltype", "fuel", "enginefuel"]),
    description: firstString(lookup, [
      "description", "comments", "sellercomments", "dealercomments",
      "details", "vehiclecomments",
    ]),
    vdpUrl: firstString(lookup, ["vdpurl", "vdp", "detailurl", "detailspageurl", "link", "url"]),
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
