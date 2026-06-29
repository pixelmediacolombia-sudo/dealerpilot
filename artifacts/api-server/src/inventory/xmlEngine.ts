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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: true,
  isArray: () => false,
});

// Lowercase, strip non-alphanumerics so "Stock_Number", "stockNumber", and
// "stock-number" all collapse to "stocknumber".
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build a flat lookup of normalizedKey -> value for one vehicle node, including
// values carried on attributes.
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
      // fast-xml-parser may produce { "#text": "value", attr: ... }
      const text = (v as Record<string, unknown>)["#text"];
      if (text !== undefined && text !== null && String(text).trim() !== "") {
        return String(text).trim();
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
      const text =
        obj["#text"] ?? obj.url ?? obj.href ?? obj.src ?? obj.value ?? obj.image;
      if (text !== undefined) pushUrl(text);
    }
  };

  // Container shapes: <images><image>..</image></images>, <photos><photo>..,
  // <pictures><picture>.., plus comma-separated string lists.
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

  // Flat repeated/single keys: <imageurl>, <photourl>, <image>.
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
    if (typeof node !== "object" || node === null || Array.isArray(node))
      return false;
    const lookup = buildLookup(node as Record<string, unknown>);
    const signals = [
      "vin",
      "make",
      "model",
      "year",
      "stocknumber",
      "stockno",
      "stock",
      "price",
    ];
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
      // A single vehicle node (feed with exactly one vehicle, not in an array).
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
  let vin = firstString(lookup, ["vin", "vinnumber", "vehicleid", "vehicleidnumber"]);
  const stockNumber = firstString(lookup, [
    "stocknumber",
    "stockno",
    "stock",
    "stockid",
    "dealerstocknumber",
  ]);

  // A vehicle is only usable if we can identify it and at least name it.
  if (!make || !model) return null;
  if (!vin) {
    if (stockNumber) vin = `STOCK-${stockNumber}`;
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
};

export function parseInventoryXml(xml: string): ParseResult {
  const parsed = parser.parse(xml);
  const nodes = findVehicleNodes(parsed);
  const vehicles: NormalizedVehicle[] = [];
  for (const node of nodes) {
    const normalized = normalizeNode(node);
    if (normalized) vehicles.push(normalized);
  }
  return { vehicles, rawCount: nodes.length };
}
