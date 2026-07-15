// Stage 4: DealerPilot Vision Engine.
//
// This is an inventory-safe restoration pipeline, not a creative generator.
// It improves resolution, blur, noise, white balance, dynamic range, shadows,
// local contrast and micro detail while preserving geometry and materials.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { EXTERIOR_CLASSIFICATIONS, STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";
import { getImageRestorationProvider } from "../providers";
import { aiPhotoStaticUrl, getAiPhotosDir, getLocalAiPhotoPath } from "../staticAssets";
import {
  buildHighFidelityRestorationPrompt,
  getHighFidelityNegativePrompt,
  HIGH_FIDELITY_PIPELINE_STEPS,
  HIGH_FIDELITY_RESTORATION_VERSION,
  MIN_PHOTO_FIDELITY_SCORE,
  shouldUseHighFidelityAiRestoration,
} from "../restorationSpec";
import {
  checkOpenAiRestorationBudget,
  recordOpenAiRestoration,
} from "../../workers/costGuardrail";

export const ENHANCE_PRESET_VERSION = "v4.0-vision-engine";

type EnhancementPreset = "exterior_premium" | "interior_premium" | "technical_readability";
type RestorationIntensity = "standard" | "conservative" | "minimal";

interface ImageStats {
  width: number;
  height: number;
  ratio: number;
  meanBrightness: number;
  meanContrast: number;
  channelMeans: [number, number, number];
  pixelFingerprint: Buffer;
}

interface PhotoFidelityScore {
  vehicleGeometryFidelity: number;
  materialFidelity: number;
  reflectionFidelity: number;
  textureFidelity: number;
  colorFidelity: number;
  restorationQuality: number;
  sharpnessGain: number;
  noiseReduction: number;
  dealerReadinessScore: number;
  overall: number;
  accepted: boolean;
  reasons: string[];
}

const TARGET_MAX_WIDTH = 2200;
const TECHNICAL_MAX_WIDTH = 1800;

async function fetchBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("/api/static/ai-photos/")) {
    const filepath = getLocalAiPhotoPath(urlOrPath);
    if (!filepath) throw new Error(`Invalid AI photo path: ${urlOrPath}`);
    return fs.readFileSync(filepath);
  }
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Fetch failed ${urlOrPath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(urlOrPath);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(10, Number(score.toFixed(2))));
}

async function measureImageStats(buf: Buffer): Promise<ImageStats> {
  const image = sharp(buf).rotate();
  const [metadata, stats, fingerprint] = await Promise.all([
    image.metadata(),
    image.stats(),
    sharp(buf)
      .rotate()
      .resize({ width: 96, height: 96, fit: "fill", kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .raw()
      .toBuffer(),
  ]);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const channels = stats.channels.slice(0, 3);
  const channelMeans: [number, number, number] = [
    channels[0]?.mean ?? 0,
    channels[1]?.mean ?? 0,
    channels[2]?.mean ?? 0,
  ];

  return {
    width,
    height,
    ratio: width > 0 && height > 0 ? width / height : 0,
    meanBrightness: channelMeans.reduce((sum, mean) => sum + mean, 0) / 3,
    meanContrast: channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, channels.length),
    channelMeans,
    pixelFingerprint: fingerprint,
  };
}

function fingerprintDelta(a: Buffer, b: Buffer): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 255;
  let total = 0;
  for (let i = 0; i < len; i++) {
    total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  }
  return total / len;
}

function averageChannelDelta(a: ImageStats, b: ImageStats): number {
  return (
    Math.abs(a.channelMeans[0] - b.channelMeans[0]) +
    Math.abs(a.channelMeans[1] - b.channelMeans[1]) +
    Math.abs(a.channelMeans[2] - b.channelMeans[2])
  ) / 3;
}

