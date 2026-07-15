import sharp from "sharp";
import { ESTIMATED_PROVIDER_RESTORATION_COST_USD, fetchImageBufferForPolicy, isRestorableClassification } from "./restorationPolicy";
import { CLASSIFICATION_PRIORITY } from "./providers/types";

export type PhotoDirectorMode = "economy" | "balanced" | "premium";
export type PhotoDirectorTreatment =
  | "PUBLISH_AS_IS"
  | "LOCAL_ENHANCEMENT"
  | "PAID_AI_RESTORATION"
  | "REJECT";

export const PHOTO_DIRECTOR_COST_CAPS_USD: Record<PhotoDirectorMode, number> = {
  economy: 0,
  balanced: 0.2,
  premium: 0.35,
};

export function normalizePhotoDirectorMode(value: unknown): PhotoDirectorMode {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "premium") return "premium";
  if (raw === "economy") return "economy";
  return "balanced";
}

export function paidRestorationLimitForDirectorMode(mode: PhotoDirectorMode): number {
  if (mode === "premium") return 3;
  if (mode === "economy") return 0;
  return 2;
}

export interface PhotoDirectorInput {
  id: number;
  originalUrl: string;
  classification: string | null;
  classificationConfidence: number | null;
  position: number | null;
}

interface LocalPhotoMetrics {
  width: number;
  height: number;
  aspectRatio: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  shadowRatio: number;
  highlightRatio: number;
  noise: number;
  compressionRatio: number;
  resolutionScore: number;
  exposureScore: number;
  contrastScore: number;
  sharpnessScore: number;
  noiseScore: number;
  qualityScore: number;
  averageHash: string;
}

interface AnalyzedPhoto {
  id: number;
  originalUrl: string;
  classification: string;
  normalizedType: string;
  classificationConfidence: number;
  classificationSource: "existing" | "fallback";
  position: number;
  metrics: LocalPhotoMetrics | null;
  qualityScore: number;
  selectionScore: number;
  warnings: string[];
  rejected: boolean;
  rejectionReason: string | null;
  duplicateOfId: number | null;
  duplicateDistance: number | null;
}

export interface PhotoDirectorPhoto {
  id: number;
  order: number | null;
  position: number;
  photoType: string;
  originalUrl: string;
  selected: boolean;
  hero: boolean;
  qualityScore: number;
  classificationConfidence: number;
  classificationSource: "existing" | "fallback";
  selectionReason: string;
  treatment: PhotoDirectorTreatment;
  treatmentLabel: string;
  estimatedCostUsd: number;
  warnings: string[];
  duplicateOfId: number | null;
  metrics: LocalPhotoMetrics | null;
}

