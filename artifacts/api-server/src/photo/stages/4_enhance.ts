// Stage 4: DealerPilot Vision Engine.
//
// This is an inventory-safe restoration pipeline, not a creative generator.
// It improves resolution, blur, noise, white balance, dynamic range, shadows,
// local contrast and micro detail while preserving geometry and materials.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { aiPhotoJobsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
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
} from "../restorationSpec";
import {
  checkOpenAiRestorationBudget,
  recordOpenAiRestoration,
} from "../../workers/costGuardrail";
import {
  assessRestorationNeed,
  aiRestorationPhotoIdsFromPresetVersion,
  ESTIMATED_PROVIDER_RESTORATION_COST_USD,
  isRestorableClassification,
  localEnhancementPhotoIdsFromPresetVersion,
  processingModeFromPresetVersion,
  type PhotoProcessingMode,
  type ProviderTrace,
  type QualityImprovementClass,
  type RestorationNeedAssessment,
} from "../restorationPolicy";

export const ENHANCE_PRESET_VERSION = "v4.0-vision-engine";

type EnhancementPreset = "exterior_premium" | "interior_premium" | "technical_readability";
type RestorationIntensity = "standard" | "conservative" | "minimal";
type LocalEnhancementStrategy = "current_economy" | "front_pipeline_b";

interface ImageStats {
  width: number;
  height: number;
  ratio: number;
  meanBrightness: number;
  meanContrast: number;
  channelMeans: [number, number, number];
  pixelFingerprint: Buffer;
  sharpnessProxy: number;
  shadowDetail: number;
  noiseEstimate: number;
  localContrast: number;
  paintClarity: number;
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

function localEnhancementStrategyFor(classification: string): LocalEnhancementStrategy {
  return classification === "Exterior Front" || classification === "Exterior Front 45"
    ? "front_pipeline_b"
    : "current_economy";
}

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
  const pixels = [...fingerprint];
  const mean = pixels.reduce((sum, pixel) => sum + pixel, 0) / Math.max(1, pixels.length);
  const variance = pixels.reduce((sum, pixel) => sum + Math.pow(pixel - mean, 2), 0) / Math.max(1, pixels.length);
  let adjacentDiff = 0;
  for (let i = 1; i < pixels.length; i++) adjacentDiff += Math.abs((pixels[i] ?? 0) - (pixels[i - 1] ?? 0));
  adjacentDiff /= Math.max(1, pixels.length - 1);
  const shadowPixels = pixels.filter((pixel) => pixel < 92);
  const shadowDetail = shadowPixels.length > 0
    ? shadowPixels.reduce((sum, pixel) => sum + pixel, 0) / shadowPixels.length
    : mean;

