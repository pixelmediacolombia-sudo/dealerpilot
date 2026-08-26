import type { Vehicle } from "@workspace/db";

export type VehicleCategory = "Sedan" | "SUV" | "Truck" | "Luxury";

const LUXURY_MAKES = new Set([
  "bmw",
  "mercedes",
  "mercedes-benz",
  "audi",
  "lexus",
  "porsche",
  "jaguar",
  "land rover",
  "range rover",
  "infiniti",
  "acura",
  "cadillac",
  "tesla",
  "maserati",
  "bentley",
  "lincoln",
  "genesis",
  "volvo",
  "alfa romeo",
]);

const LUXURY_PRICE_FLOOR = 45000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Classify a vehicle into the rule-engine category used for down-payment and
 * scoring. Order matters: luxury (by make or price) wins, then truck, then SUV,
 * else sedan.
 */
export function categorize(vehicle: Vehicle): VehicleCategory {
  const make = (vehicle.make ?? "").trim().toLowerCase();
  const body = (vehicle.bodyStyle ?? "").trim().toLowerCase();
  const price = vehicle.price ?? 0;

  if (LUXURY_MAKES.has(make) || price >= LUXURY_PRICE_FLOOR) {
    return "Luxury";
  }
  if (/(truck|pickup|crew cab|super duty|cab)/.test(body)) {
    return "Truck";
  }
  if (/(suv|crossover|cuv|sport utility|wagon|van|minivan)/.test(body)) {
    return "SUV";
  }
  return "Sedan";
}

/**
 * Workspace-level priority score (0-100). Deterministic, derived from inventory
 * signals only: status urgency, photo completeness, price presence, and how
 * recently the vehicle was added/synced. Higher = publish sooner.
 */
export function priorityScore(vehicle: Vehicle, imageCount: number): number {
  let score = 40;

  switch (vehicle.status) {
    case "Ready to Publish":
      score += 30;
      break;
    case "Price Changed":
      score += 25;
      break;
    case "New":
      score += 20;
      break;
    case "Active":
      score += 12;
      break;
    case "Published":
      score -= 20;
      break;
    case "Sold/Removed":
    case "Archived":
      score -= 40;
      break;
    default:
      break;
  }

  if (imageCount >= 5) score += 12;
  else if (imageCount >= 1) score += 6;
  else score -= 10;

  if (vehicle.price && vehicle.price > 0) score += 8;

  const ageDays =
    (Date.now() - new Date(vehicle.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) score += 10;
  else if (ageDays <= 14) score += 4;

  return clamp(Math.round(score), 0, 100);
}