export interface PhotoDirectorPlan {
  vehicleId: number;
  mode: PhotoDirectorMode;
  sourceSetId: number | null;
  totalPhotosAnalyzed: number;
  selectedPhotoIds: number[];
  topSelectedCount: number;
  heroPhotoId: number | null;
  duplicateRejectedCount: number;
  rejectedPhotoCount: number;
  publishAsIsCount: number;
  localEnhancementCount: number;
  paidAiRestorationCount: number;
  paidAiRestorationPhotoIds: number[];
  estimatedCostUsd: number;
  defaultCostCapUsd: number;
  estimatedCostAvoidedUsd: number;
  localAnalysisCostUsd: number;
  photos: PhotoDirectorPhoto[];
  rejectedPhotos: PhotoDirectorPhoto[];
  finalImageOrder: number[];
  costSummary: {
    totalPhotosReviewed: number;
    selectedPhotos: number;
    localAnalysisCostUsd: number;
    localEnhancements: number;
    paidAiCalls: number;
    estimatedPaidCostUsd: number;
    estimatedCostAvoidedUsd: number;
    unitCostUsd: number;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreRange(value: number, goodLow: number, goodHigh: number, hardLow: number, hardHigh: number): number {
  if (value >= goodLow && value <= goodHigh) return 10;
  if (value < goodLow) return clamp(((value - hardLow) / Math.max(1, goodLow - hardLow)) * 10, 0, 10);
  return clamp(((hardHigh - value) / Math.max(1, hardHigh - goodHigh)) * 10, 0, 10);
}

function normalizeType(classification: string): string {
  const lower = classification.toLowerCase();
  if (lower.includes("front 45")) return "Exterior Front 45";
  if (lower.includes("front")) return "Exterior Front";
  if (lower.includes("side")) return "Exterior Side";
  if (lower.includes("rear 45")) return "Exterior Rear 45";
  if (lower.includes("rear")) return "Exterior Rear";
  if (lower.includes("dashboard")) return "Dashboard";
  if (lower.includes("steering")) return "Steering Wheel";
  if (lower.includes("center console") || lower.includes("infotainment")) return "Center Console";
  if (lower.includes("driver seat") || lower.includes("passenger seat")) return "Front Seats";
  if (lower.includes("rear seat")) return "Rear Seats";
  if (lower.includes("cargo") || lower.includes("trunk")) return "Cargo";
  if (lower.includes("engine")) return "Engine";
  if (lower.includes("wheel")) return "Wheel";
  if (lower.includes("headlight") || lower.includes("taillight") || lower.includes("badge") || lower.includes("detail")) return "Detail";
  return "Unknown";
}

function isExteriorType(type: string): boolean {
  return type.startsWith("Exterior") || type === "Wheel" || type === "Engine" || type === "Detail";
}

function isInteriorType(type: string): boolean {
  return ["Dashboard", "Steering Wheel", "Center Console", "Front Seats", "Rear Seats", "Cargo"].includes(type);
}

function rolePriority(type: string): number {
  switch (type) {
    case "Exterior Front":
    case "Exterior Front 45":
      return 0;
    case "Exterior Side":
      return 2;
    case "Exterior Rear":
    case "Exterior Rear 45":
      return 3;
    case "Dashboard":
      return 4;
    case "Center Console":
      return 5;
    case "Front Seats":
      return 6;
    case "Rear Seats":
    case "Cargo":
      return 7;
    case "Wheel":
    case "Engine":
    case "Detail":
      return 8;
    case "Steering Wheel":
      return 9;
    default:
      return 10;
  }
}

async function measureLocalPhoto(url: string): Promise<LocalPhotoMetrics> {
  const buffer = await fetchImageBufferForPolicy(url);
  const image = sharp(buffer).rotate();
  const [metadata, stats, gray] = await Promise.all([
    image.metadata(),
    image.stats(),
    sharp(buffer)
      .rotate()
      .resize({ width: 64, height: 64, fit: "fill", kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .raw()
      .toBuffer(),
  ]);

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pixels = [...gray];
  const mean = pixels.reduce((sum, pixel) => sum + pixel, 0) / Math.max(1, pixels.length);
  const variance = pixels.reduce((sum, pixel) => sum + Math.pow(pixel - mean, 2), 0) / Math.max(1, pixels.length);
  let adjacentDiff = 0;
  for (let i = 1; i < pixels.length; i++) {
    adjacentDiff += Math.abs((pixels[i] ?? 0) - (pixels[i - 1] ?? 0));
  }
  adjacentDiff /= Math.max(1, pixels.length - 1);

  const shadowRatio = pixels.filter((pixel) => pixel < 38).length / Math.max(1, pixels.length);
  const highlightRatio = pixels.filter((pixel) => pixel > 238).length / Math.max(1, pixels.length);
  const contrast = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, stats.channels.slice(0, 3).length);
  const brightness = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / Math.max(1, stats.channels.slice(0, 3).length);
  const compressionRatio = buffer.length / Math.max(1, width * height);
  const threshold = mean;
  const averageHash = pixels.map((pixel) => (pixel >= threshold ? "1" : "0")).join("");

  const resolutionScore = clamp(Math.min(width, height) / 90, 0, 10);
  const exposureScore = scoreRange(brightness, 95, 190, 45, 230);
  const contrastScore = scoreRange(contrast, 38, 82, 16, 130);
  const sharpnessScore = clamp(adjacentDiff / 1.25, 0, 10);
  const noise = Math.max(0, Math.sqrt(variance) - adjacentDiff * 0.42);
  const noiseScore = clamp(10 - Math.max(0, noise - 18) / 4, 0, 10);
  const clippingPenalty = clamp((shadowRatio + highlightRatio) * 18, 0, 3);
  const qualityScore = clamp(
    resolutionScore * 0.12 +
      exposureScore * 0.22 +
      contrastScore * 0.2 +
      sharpnessScore * 0.28 +
      noiseScore * 0.12 +
      (10 - clippingPenalty) * 0.06,
    0,
    10,
  );

  return {
    width,
    height,
    aspectRatio: width > 0 && height > 0 ? Number((width / height).toFixed(3)) : 0,
    brightness: Number(brightness.toFixed(2)),
    contrast: Number(contrast.toFixed(2)),
    sharpness: Number(adjacentDiff.toFixed(2)),
    shadowRatio: Number(shadowRatio.toFixed(3)),
    highlightRatio: Number(highlightRatio.toFixed(3)),
    noise: Number(noise.toFixed(2)),
    compressionRatio: Number(compressionRatio.toFixed(4)),
    resolutionScore: Number(resolutionScore.toFixed(2)),
    exposureScore: Number(exposureScore.toFixed(2)),
    contrastScore: Number(contrastScore.toFixed(2)),
    sharpnessScore: Number(sharpnessScore.toFixed(2)),
    noiseScore: Number(noiseScore.toFixed(2)),
    qualityScore: Number(qualityScore.toFixed(2)),
    averageHash,
  };
}

function hammingDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return Number.MAX_SAFE_INTEGER;
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

async function analyzePhoto(input: PhotoDirectorInput): Promise<AnalyzedPhoto> {
  const classification = input.classification || "Miscellaneous";
  const normalizedType = normalizeType(classification);
  const confidence = Number(input.classificationConfidence ?? (classification === "Miscellaneous" ? 0.35 : 0.72));
  const warnings: string[] = [];
  let metrics: LocalPhotoMetrics | null = null;

  try {
    metrics = await measureLocalPhoto(input.originalUrl);
    if (metrics.width < 900 || metrics.height < 600) warnings.push("low_resolution");
    if (metrics.shadowRatio > 0.34) warnings.push("shadow_detail_risk");
    if (metrics.highlightRatio > 0.18) warnings.push("highlight_clipping_risk");
    if (metrics.sharpnessScore < 4.2) warnings.push("blur_or_low_micro_detail");
    if (metrics.noiseScore < 5.5) warnings.push("noise_or_compression_damage");
    if (metrics.exposureScore < 5.5) warnings.push("exposure_issue");
    if (metrics.contrastScore < 5.5) warnings.push("local_contrast_issue");
  } catch (err) {
    warnings.push(`analysis_failed:${err instanceof Error ? err.message : String(err)}`);
  }

  let rejected = false;
  let rejectionReason: string | null = null;
  if (!isRestorableClassification(classification)) {
    rejected = true;
    rejectionReason = "non_publishable_technical_or_dealer_photo";
  } else if (metrics && (metrics.width < 600 || metrics.height < 420)) {
    rejected = true;
    rejectionReason = "unusable_resolution";
  } else if (metrics && metrics.qualityScore < 2.4) {
    rejected = true;
    rejectionReason = "severe_quality_issue";
  }

  const priority = CLASSIFICATION_PRIORITY[classification as keyof typeof CLASSIFICATION_PRIORITY] ?? 33;
  const qualityScore = metrics?.qualityScore ?? 4;
  const selectionScore = qualityScore * 10 + Math.max(0, 33 - priority) + (isExteriorType(normalizedType) ? 6 : 0);

  return {
    id: input.id,
    originalUrl: input.originalUrl,
    classification,
    normalizedType,
    classificationConfidence: clamp(confidence, 0, 1),
    classificationSource: input.classification ? "existing" : "fallback",
    position: input.position ?? 0,
    metrics,
    qualityScore,
    selectionScore,
    warnings,
    rejected,
    rejectionReason,
    duplicateOfId: null,
    duplicateDistance: null,
  };
}

function markDuplicates(photos: AnalyzedPhoto[]) {
  const keepers: AnalyzedPhoto[] = [];
  for (const photo of [...photos].sort((a, b) => b.selectionScore - a.selectionScore)) {
    const hash = photo.metrics?.averageHash;
    if (!hash || photo.rejected) {
      keepers.push(photo);
      continue;
    }
    const duplicate = keepers.find((candidate) => {
      if (!candidate.metrics?.averageHash || candidate.rejected) return false;
      if (rolePriority(candidate.normalizedType) !== rolePriority(photo.normalizedType)) return false;
      return hammingDistance(hash, candidate.metrics.averageHash) <= 5;
    });
    if (duplicate) {
      photo.rejected = true;
      photo.rejectionReason = "near_duplicate";
      photo.duplicateOfId = duplicate.id;
      photo.duplicateDistance = hammingDistance(hash, duplicate.metrics!.averageHash);
      photo.warnings.push("near_duplicate");
    } else {
      keepers.push(photo);
    }
  }
}

function selectBalancedPhotos(photos: AnalyzedPhoto[], maxPhotos: number): AnalyzedPhoto[] {
  const candidates = photos
    .filter((photo) => !photo.rejected)
    .sort((a, b) => {
      const roleDelta = rolePriority(a.normalizedType) - rolePriority(b.normalizedType);
      if (roleDelta !== 0) return roleDelta;
      return b.selectionScore - a.selectionScore;
    });

  const selected: AnalyzedPhoto[] = [];
  const takeBest = (predicate: (photo: AnalyzedPhoto) => boolean) => {
    if (selected.length >= maxPhotos) return;
    const next = candidates.find((photo) => predicate(photo) && !selected.some((item) => item.id === photo.id));
    if (next) selected.push(next);
  };

  takeBest((photo) => photo.normalizedType === "Exterior Front" || photo.normalizedType === "Exterior Front 45");
  takeBest((photo) => photo.normalizedType === "Exterior Front 45" && !selected.some((item) => item.id === photo.id));
  takeBest((photo) => photo.normalizedType === "Exterior Side");
  takeBest((photo) => photo.normalizedType === "Exterior Rear" || photo.normalizedType === "Exterior Rear 45");
  takeBest((photo) => isInteriorType(photo.normalizedType));
  takeBest((photo) => photo.normalizedType === "Dashboard");
  takeBest((photo) => photo.normalizedType === "Center Console");
  takeBest((photo) => photo.normalizedType === "Front Seats");
  takeBest((photo) => photo.normalizedType === "Rear Seats" || photo.normalizedType === "Cargo");
  takeBest((photo) => ["Wheel", "Engine", "Detail", "Steering Wheel"].includes(photo.normalizedType));

  for (const photo of candidates.sort((a, b) => b.selectionScore - a.selectionScore)) {
    if (selected.length >= maxPhotos) break;
    if (!selected.some((item) => item.id === photo.id)) selected.push(photo);
  }

  const hero = [...selected]
    .filter((photo) => photo.normalizedType === "Exterior Front" || photo.normalizedType === "Exterior Front 45")
    .sort((a, b) => b.selectionScore - a.selectionScore)[0];
  if (hero) {
    const index = selected.findIndex((photo) => photo.id === hero.id);
    if (index > 0) selected.unshift(...selected.splice(index, 1));
  }

  return selected.slice(0, maxPhotos);
}

function decideBaseTreatment(photo: AnalyzedPhoto): PhotoDirectorTreatment {
  if (photo.rejected) return "REJECT";
  const metrics = photo.metrics;
  if (!metrics) return "LOCAL_ENHANCEMENT";
  const severeBlur = metrics.sharpnessScore < 3.8;
  const severeLight = metrics.exposureScore < 4 || metrics.shadowRatio > 0.42;
  const severeCompression = metrics.compressionRatio < 0.12 || metrics.noiseScore < 4.5;
  const mildIssue = metrics.exposureScore < 7 || metrics.contrastScore < 7 || metrics.sharpnessScore < 6.5 || metrics.noiseScore < 7;
  if (severeBlur || severeLight || severeCompression) return "PAID_AI_RESTORATION";
  if (mildIssue) return "LOCAL_ENHANCEMENT";
  return "PUBLISH_AS_IS";
}

function treatmentLabel(treatment: PhotoDirectorTreatment): string {
  switch (treatment) {
    case "PUBLISH_AS_IS":
      return "Publish As-Is";
    case "LOCAL_ENHANCEMENT":
      return "Local Enhancement";
    case "PAID_AI_RESTORATION":
      return "Paid AI Restoration";
    case "REJECT":
      return "Reject";
  }
}

function toPlanPhoto(
  photo: AnalyzedPhoto,
  order: number | null,
  treatment: PhotoDirectorTreatment,
  estimatedCostUsd: number,
  heroPhotoId: number | null,
  selected: boolean,
): PhotoDirectorPhoto {
  return {
    id: photo.id,
    order,
    position: photo.position,
    photoType: photo.normalizedType,
    originalUrl: photo.originalUrl,
    selected,
    hero: heroPhotoId === photo.id,
    qualityScore: Number(photo.qualityScore.toFixed(2)),
    classificationConfidence: Number(photo.classificationConfidence.toFixed(2)),
    classificationSource: photo.classificationSource,
    selectionReason: selected
      ? `${order! + 1}. ${photo.normalizedType} selected for balanced Marketplace order`
      : photo.rejectionReason ?? "not selected",
    treatment,
    treatmentLabel: treatmentLabel(treatment),
    estimatedCostUsd,
    warnings: photo.rejectionReason ? [...photo.warnings, photo.rejectionReason] : photo.warnings,
    duplicateOfId: photo.duplicateOfId,
    metrics: photo.metrics,
  };
}

export async function buildPhotoDirectorPlan(input: {
  vehicleId: number;
  sourceSetId: number | null;
  images: PhotoDirectorInput[];
  mode: PhotoDirectorMode;
  maxPhotos?: number;
}): Promise<PhotoDirectorPlan> {
  const maxPhotos = Math.max(1, Math.min(10, Math.floor(input.maxPhotos ?? 10)));
  const analyzed = await Promise.all(input.images.map((image) => analyzePhoto(image)));
  markDuplicates(analyzed);

  const selected = selectBalancedPhotos(analyzed, maxPhotos);
  const selectedIds = selected.map((photo) => photo.id);
  const heroPhotoId = selected[0]?.id ?? null;
  const paidLimit = paidRestorationLimitForDirectorMode(input.mode);
  const costCap = PHOTO_DIRECTOR_COST_CAPS_USD[input.mode];
  let paidCount = 0;
  let estimatedCost = 0;

  const treatmentById = new Map<number, { treatment: PhotoDirectorTreatment; estimatedCostUsd: number }>();
  for (const photo of selected) {
    let treatment = decideBaseTreatment(photo);
    let photoCost = 0;
    if (treatment === "PAID_AI_RESTORATION") {
      const canUsePaid =
        paidCount < paidLimit &&
        Number((estimatedCost + ESTIMATED_PROVIDER_RESTORATION_COST_USD).toFixed(3)) <= costCap;
      if (canUsePaid) {
        paidCount++;
        photoCost = ESTIMATED_PROVIDER_RESTORATION_COST_USD;
        estimatedCost = Number((estimatedCost + photoCost).toFixed(3));
      } else {
        treatment = "LOCAL_ENHANCEMENT";
      }
    }
    treatmentById.set(photo.id, { treatment, estimatedCostUsd: photoCost });
  }

  const photos = selected.map((photo, index) => {
    const decision = treatmentById.get(photo.id) ?? { treatment: "PUBLISH_AS_IS" as const, estimatedCostUsd: 0 };
    return toPlanPhoto(photo, index, decision.treatment, decision.estimatedCostUsd, heroPhotoId, true);
  });

  const rejectedPhotos = analyzed
    .filter((photo) => !selectedIds.includes(photo.id))
    .map((photo) => toPlanPhoto(photo, null, "REJECT", 0, heroPhotoId, false));

  const paidAiRestorationPhotoIds = photos
    .filter((photo) => photo.treatment === "PAID_AI_RESTORATION")
    .map((photo) => photo.id);
  const publishAsIsCount = photos.filter((photo) => photo.treatment === "PUBLISH_AS_IS").length;
  const localEnhancementCount = photos.filter((photo) => photo.treatment === "LOCAL_ENHANCEMENT").length;
  const paidAiRestorationCount = paidAiRestorationPhotoIds.length;
  const duplicateRejectedCount = analyzed.filter((photo) => photo.rejectionReason === "near_duplicate").length;
  const potentialAllPaidCost = analyzed.filter((photo) => !photo.rejected && decideBaseTreatment(photo) === "PAID_AI_RESTORATION").length * ESTIMATED_PROVIDER_RESTORATION_COST_USD;
  const estimatedCostAvoidedUsd = Number(Math.max(0, potentialAllPaidCost - estimatedCost).toFixed(3));

  return {
    vehicleId: input.vehicleId,
    mode: input.mode,
    sourceSetId: input.sourceSetId,
    totalPhotosAnalyzed: analyzed.length,
    selectedPhotoIds: selectedIds,
    topSelectedCount: selectedIds.length,
    heroPhotoId,
    duplicateRejectedCount,
    rejectedPhotoCount: rejectedPhotos.length,
    publishAsIsCount,
    localEnhancementCount,
    paidAiRestorationCount,
    paidAiRestorationPhotoIds,
    estimatedCostUsd: Number(estimatedCost.toFixed(3)),
    defaultCostCapUsd: costCap,
    estimatedCostAvoidedUsd,
    localAnalysisCostUsd: 0,
    photos,
    rejectedPhotos,
    finalImageOrder: selectedIds,
    costSummary: {
      totalPhotosReviewed: analyzed.length,
      selectedPhotos: selectedIds.length,
      localAnalysisCostUsd: 0,
      localEnhancements: localEnhancementCount,
      paidAiCalls: paidAiRestorationCount,
      estimatedPaidCostUsd: Number(estimatedCost.toFixed(3)),
      estimatedCostAvoidedUsd,
      unitCostUsd: ESTIMATED_PROVIDER_RESTORATION_COST_USD,
    },
  };
}