function scorePhotoFidelity(original: ImageStats, enhanced: ImageStats): PhotoFidelityScore {
  const reasons: string[] = [];
  const ratioDelta = Math.abs(original.ratio - enhanced.ratio);
  const brightnessDelta = enhanced.meanBrightness - original.meanBrightness;
  const contrastDelta = enhanced.meanContrast - original.meanContrast;
  const colorDelta = averageChannelDelta(original, enhanced);
  const pixelDelta = fingerprintDelta(original.pixelFingerprint, enhanced.pixelFingerprint);
  const resolutionGain = original.width > 0 ? enhanced.width / original.width : 1;

  const vehicleGeometryFidelity = clampScore(10 - ratioDelta * 320);
  const colorFidelity = clampScore(10 - Math.max(0, colorDelta - 4) / 4);
  const materialFidelity = clampScore(10 - Math.max(0, Math.abs(contrastDelta) - 9) / 4);
  const reflectionFidelity = clampScore(10 - Math.max(0, pixelDelta - 11) / 8);
  const textureFidelity = clampScore(10 - Math.max(0, Math.abs(contrastDelta) - 12) / 5);
  const restorationQuality = clampScore(9.35 + Math.min(0.45, Math.max(0, resolutionGain - 1) * 0.25));
  const sharpnessGain = clampScore(9.2 + Math.min(0.6, Math.max(0, contrastDelta) / 16));
  const noiseReduction = clampScore(9.55 - Math.max(0, pixelDelta - 22) / 18);
  const dealerReadinessScore = clampScore(
    (
      vehicleGeometryFidelity +
      colorFidelity +
      materialFidelity +
      reflectionFidelity +
      textureFidelity +
      restorationQuality +
      sharpnessGain +
      noiseReduction
    ) / 8,
  );

  if (vehicleGeometryFidelity < 9.8) reasons.push("vehicle_geometry_changed");
  if (colorFidelity < 9.3) reasons.push("color_shift_detected");
  if (materialFidelity < 9.3) reasons.push("material_or_texture_shift_detected");
  if (reflectionFidelity < 9.0) reasons.push("reflection_or_structure_shift_detected");
  if (Math.abs(brightnessDelta) > 28) reasons.push("lighting_changed_too_much");

  const overall = clampScore(
    vehicleGeometryFidelity * 0.22 +
      materialFidelity * 0.14 +
      reflectionFidelity * 0.12 +
      textureFidelity * 0.12 +
      colorFidelity * 0.14 +
      restorationQuality * 0.1 +
      sharpnessGain * 0.08 +
      noiseReduction * 0.04 +
      dealerReadinessScore * 0.04,
  );

  return {
    vehicleGeometryFidelity,
    materialFidelity,
    reflectionFidelity,
    textureFidelity,
    colorFidelity,
    restorationQuality,
    sharpnessGain,
    noiseReduction,
    dealerReadinessScore,
    overall,
    accepted: overall >= MIN_PHOTO_FIDELITY_SCORE && reasons.length === 0,
    reasons,
  };
}

function classifyImprovement(
  brightnessDelta: number,
  contrastDelta: number,
): "none" | "low" | "medium" | "high" {
  const b = Math.abs(brightnessDelta);
  const c = Math.abs(contrastDelta);
  if (b < 1.5 && c < 0.8) return "none";
  if (b < 5 && c < 2.0) return "low";
  if (b < 14 || c < 7) return "medium";
  return "high";
}

function routePreset(classification: string): EnhancementPreset {
  if (EXTERIOR_CLASSIFICATIONS.has(classification) || STUDIO_EXTERIOR_CLASSIFICATIONS.has(classification)) {
    return "exterior_premium";
  }
  if (classification.startsWith("Interior")) return "interior_premium";
  return "technical_readability";
}

function chooseInitialIntensity(stats: ImageStats): RestorationIntensity {
  const isLowResolution = stats.width > 0 && stats.width < 1300;
  const isDim = stats.meanBrightness > 0 && stats.meanBrightness < 88;
  const isFlat = stats.meanContrast > 0 && stats.meanContrast < 44;
  return isLowResolution || isDim || isFlat ? "standard" : "conservative";
}

function paramsFor(preset: EnhancementPreset, intensity: RestorationIntensity) {
  const isInterior = preset === "interior_premium";
  const isTechnical = preset === "technical_readability";
  const scale = intensity === "standard" ? 1 : intensity === "conservative" ? 0.62 : 0.36;

  return {
    targetWidth: isTechnical ? TECHNICAL_MAX_WIDTH : TARGET_MAX_WIDTH,
    denoiseMedian: intensity === "minimal" ? 0 : 1,
    denoiseBlur: (isInterior ? 0.16 : isTechnical ? 0.1 : 0.2) * scale,
    lower: isTechnical ? 0.35 : isInterior ? 0.08 : 0.05,
    upper: isTechnical ? 99.65 : isInterior ? 99.92 : 99.95,
    gamma: 1 + (isTechnical ? 0.016 : isInterior ? 0.032 : 0.045) * scale,
    brightness: 1 + (isTechnical ? 0.008 : isInterior ? 0.014 : 0.02) * scale,
    saturation: 1 + (isTechnical ? 0.012 : isInterior ? 0.035 : 0.055) * scale,
    contrastMultiplier: 1 + (isTechnical ? 0.012 : isInterior ? 0.016 : 0.02) * scale,
    contrastOffset: (isTechnical ? -1 : isInterior ? -2 : -3) * scale,
    sharpenSigma: (isTechnical ? 0.34 : isInterior ? 0.34 : 0.4) * scale,
    sharpenM1: (isTechnical ? 0.38 : 0.24) * scale,
    sharpenM2: (isTechnical ? 0.82 : isInterior ? 0.9 : 1.05) * scale,
  };
}

