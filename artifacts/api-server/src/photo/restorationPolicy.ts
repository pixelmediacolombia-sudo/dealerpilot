import fs from "fs";
import sharp from "sharp";
import { PHOTO_CLASSIFICATIONS } from "./providers/types";

export type PhotoProcessingMode = "fidelity-first" | "balanced" | "strong-restoration";
export type QualityImprovementClass =
  | "Strong Improvement"
  | "Moderate Improvement"
  | "Too Subtle"
  | "Rejected - Fidelity Risk"
  | "Original Preserved"
  | "Local Enhancement";

export interface RestorationNeedAssessment {
  needsRestoration: boolean;
  reasons: string[];
  score: number;
}

export interface ProviderTrace {
  requested_provider: string | null;
  attempted_provider: string | null;
  returned_provider: string | null;
  selected_final_provider: string;
  provider_result_accepted: boolean;
  rejection_reason: string | null;
  provider_cost: number;
  fallback_used: boolean;
  fallback_reason: string | null;
  fidelity_score: number;
  improvement_score: number;
  quality_gate_result: QualityImprovementClass;
  processing_mode: PhotoProcessingMode;
}

export const ESTIMATED_PROVIDER_RESTORATION_COST_USD = 0.08;

export function normalizePhotoProcessingMode(value: unknown): PhotoProcessingMode {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "strong" || raw === "strong-restoration") return "strong-restoration";
  if (raw === "balanced") return "balanced";
  return "fidelity-first";
}

export function presetVersionForMode(
  mode: PhotoProcessingMode,
  selectedPhotoIds: number[] = [],
  aiRestorationPhotoIds: number[] = selectedPhotoIds,
  localEnhancementPhotoIds: number[] = [],
): string {
  const suffix = selectedPhotoIds.length > 0 ? `:ids=${selectedPhotoIds.join(",")}` : "";
  const aiSuffix = aiRestorationPhotoIds.length > 0 ? `:ai=${aiRestorationPhotoIds.join(",")}` : "";
  const localSuffix = localEnhancementPhotoIds.length > 0 ? `:local=${localEnhancementPhotoIds.join(",")}` : "";
  return `v1:${mode}${suffix}${aiSuffix}${localSuffix}`;
}

export function processingModeFromPresetVersion(value: string | null | undefined): PhotoProcessingMode {
  const [, mode] = String(value ?? "").split(":");
  return normalizePhotoProcessingMode(mode);
}

export function selectedPhotoIdsFromPresetVersion(value: string | null | undefined): number[] {
  return photoIdsFromPresetPart(value, "ids");
}

export function aiRestorationPhotoIdsFromPresetVersion(value: string | null | undefined): number[] {
  return photoIdsFromPresetPart(value, "ai");
}

export function localEnhancementPhotoIdsFromPresetVersion(value: string | null | undefined): number[] {
  return photoIdsFromPresetPart(value, "local");
}

function photoIdsFromPresetPart(value: string | null | undefined, key: string): number[] {
  const parts = String(value ?? "").split(":");
  const idsPart = parts.find((part) => part.startsWith(`${key}=`));
  if (!idsPart) return [];
  return idsPart
    .slice(key.length + 1)
    .split(",")
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function isRestorableClassification(classification: string): boolean {
  const normalized = (PHOTO_CLASSIFICATIONS as readonly string[]).includes(classification)
    ? classification
    : "Miscellaneous";
  if (normalized.startsWith("Dealer")) return false;
  if (normalized === "Technical VIN Sticker" || normalized === "Technical Window Sticker") return false;
  return true;
}

export async function fetchImageBufferForPolicy(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Fetch failed ${urlOrPath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(urlOrPath);
}

export async function assessRestorationNeed(
  imageBuffer: Buffer,
  classification: string,
  mode: PhotoProcessingMode,
): Promise<RestorationNeedAssessment> {
  if (!isRestorableClassification(classification)) {
    return { needsRestoration: false, reasons: ["non_restorable_classification"], score: 0 };
  }

  if (mode === "strong-restoration") {
    return { needsRestoration: true, reasons: ["strong_restoration_requested"], score: 10 };
  }

  const image = sharp(imageBuffer).rotate();
  const [metadata, stats, small] = await Promise.all([
    image.metadata(),
    image.stats(),
    sharp(imageBuffer)
      .rotate()
      .resize({ width: 128, height: 128, fit: "inside", withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer(),
  ]);

  const channels = stats.channels.slice(0, 3);
  const brightness = channels.reduce((sum, ch) => sum + ch.mean, 0) / Math.max(1, channels.length);
  const contrast = channels.reduce((sum, ch) => sum + ch.stdev, 0) / Math.max(1, channels.length);
  const width = metadata.width ?? 0;
  const bytesPerPixel = imageBuffer.length / Math.max(1, width * (metadata.height ?? 1));
  let adjacentDiff = 0;
  for (let i = 1; i < small.length; i++) adjacentDiff += Math.abs((small[i] ?? 0) - (small[i - 1] ?? 0));
  adjacentDiff /= Math.max(1, small.length - 1);

  const reasons: string[] = [];
  let score = 0;

  if (width > 0 && width < 1200) {
    reasons.push("low_resolution");
    score += 2;
  }
  if (brightness > 0 && brightness < 82) {
    reasons.push("low_light");
    score += 2;
  }
  if (contrast > 0 && contrast < 42) {
    reasons.push("poor_local_contrast");
    score += 2;
  }
  if (adjacentDiff < 4.8) {
    reasons.push("blur_or_low_micro_detail");
    score += 2;
  }
  if (bytesPerPixel < 0.14) {
    reasons.push("compression_damage");
    score += 1;
  }

  const threshold = mode === "balanced" ? 2 : 3;
  return { needsRestoration: score >= threshold, reasons, score };
}
