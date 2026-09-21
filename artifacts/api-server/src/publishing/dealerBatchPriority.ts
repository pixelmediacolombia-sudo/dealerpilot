import { LUCKI_MAZDA_DEALER_ID, LUCKI_MAZDA_LOT_WOODBRIDGE } from "../lib/dealer.ts";

type CompletenessVehicle = {
  vin: string | null;
  stockNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  price: number | null;
  description: string | null;
  vdpUrl: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  bodyStyle: string | null;
  transmission: string | null;
  fuelType: string | null;
  lotLocation: string | null;
};

const LUCKI_COMPLETENESS_FIELDS: Array<keyof CompletenessVehicle> = [
  "vin",
  "stockNumber",
  "year",
  "make",
  "model",
  "trim",
  "mileage",
  "price",
  "description",
  "vdpUrl",
  "exteriorColor",
  "interiorColor",
  "bodyStyle",
  "transmission",
  "fuelType",
];

function hasValue(value: string | number | null): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value?.trim());
}

/**
 * Lucki-only completeness score used to choose the first Marketplace batches.
 * The score is intentionally derived from persisted fields and image count;
 * it never fabricates a missing provider value.
 */
export function getLuckiCompletenessScore(
  vehicle: CompletenessVehicle,
  photoCount: number,
): number {
  const dataScore = LUCKI_COMPLETENESS_FIELDS.reduce(
    (score, field) => score + (hasValue(vehicle[field]) ? 5 : 0),
    0,
  );
  const photoScore = photoCount >= 20 ? 20 : photoCount >= 15 ? 16 : photoCount >= 10 ? 12 : photoCount >= 5 ? 8 : 0;
  const locationScore = vehicle.lotLocation === LUCKI_MAZDA_LOT_WOODBRIDGE ? 5 : 0;
  return dataScore + photoScore + locationScore;
}

/**
 * Keeps Alpha and every other dealer's existing score unchanged. Lucki gets
 * a large leading weight so a complete vehicle is selected before a partial
 * vehicle even when the latter has a stronger body-style or price bonus.
 */
export function getDealerBatchPriority(
  dealerId: number,
  basePriorityScore: number,
  vehicle: CompletenessVehicle,
  photoCount: number,
): { priorityScore: number; completenessScore: number } {
  if (dealerId !== LUCKI_MAZDA_DEALER_ID) {
    return { priorityScore: basePriorityScore, completenessScore: 0 };
  }

  const completenessScore = getLuckiCompletenessScore(vehicle, photoCount);
  return {
    priorityScore: basePriorityScore + completenessScore * 1000,
    completenessScore,
  };
}