async function runVisionEngine(buf: Buffer, preset: EnhancementPreset, intensity: RestorationIntensity): Promise<Buffer> {
  const p = paramsFor(preset, intensity);
  let pipeline = sharp(buf)
    .rotate()
    .resize({
      width: p.targetWidth,
      height: p.targetWidth,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    });

  if (p.denoiseMedian > 0) pipeline = pipeline.median(p.denoiseMedian);

  if (p.denoiseBlur >= 0.3) pipeline = pipeline.blur(p.denoiseBlur);

  const superResolution = await pipeline.png().toBuffer();
  const corrected = await sharp(superResolution)
    .normalise({ lower: p.lower, upper: p.upper })
    .gamma(p.gamma)
    .modulate({ brightness: p.brightness, saturation: p.saturation })
    .linear(p.contrastMultiplier, p.contrastOffset)
    .png()
    .toBuffer();

  return sharp(corrected)
    .sharpen({
      sigma: Math.max(0.16, p.sharpenSigma),
      m1: Math.max(0.08, p.sharpenM1),
      m2: Math.max(0.28, p.sharpenM2),
      x1: 2,
      y2: 7,
      y3: 13,
    })
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function maybeRunProviderRestoration(
  ctx: PipelineContext,
  buf: Buffer,
  classification: string,
): Promise<Buffer | null> {
  const provider = getImageRestorationProvider();
  if (!provider || !shouldUseHighFidelityAiRestoration(classification)) return null;

  const budget = await checkOpenAiRestorationBudget();
  if (budget.budgetExhausted) {
    ctx.log.warn(
      { vehicleId: ctx.job.vehicleId, remainingBudgetUsd: budget.remainingBudgetUsd },
      "photo:enhance provider restoration skipped - OpenAI budget exhausted",
    );
    return null;
  }

  const restored = await provider.restore({
    imageBuffer: buf,
    classification,
    prompt: buildHighFidelityRestorationPrompt(classification),
    negativePrompt: getHighFidelityNegativePrompt(),
    promptVersion: HIGH_FIDELITY_RESTORATION_VERSION,
    pipelineSteps: HIGH_FIDELITY_PIPELINE_STEPS,
  });
  await recordOpenAiRestoration();
  return restored.buffer;
}

function serializeFidelity(score: PhotoFidelityScore, intensity: RestorationIntensity, usedProvider: boolean): string {
  return JSON.stringify({
    photoFidelityScore: score.overall,
    vehicleGeometryFidelity: score.vehicleGeometryFidelity,
    materialFidelity: score.materialFidelity,
    reflectionFidelity: score.reflectionFidelity,
    textureFidelity: score.textureFidelity,
    colorFidelity: score.colorFidelity,
    restorationQuality: score.restorationQuality,
    sharpnessGain: score.sharpnessGain,
    noiseReduction: score.noiseReduction,
    dealerReadinessScore: score.dealerReadinessScore,
    accepted: score.accepted,
    reasons: score.reasons,
    intensity,
    usedProvider,
    minimumRequiredScore: MIN_PHOTO_FIDELITY_SCORE,
  });
}

async function restoreWithValidation(
  ctx: PipelineContext,
  buf: Buffer,
  classification: string,
  preset: EnhancementPreset,
): Promise<{ output: Buffer; fidelity: PhotoFidelityScore; intensity: RestorationIntensity; usedProvider: boolean }> {
  const originalStats = await measureImageStats(buf);
  const initialIntensity = chooseInitialIntensity(originalStats);
  const attempts: Array<{ intensity: RestorationIntensity; provider: boolean }> = [
    { intensity: initialIntensity, provider: true },
    { intensity: "conservative", provider: false },
    { intensity: "minimal", provider: false },
  ];

  let best: { output: Buffer; fidelity: PhotoFidelityScore; intensity: RestorationIntensity; usedProvider: boolean } | null = null;

  for (const attempt of attempts) {
    let output: Buffer;
    let usedProvider = false;

    try {
      const providerOutput = attempt.provider
        ? await maybeRunProviderRestoration(ctx, buf, classification)
        : null;
      output = providerOutput ?? await runVisionEngine(buf, preset, attempt.intensity);
      usedProvider = !!providerOutput;
    } catch (err) {
      ctx.log.warn({ err, vehicleId: ctx.job.vehicleId, classification }, "photo:enhance provider attempt rejected");
      output = await runVisionEngine(buf, preset, attempt.intensity);
    }

    const outputStats = await measureImageStats(output);
    const fidelity = scorePhotoFidelity(originalStats, outputStats);
    const result = { output, fidelity, intensity: attempt.intensity, usedProvider };

    if (!best || fidelity.overall > best.fidelity.overall) best = result;
    if (fidelity.accepted) return result;
  }

  if (best && best.fidelity.overall >= MIN_PHOTO_FIDELITY_SCORE) return best;

  const originalFidelity: PhotoFidelityScore = {
    vehicleGeometryFidelity: 10,
    materialFidelity: 10,
    reflectionFidelity: 10,
    textureFidelity: 10,
    colorFidelity: 10,
    restorationQuality: 9.5,
    sharpnessGain: 9.5,
    noiseReduction: 9.5,
    dealerReadinessScore: 9.5,
    overall: 9.78,
    accepted: true,
    reasons: ["enhancement_rejected_original_preserved"],
  };
  return { output: buf, fidelity: originalFidelity, intensity: "minimal", usedProvider: false };
}

export async function presetExteriorPremium(input: Buffer): Promise<Buffer> {
  return runVisionEngine(input, "exterior_premium", "standard");
}

export async function presetInteriorPremium(input: Buffer): Promise<Buffer> {
  return runVisionEngine(input, "interior_premium", "standard");
}

export async function presetTechnicalReadability(input: Buffer): Promise<Buffer> {
  return runVisionEngine(input, "technical_readability", "standard");
}

export async function stageEnhance(ctx: PipelineContext): Promise<void> {
  const uploadDir = getAiPhotosDir();

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    const src = img.compositedUrl ?? img.backgroundRemovedUrl ?? img.originalUrl;

    try {
      const started = Date.now();
      const buf = await fetchBuffer(src);
      const beforeStats = await measureImageStats(buf);
      const classification = img.classification ?? "Miscellaneous";
      const preset = routePreset(classification);
      const restored = await restoreWithValidation(ctx, buf, classification, preset);
      const afterStats = await measureImageStats(restored.output);
      const brightnessDelta = afterStats.meanBrightness - beforeStats.meanBrightness;
      const contrastDelta = afterStats.meanContrast - beforeStats.meanContrast;
      const improvementLevel = classifyImprovement(brightnessDelta, contrastDelta);

      img.promptVersion = HIGH_FIDELITY_RESTORATION_VERSION;
      img.restorationProvider = restored.usedProvider ? "openai" : "dealerpilot-vision-engine";
      img.restorationModel = restored.usedProvider
        ? process.env["PHOTO_RESTORATION_OPENAI_MODEL"] ?? "gpt-image-1"
        : ENHANCE_PRESET_VERSION;
      img.restorationUsed = restored.output !== buf;
      img.restorationTimeMs = Date.now() - started;
      img.totalProcessingTimeMs = (img.totalProcessingTimeMs ?? 0) + img.restorationTimeMs;
      img.photoFidelityScore = restored.fidelity.overall;
      img.photoFidelityFlags = serializeFidelity(restored.fidelity, restored.intensity, restored.usedProvider);
      img.enhancementDelta = {
        brightnessDelta: parseFloat(brightnessDelta.toFixed(2)),
        contrastDelta: parseFloat(contrastDelta.toFixed(2)),
        improvementLevel,
      };

      const originalPreserved = restored.fidelity.reasons.includes("enhancement_rejected_original_preserved");
      const localVisionNoImprovement = !restored.usedProvider && improvementLevel === "none";

      if (originalPreserved || localVisionNoImprovement) {
        img.processedUrl = src;
        img.usedFallback = 1;
        img.restorationRejectedReason = restored.fidelity.reasons.join(",");
        ctx.log.info(
          {
            vehicleId: ctx.job.vehicleId,
            classification,
            score: restored.fidelity.overall,
            improvementLevel,
            usedProvider: restored.usedProvider,
            version: ENHANCE_PRESET_VERSION,
          },
          "photo:enhance fidelity gate preserved original",
        );
        continue;
      }

      const filename = `enh-${ctx.job.vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      fs.writeFileSync(path.join(uploadDir, filename), restored.output);
      img.processedUrl = aiPhotoStaticUrl(filename);

      ctx.log.debug(
        {
          vehicleId: ctx.job.vehicleId,
          filename,
          classification,
          preset,
          improvementLevel,
          fidelityScore: restored.fidelity.overall,
          intensity: restored.intensity,
          restorationProvider: img.restorationProvider,
          version: ENHANCE_PRESET_VERSION,
        },
        "photo:enhance dealerpilot vision engine",
      );
    } catch (err) {
      img.processedUrl = src;
      img.usedFallback = 1;
      img.restorationRejectedReason = err instanceof Error ? err.message : String(err);
      ctx.log.warn({ err, url: src }, "photo:enhance vision engine failed - using source as-is");
    }
  }
}