  return {
    width,
    height,
    ratio: width > 0 && height > 0 ? width / height : 0,
    meanBrightness: channelMeans.reduce((sum, mean) => sum + mean, 0) / 3,
    meanContrast: channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, channels.length),
    channelMeans,
    pixelFingerprint: fingerprint,
    sharpnessProxy: adjacentDiff,
    shadowDetail,
    noiseEstimate: Math.sqrt(variance) - adjacentDiff * 0.38,
    localContrast: channels.reduce((sum, channel) => sum + channel.stdev, 0) / Math.max(1, channels.length),
    paintClarity: adjacentDiff * 0.58 + Math.sqrt(variance) * 0.42,
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

function buildQualityGate(
  original: ImageStats,
  enhanced: ImageStats,
  fidelity: PhotoFidelityScore,
): { result: QualityImprovementClass; score: number; passedMetrics: string[]; failedMetrics: string[] } {
  const checks = [
    {
      name: "sharpness",
      passed: enhanced.sharpnessProxy >= original.sharpnessProxy * 1.015,
    },
    {
      name: "shadow_detail",
      passed: enhanced.shadowDetail >= original.shadowDetail + 1.2,
    },
    {
      name: "noise_reduction",
      passed: enhanced.noiseEstimate <= original.noiseEstimate * 0.96,
    },
    {
      name: "local_contrast",
      passed: enhanced.localContrast >= original.localContrast + 1.2,
    },
    {
      name: "paint_clarity",
      passed: enhanced.paintClarity >= original.paintClarity * 1.018,
    },
  ];
  const passedMetrics = checks.filter((check) => check.passed).map((check) => check.name);
  const failedMetrics = checks.filter((check) => !check.passed).map((check) => check.name);
  const score = clampScore(passedMetrics.length * 2);

  if (!fidelity.accepted) return { result: "Rejected - Fidelity Risk", score, passedMetrics, failedMetrics };
  if (passedMetrics.length >= 4) return { result: "Strong Improvement", score, passedMetrics, failedMetrics };
  if (passedMetrics.length >= 2) return { result: "Moderate Improvement", score, passedMetrics, failedMetrics };
  return { result: "Too Subtle", score, passedMetrics, failedMetrics };
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

async function runVisionEngine(
  buf: Buffer,
  preset: EnhancementPreset,
  intensity: RestorationIntensity,
  strategy: LocalEnhancementStrategy = "current_economy",
): Promise<Buffer> {
  if (strategy === "front_pipeline_b") {
    const metadata = await sharp(buf).rotate().metadata();
    const sourceWidth = metadata.width ?? 800;
    const targetWidth = Math.min(TARGET_MAX_WIDTH, Math.max(sourceWidth, Math.round(sourceWidth * 2)));
    return sharp(buf)
      .rotate()
      .normalise({ lower: 0.12, upper: 99.82 })
      .gamma(1.025)
      .modulate({ brightness: 1.006, saturation: 1.022 })
      .linear(1.042, -4.5)
      .resize({
        width: targetWidth,
        fit: "inside",
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .sharpen({
        sigma: 0.38,
        m1: 0.32,
        m2: 1.18,
        x1: 2,
        y2: 7,
        y3: 13,
      })
      .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
      .toBuffer();
  }

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

interface ProviderAttempt {
  requestedProvider: string | null;
  attemptedProvider: string | null;
  returnedProvider: string | null;
  model: string | null;
  output: Buffer | null;
  costUsd: number;
  rejectedReason: string | null;
}

async function maybeRunProviderRestoration(
  ctx: PipelineContext,
  buf: Buffer,
  classification: string,
  needAssessment: RestorationNeedAssessment,
): Promise<ProviderAttempt> {
  const provider = getImageRestorationProvider();
  const requestedProvider = provider && isRestorableClassification(classification) ? provider.name : null;
  if (!provider || !isRestorableClassification(classification)) {
    return {
      requestedProvider,
      attemptedProvider: null,
      returnedProvider: null,
      model: null,
      output: null,
      costUsd: 0,
      rejectedReason: "provider_not_configured_or_classification_not_restorable",
    };
  }
  if (!needAssessment.needsRestoration) {
    return {
      requestedProvider,
      attemptedProvider: null,
      returnedProvider: null,
      model: provider.model,
      output: null,
      costUsd: 0,
      rejectedReason: `restoration_not_needed:${needAssessment.reasons.join(",") || "clean_photo"}`,
    };
  }

  const budget = await checkOpenAiRestorationBudget();
  if (budget.budgetExhausted) {
    ctx.log.warn(
      { vehicleId: ctx.job.vehicleId, remainingBudgetUsd: budget.remainingBudgetUsd },
      "photo:enhance provider restoration skipped - OpenAI budget exhausted",
    );
    return {
      requestedProvider,
      attemptedProvider: null,
      returnedProvider: null,
      model: provider.model,
      output: null,
      costUsd: 0,
      rejectedReason: "openai_budget_exhausted",
    };
  }

  try {
    const restored = await provider.restore({
      imageBuffer: buf,
      classification,
      prompt: buildHighFidelityRestorationPrompt(classification),
      negativePrompt: getHighFidelityNegativePrompt(),
      promptVersion: HIGH_FIDELITY_RESTORATION_VERSION,
      pipelineSteps: HIGH_FIDELITY_PIPELINE_STEPS,
    });
    await recordOpenAiRestoration();
    return {
      requestedProvider,
      attemptedProvider: provider.name,
      returnedProvider: restored.provider,
      model: restored.model,
      output: restored.buffer,
      costUsd: ESTIMATED_PROVIDER_RESTORATION_COST_USD,
      rejectedReason: null,
    };
  } catch (err) {
    return {
      requestedProvider,
      attemptedProvider: provider.name,
      returnedProvider: null,
      model: provider.model,
      output: null,
      costUsd: 0,
      rejectedReason: err instanceof Error ? err.message : String(err),
    };
  }
}

function serializeFidelity(
  score: PhotoFidelityScore,
  intensity: RestorationIntensity,
  usedProvider: boolean,
  qualityGate: ReturnType<typeof buildQualityGate> | null,
): string {
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
    qualityGateResult: qualityGate?.result,
    improvementScore: qualityGate?.score,
    passedImprovementMetrics: qualityGate?.passedMetrics,
    failedImprovementMetrics: qualityGate?.failedMetrics,
    minimumRequiredScore: MIN_PHOTO_FIDELITY_SCORE,
  });
}

interface RestorationDecision {
  output: Buffer;
  fidelity: PhotoFidelityScore;
  intensity: RestorationIntensity;
  usedProvider: boolean;
  finalProvider: string;
  finalModel: string;
  providerTrace: ProviderTrace;
  qualityGate: ReturnType<typeof buildQualityGate> | null;
  needAssessment: RestorationNeedAssessment;
}

async function restoreWithValidation(
  ctx: PipelineContext,
  buf: Buffer,
  classification: string,
  preset: EnhancementPreset,
  sourcePhotoId?: number,
): Promise<RestorationDecision> {
  const originalStats = await measureImageStats(buf);
  const initialIntensity = chooseInitialIntensity(originalStats);
  const processingMode = processingModeFromPresetVersion(ctx.job.presetVersion);
  const needAssessment = await assessRestorationNeed(buf, classification, processingMode);
  const authorizedPhotoIds = aiRestorationPhotoIdsFromPresetVersion(ctx.job.presetVersion);
  const localEnhancementPhotoIds = localEnhancementPhotoIdsFromPresetVersion(ctx.job.presetVersion);
  const providerAllowed =
    authorizedPhotoIds.length > 0 &&
    sourcePhotoId !== undefined &&
    authorizedPhotoIds.includes(sourcePhotoId);
  const localAllowed =
    localEnhancementPhotoIds.length > 0 &&
    sourcePhotoId !== undefined &&
    localEnhancementPhotoIds.includes(sourcePhotoId);
  const providerAttempt = providerAllowed
    ? await maybeRunProviderRestoration(ctx, buf, classification, needAssessment)
    : {
        requestedProvider: getImageRestorationProvider()?.name ?? null,
        attemptedProvider: null,
        returnedProvider: null,
        model: getImageRestorationProvider()?.model ?? null,
        output: null,
        costUsd: 0,
        rejectedReason: "paid_restoration_not_selected_for_this_photo",
      };
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
    reasons: ["original_preserved"],
  };

  if (providerAttempt.output) {
    const providerStats = await measureImageStats(providerAttempt.output);
    const providerFidelity = scorePhotoFidelity(originalStats, providerStats);
    const providerGate = buildQualityGate(originalStats, providerStats, providerFidelity);
    const providerAccepted =
      providerFidelity.accepted &&
      (providerGate.result === "Strong Improvement" || providerGate.result === "Moderate Improvement");

    if (providerAccepted) {
      return {
        output: providerAttempt.output,
        fidelity: providerFidelity,
        intensity: initialIntensity,
        usedProvider: true,
        finalProvider: providerAttempt.returnedProvider ?? "openai",
        finalModel: providerAttempt.model ?? process.env["PHOTO_RESTORATION_OPENAI_MODEL"] ?? "gpt-image-1",
        providerTrace: {
          requested_provider: providerAttempt.requestedProvider,
          attempted_provider: providerAttempt.attemptedProvider,
          returned_provider: providerAttempt.returnedProvider,
          selected_final_provider: providerAttempt.returnedProvider ?? "openai",
          provider_result_accepted: true,
          rejection_reason: null,
          provider_cost: providerAttempt.costUsd,
          fallback_used: false,
          fallback_reason: null,
          fidelity_score: providerFidelity.overall,
          improvement_score: providerGate.score,
          quality_gate_result: providerGate.result,
          processing_mode: processingMode,
        },
        qualityGate: providerGate,
        needAssessment,
      };
    }

    const rejectionReason = providerFidelity.reasons.length > 0
      ? providerFidelity.reasons.join(",")
      : providerGate.result;
    const allowLocalFallback = process.env["PHOTO_RESTORATION_ALLOW_LOCAL_FALLBACK_AFTER_PROVIDER"] === "true";
    if (allowLocalFallback) {
      const localStrategy = localEnhancementStrategyFor(classification);
      const localOutput = await runVisionEngine(
        buf,
        preset,
        processingMode === "strong-restoration" ? "standard" : "conservative",
        localStrategy,
      );
      const localStats = await measureImageStats(localOutput);
      const localFidelity = scorePhotoFidelity(originalStats, localStats);
      const localGate = buildQualityGate(originalStats, localStats, localFidelity);
      const localAccepted =
        localFidelity.accepted &&
        (localGate.result === "Strong Improvement" || localGate.result === "Moderate Improvement");
      if (localAccepted) {
        return {
          output: localOutput,
          fidelity: localFidelity,
          intensity: "conservative",
          usedProvider: false,
          finalProvider: "dealerpilot-vision-engine",
          finalModel: ENHANCE_PRESET_VERSION,
          providerTrace: {
            requested_provider: providerAttempt.requestedProvider,
            attempted_provider: providerAttempt.attemptedProvider,
            returned_provider: providerAttempt.returnedProvider,
            selected_final_provider: "dealerpilot-vision-engine",
            provider_result_accepted: false,
            rejection_reason: rejectionReason,
            provider_cost: providerAttempt.costUsd,
            fallback_used: true,
            fallback_reason: "explicit_local_fallback_after_provider_rejection",
            fidelity_score: localFidelity.overall,
            improvement_score: localGate.score,
            quality_gate_result: "Local Enhancement",
            processing_mode: processingMode,
          },
          qualityGate: localGate,
          needAssessment,
        };
      }
    }

    return {
      output: buf,
      fidelity: { ...originalFidelity, reasons: [`provider_rejected:${rejectionReason}`] },
      intensity: "minimal",
      usedProvider: false,
      finalProvider: "original",
      finalModel: "original-preserved",
      providerTrace: {
        requested_provider: providerAttempt.requestedProvider,
        attempted_provider: providerAttempt.attemptedProvider,
        returned_provider: providerAttempt.returnedProvider,
        selected_final_provider: "original",
        provider_result_accepted: false,
        rejection_reason: rejectionReason,
        provider_cost: providerAttempt.costUsd,
        fallback_used: true,
        fallback_reason: "provider_rejected_original_preserved",
        fidelity_score: originalFidelity.overall,
        improvement_score: 0,
        quality_gate_result: providerGate.result === "Rejected - Fidelity Risk"
          ? "Rejected - Fidelity Risk"
          : "Original Preserved",
        processing_mode: processingMode,
      },
      qualityGate: null,
      needAssessment,
    };
  }

  if (localAllowed) {
    const localStrategy = localEnhancementStrategyFor(classification);
    const localOutput = await runVisionEngine(
      buf,
      preset,
      processingMode === "strong-restoration" ? "standard" : "conservative",
      localStrategy,
    );
    const localStats = await measureImageStats(localOutput);
    const localFidelity = scorePhotoFidelity(originalStats, localStats);
    const localGate = buildQualityGate(originalStats, localStats, localFidelity);
    const localAccepted =
      localFidelity.accepted &&
      (localGate.result === "Strong Improvement" || localGate.result === "Moderate Improvement");

    if (localAccepted) {
      return {
        output: localOutput,
        fidelity: localFidelity,
        intensity: processingMode === "strong-restoration" ? "standard" : "conservative",
        usedProvider: false,
        finalProvider: "dealerpilot-vision-engine",
        finalModel: ENHANCE_PRESET_VERSION,
        providerTrace: {
          requested_provider: providerAttempt.requestedProvider,
          attempted_provider: providerAttempt.attemptedProvider,
          returned_provider: providerAttempt.returnedProvider,
          selected_final_provider: "dealerpilot-vision-engine",
          provider_result_accepted: false,
          rejection_reason: null,
          provider_cost: 0,
          fallback_used: false,
          fallback_reason: null,
          fidelity_score: localFidelity.overall,
          improvement_score: localGate.score,
          quality_gate_result: localGate.result,
          processing_mode: processingMode,
        },
        qualityGate: localGate,
        needAssessment,
      };
    }

    return {
      output: buf,
      fidelity: { ...originalFidelity, reasons: [`local_enhancement_rejected:${localGate.result}`] },
      intensity: "minimal",
      usedProvider: false,
      finalProvider: "original",
      finalModel: "original-preserved",
      providerTrace: {
        requested_provider: providerAttempt.requestedProvider,
        attempted_provider: providerAttempt.attemptedProvider,
        returned_provider: providerAttempt.returnedProvider,
        selected_final_provider: "original",
        provider_result_accepted: false,
        rejection_reason: localFidelity.reasons.length > 0 ? localFidelity.reasons.join(",") : localGate.result,
        provider_cost: 0,
        fallback_used: true,
        fallback_reason: "local_enhancement_too_subtle_original_preserved",
        fidelity_score: originalFidelity.overall,
        improvement_score: localGate.score,
        quality_gate_result: localGate.result === "Rejected - Fidelity Risk" ? "Rejected - Fidelity Risk" : "Too Subtle",
        processing_mode: processingMode,
      },
      qualityGate: localGate,
      needAssessment,
    };
  }

  const skippedReason = providerAttempt.rejectedReason ?? "restoration_not_needed";
  // Backward-compatible audit marker: enhancement_rejected_original_preserved.
  return {
    output: buf,
    fidelity: { ...originalFidelity, reasons: [skippedReason] },
    intensity: "minimal",
    usedProvider: false,
    finalProvider: "original",
    finalModel: "original-preserved",
    providerTrace: {
      requested_provider: providerAttempt.requestedProvider,
      attempted_provider: providerAttempt.attemptedProvider,
      returned_provider: providerAttempt.returnedProvider,
      selected_final_provider: "original",
      provider_result_accepted: false,
      rejection_reason: skippedReason,
      provider_cost: providerAttempt.costUsd,
      fallback_used: true,
      fallback_reason: skippedReason,
      fidelity_score: originalFidelity.overall,
      improvement_score: 0,
      quality_gate_result: "Original Preserved",
      processing_mode: processingMode,
    },
    qualityGate: null,
    needAssessment,
  };
}

async function reportEnhancementProgress(ctx: PipelineContext): Promise<void> {
  const total = ctx.images.length;
  const processed = ctx.images.filter((img) => img.processedUrl || img.processingStatus === "Failed").length;
  const failed = ctx.images.filter((img) => img.processingStatus === "Failed").length;
  const progressPercent = total > 0
    ? Math.min(49, 30 + Math.floor((processed / total) * 18))
    : 30;

  await db
    .update(aiPhotoJobsTable)
    .set({
      currentStage: "Enhance",
      processedPhotos: processed,
      failedPhotos: failed,
      progressPercent,
    })
    .where(eq(aiPhotoJobsTable.id, ctx.job.id));
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
      const restored = await restoreWithValidation(ctx, buf, classification, preset, img.sourcePhotoId);
      const afterStats = await measureImageStats(restored.output);
      const brightnessDelta = afterStats.meanBrightness - beforeStats.meanBrightness;
      const contrastDelta = afterStats.meanContrast - beforeStats.meanContrast;
      const improvementLevel = classifyImprovement(brightnessDelta, contrastDelta);

      img.promptVersion = HIGH_FIDELITY_RESTORATION_VERSION;
      img.restorationProvider = restored.finalProvider;
      img.restorationModel = restored.finalModel;
      img.restorationUsed = restored.output !== buf;
      img.restorationTimeMs = Date.now() - started;
      img.totalProcessingTimeMs = (img.totalProcessingTimeMs ?? 0) + img.restorationTimeMs;
      img.photoFidelityScore = restored.fidelity.overall;
      img.photoFidelityFlags = serializeFidelity(restored.fidelity, restored.intensity, restored.usedProvider, restored.qualityGate);
      img.providerTrace = restored.providerTrace;
      img.qualityGateResult = restored.providerTrace.quality_gate_result;
      img.qualityImprovementClass = restored.providerTrace.quality_gate_result;
      img.qualityImprovementScore = restored.providerTrace.improvement_score;
      img.restorationNeedReasons = restored.needAssessment.reasons;
      img.restorationNeedScore = restored.needAssessment.score;
      img.enhancementDelta = {
        brightnessDelta: parseFloat(brightnessDelta.toFixed(2)),
        contrastDelta: parseFloat(contrastDelta.toFixed(2)),
        improvementLevel:
          restored.providerTrace.quality_gate_result === "Strong Improvement"
            ? "high"
            : restored.providerTrace.quality_gate_result === "Moderate Improvement"
              ? "medium"
              : "none",
        qualityImprovementClass: restored.providerTrace.quality_gate_result,
        improvementScore: restored.providerTrace.improvement_score,
      };

      const originalPreserved = restored.finalProvider === "original";
      const localVisionNoImprovement =
        restored.finalProvider === "dealerpilot-vision-engine" &&
        restored.providerTrace.quality_gate_result !== "Strong Improvement" &&
        restored.providerTrace.quality_gate_result !== "Moderate Improvement";

      if (originalPreserved || localVisionNoImprovement) {
        img.processedUrl = src;
        img.usedFallback = 1;
        img.restorationRejectedReason = restored.providerTrace.rejection_reason ?? restored.fidelity.reasons.join(",");
        ctx.log.info(
          {
            vehicleId: ctx.job.vehicleId,
            classification,
            score: restored.fidelity.overall,
            improvementLevel: img.enhancementDelta.improvementLevel,
            qualityGateResult: restored.providerTrace.quality_gate_result,
            usedProvider: restored.usedProvider,
            finalProvider: restored.finalProvider,
            providerCost: restored.providerTrace.provider_cost,
          },
          "photo:enhance final selection preserved original",
        );
        await reportEnhancementProgress(ctx);
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
          improvementLevel: img.enhancementDelta.improvementLevel,
          qualityGateResult: restored.providerTrace.quality_gate_result,
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

    await reportEnhancementProgress(ctx);
  }
}
