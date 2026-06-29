import type { CreativeTemplate, DealerBrandDna, Vehicle } from "@workspace/db";

export interface CreativeScoreBreakdown {
  brandConsistency: number;
  vehicleVisibility: number;
  lighting: number;
  composition: number;
  ctrPrediction: number;
  overall: number;
  rating: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ratingFor(overall: number): string {
  if (overall >= 85) return "Excellent";
  if (overall >= 70) return "Good";
  return "Needs Improvement";
}

// Different background treatments imply different lighting quality. Stable map
// so the lighting sub-score is explainable and reproducible.
const LIGHTING_BY_BACKGROUND: Record<string, number> = {
  "Luxury Showroom": 100,
  "Dark Studio": 92,
  "Night Lights": 88,
  Showroom: 82,
  "Modern Garage": 78,
  Industrial: 72,
  Outdoor: 65,
};

/**
 * Deterministic 0-100 creative quality score with component sub-scores. No AI is
 * used: every input is measurable from the vehicle, Brand DNA, template, and the
 * available photo count, so scores are stable and explainable.
 */
export function scoreCreative(
  vehicle: Vehicle,
  dna: DealerBrandDna | null,
  template: CreativeTemplate,
  imageCount: number,
): CreativeScoreBreakdown {
  // Brand consistency: how completely the dealer's Brand DNA is expressed.
  let brandConsistency = 0;
  if (dna) {
    if (dna.primaryColors.length > 0) brandConsistency += 25;
    if (dna.secondaryColors.length > 0) brandConsistency += 15;
    if (dna.accentColors.length > 0) brandConsistency += 10;
    if (dna.logoUrl) brandConsistency += 20;
    if (dna.preferredFont) brandConsistency += 10;
    if (dna.brandStyle) brandConsistency += 10;
    if (template.recommendedBrandStyle && dna.brandStyle === template.recommendedBrandStyle) {
      brandConsistency += 10;
    }
  }
  brandConsistency = clamp(brandConsistency, 0, 100);

  // Vehicle visibility: a full photo set yields more usable angles to feature.
  let vehicleVisibility: number;
  if (imageCount >= 8) vehicleVisibility = 100;
  else if (imageCount >= 5) vehicleVisibility = 88;
  else if (imageCount >= 3) vehicleVisibility = 72;
  else if (imageCount >= 1) vehicleVisibility = 50;
  else vehicleVisibility = 15;

  // Lighting: derived from the chosen background style.
  const lighting = LIGHTING_BY_BACKGROUND[dna?.backgroundStyle ?? ""] ?? 75;

  // Composition: premium/luxury templates and body-style-matched templates frame
  // the vehicle more effectively.
  let composition = 60;
  const premium = new Set(["Premium", "Luxury"]);
  composition += premium.has(template.category) ? 20 : 10;
  const bodyMatch =
    !!vehicle.bodyStyle &&
    vehicle.bodyStyle.toLowerCase().includes(template.category.toLowerCase());
  if (bodyMatch) composition += 15;
  if (vehicle.year) composition += 5;
  composition = clamp(composition, 0, 100);

  // CTR prediction: blend weighted toward brand + visibility + lighting, with a
  // small bump when a real price is present (price drives Marketplace clicks).
  let ctrPrediction = Math.round(
    brandConsistency * 0.3 + vehicleVisibility * 0.3 + lighting * 0.2 + composition * 0.2,
  );
  if (vehicle.price && vehicle.price > 0) ctrPrediction += 5;
  ctrPrediction = clamp(ctrPrediction, 0, 100);

  const overall = clamp(
    Math.round(
      brandConsistency * 0.25 +
        vehicleVisibility * 0.25 +
        lighting * 0.2 +
        composition * 0.15 +
        ctrPrediction * 0.15,
    ),
    0,
    100,
  );

  return {
    brandConsistency,
    vehicleVisibility,
    lighting,
    composition,
    ctrPrediction,
    overall,
    rating: ratingFor(overall),
  };
}
