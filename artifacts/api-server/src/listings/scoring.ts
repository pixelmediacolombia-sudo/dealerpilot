import type { ListingVersion, Vehicle } from "@workspace/db";

export interface ListingScoreBreakdown {
  titleQuality: number;
  descriptionQuality: number;
  priceStrategy: number;
  downPaymentStrategy: number;
  photoScore: number;
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

/**
 * Deterministic 0-100 listing quality score for a version, with component
 * sub-scores. No AI is used here: every input is measurable from the version,
 * the vehicle, and the photo count so the score is stable and explainable.
 */
export function scoreListing(
  version: Pick<
    ListingVersion,
    | "title"
    | "descriptionEn"
    | "descriptionEs"
    | "askingPrice"
    | "downPayment"
  >,
  vehicle: Vehicle,
  imageCount: number,
): ListingScoreBreakdown {
  // Title: present, within the 100-char Marketplace limit, no emojis, and
  // includes the key year/make/model tokens that drive search relevance.
  const title = (version.title ?? "").trim();
  let titleQuality = 0;
  if (title.length > 0) titleQuality += 30;
  if (title.length >= 25 && title.length <= 100) titleQuality += 30;
  else if (title.length > 0 && title.length <= 100) titleQuality += 15;
  const lowerTitle = title.toLowerCase();
  const tokens = [
    vehicle.year ? String(vehicle.year) : "",
    vehicle.make,
    vehicle.model,
  ].filter(Boolean) as string[];
  const present = tokens.filter((t) => lowerTitle.includes(t.toLowerCase())).length;
  if (tokens.length > 0) titleQuality += Math.round((present / tokens.length) * 30);
  const hasEmoji = /\p{Extended_Pictographic}/u.test(title);
  if (title.length > 100 || hasEmoji) titleQuality -= 25;
  titleQuality = clamp(titleQuality, 0, 100);

  // Description: both Spanish and English present and substantive.
  const en = (version.descriptionEn ?? "").trim();
  const es = (version.descriptionEs ?? "").trim();
  let descriptionQuality = 0;
  if (en.length >= 120) descriptionQuality += 45;
  else if (en.length > 0) descriptionQuality += 20;
  if (es.length >= 120) descriptionQuality += 45;
  else if (es.length > 0) descriptionQuality += 20;
  if (en.length > 0 && es.length > 0) descriptionQuality += 10;
  descriptionQuality = clamp(descriptionQuality, 0, 100);

  // Price strategy: asking price present and matching the source vehicle price.
  const asking = version.askingPrice ?? 0;
  let priceStrategy = 0;
  if (asking > 0) {
    priceStrategy += 60;
    if (vehicle.price && vehicle.price > 0) {
      const diff = Math.abs(asking - vehicle.price) / vehicle.price;
      if (diff <= 0.02) priceStrategy += 40;
      else if (diff <= 0.1) priceStrategy += 20;
    } else {
      priceStrategy += 20;
    }
  }
  priceStrategy = clamp(priceStrategy, 0, 100);

  // Down payment strategy: score only whether an approved value was persisted.
  // Amount selection belongs to effective-dated dealer configuration, not this scorer.
  const dp = version.downPayment ?? 0;
  let downPaymentStrategy = 0;
  if (dp > 0) {
    downPaymentStrategy = 100;
  }
  downPaymentStrategy = clamp(downPaymentStrategy, 0, 100);

  // Photos: Marketplace listings perform best with a full set of images.
  let photoScore: number;
  if (imageCount >= 8) photoScore = 100;
  else if (imageCount >= 5) photoScore = 85;
  else if (imageCount >= 3) photoScore = 65;
  else if (imageCount >= 1) photoScore = 40;
  else photoScore = 0;

  const overall = clamp(
    Math.round(
      titleQuality * 0.25 +
        descriptionQuality * 0.3 +
        priceStrategy * 0.2 +
        downPaymentStrategy * 0.15 +
        photoScore * 0.1,
    ),
    0,
    100,
  );

  return {
    titleQuality,
    descriptionQuality,
    priceStrategy,
    downPaymentStrategy,
    photoScore,
    overall,
    rating: ratingFor(overall),
  };
}
