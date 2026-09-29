import { LUCKI_MAZDA_LOT_WOODBRIDGE } from "../lib/dealer";
import { LUCKI_MAZDA_PHONE } from "../conversations/dealerMessengerPolicy";
import type { NormalizedVehicle } from "./xmlEngine";

type LuckiVehicleInput = Pick<
  NormalizedVehicle,
  | "year"
  | "make"
  | "model"
  | "trim"
  | "mileage"
  | "stockNumber"
  | "exteriorColor"
  | "interiorColor"
  | "bodyStyle"
  | "condition"
  | "transmission"
  | "fuelType"
  | "description"
  | "lotLocation"
>;

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function positiveMileage(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Number(value) > 0;
}

export function deriveLuckiCondition(mileage: number | null | undefined): "New" | "Used" {
  return positiveMileage(mileage) ? "Used" : "New";
}

export function deriveLuckiBodyStyle(vehicle: LuckiVehicleInput): string {
  if (!isBlank(vehicle.bodyStyle)) return String(vehicle.bodyStyle).trim();
  const haystack = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ").toLowerCase();
  if (/sprinter|transit|promaster|cargo van|\bvan\b/.test(haystack)) return "Van";
  if (/pickup|truck|f-150|silverado|tacoma|colorado|frontier|ranger|ram|sierra/.test(haystack)) return "Pickup Truck";
  if (/convertible|miata|mx-5/.test(haystack)) return "Convertible";
  if (/coupe|mustang|challenger|camaro|corvette|911|m4|s5|supra|370z|\bz\b/.test(haystack)) return "Coupe";
  if (/sedan|accord|civic|camry|corolla|altima|mazda3|model 3/.test(haystack)) return "Sedan";
  return "SUV";
}

export function deriveLuckiFuelType(vehicle: LuckiVehicleInput): string {
  if (!isBlank(vehicle.fuelType)) return String(vehicle.fuelType).trim();
  const haystack = [vehicle.make, vehicle.model, vehicle.trim, vehicle.description].filter(Boolean).join(" ").toLowerCase();
  if (/diesel/.test(haystack)) return "Diesel";
  if (/electric|\bev\b|tesla|model 3|model y|leaf|bolt|ioniq|mach-e/.test(haystack)) return "Electric";
  if (/hybrid|plug-in/.test(haystack)) return "Hybrid";
  return "Gasoline Fuel";
}

export function normalizeLuckiDescription(vehicle: LuckiVehicleInput): string {
  const source = isBlank(vehicle.description) ? "" : String(vehicle.description).trim();
  if (source) {
    return source
      .replace(/\btotoday\s*ator\s*callto\b/gi, "today or call to")
      .replace(/\btotoday\b/gi, "today")
      .replace(/\bcallto\b/gi, "call to");
  }

  const label = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((value) => !isBlank(value))
    .join(" ");
  const details: string[] = [];
  if (!isBlank(vehicle.exteriorColor) || !isBlank(vehicle.interiorColor)) {
    const exterior = isBlank(vehicle.exteriorColor) ? "" : `${vehicle.exteriorColor} exterior`;
    const interior = isBlank(vehicle.interiorColor) ? "" : `${vehicle.interiorColor} interior`;
    details.push(`It has a ${[exterior, interior].filter(Boolean).join(" and ")}.`);
  }
  if (positiveMileage(vehicle.mileage)) details.push(`It has ${Number(vehicle.mileage).toLocaleString("en-US")} miles.`);
  if (!isBlank(vehicle.stockNumber)) details.push(`Stock Number ${vehicle.stockNumber}.`);
  return `${label} is available at Lucki Mazda in ${LUCKI_MAZDA_LOT_WOODBRIDGE}. ${details.join(" ")} Contact Lucki Mazda at ${LUCKI_MAZDA_PHONE} to schedule a test drive.`
    .replace(/\s+/g, " ")
    .trim();
}

export function getLuckiIncomingValues(vehicle: LuckiVehicleInput) {
  return {
    lotLocation: LUCKI_MAZDA_LOT_WOODBRIDGE,
    transmission: "Automatic",
    condition: deriveLuckiCondition(vehicle.mileage),
    description: normalizeLuckiDescription(vehicle),
    bodyStyle: deriveLuckiBodyStyle(vehicle),
    fuelType: deriveLuckiFuelType(vehicle),
  };
}

export function fillOnlyWhenBlank<T>(current: T | null | undefined, incoming: T | null | undefined): T | null | undefined {
  return isBlank(current) ? incoming : current;
}
