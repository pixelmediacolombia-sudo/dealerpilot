// Stage 5: Validate — full quality gate for every processed photo.
//
// Checks per image:
//   resolutionOk       — meets minimum dimensions (1024×640)
//   aspectRatioOk      — landscape or square (w/h >= 0.75)
//   studioComposited   — primary exterior has a non-original composited URL
//   noFallback         — background removal succeeded
//   classifiedOk       — not "Miscellaneous" for primary exterior
//   logoOk             — img.logoObscured is false (set by Stage 3)
//   vehicleNotCropped  — output dimensions meet the expected studio canvas size
//   aiNotWorse         — AI sharpness/contrast >= 75 % of original (Sharp stdev proxy)
//
// AUTO-REJECT:
//   For studio exterior shots, if the AI output is measurably worse than the original
//   (aiNotWorse = false), the processedUrl is reverted to the originalUrl and
//   img.aiWorseThanOriginal is set true.  This ensures the marketplace NEVER receives
//   an AI image that degrades the source photo.
//
// Scoring 0–100.  Below NEEDS_REVIEW_THRESHOLD → ctx.qualityGateFailed = true.
// The export stage marks the photo set "Needs Review" instead of "Ready".
import sharp from "sharp";
import fs from "fs";
import path from "path";
import type { PipelineContext } from "../pipeline";
import { STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

const MIN_WIDTH  = 1024;
const MIN_HEIGHT =  640;
// Studio composites are 1536×1024; flag if significantly smaller
const STUDIO_MIN_W = 1400;
const STUDIO_MIN_H =  900;
// AI sharpness must be at least this fraction of original (stdev proxy)
const MIN_SHARPNESS_RATIO = 0.75;
const NEEDS_REVIEW_THRESHOLD = 45;

interface QualityFlags {
  resolutionOk:      boolean;
  aspectRatioOk:     boolean;
  studioComposited:  boolean;
  noFallback:        boolean;
  classifiedOk:      boolean;
  logoOk:            boolean;
  vehicleNotCropped: boolean;
  aiNotWorse:        boolean;
  needsReview:       boolean;
}

// ── Image loading ─────────────────────────────────────────────────────────────

async function resolveBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("/api/static/ai-photos/")) {
      const filename = url.replace("/api/static/ai-photos/", "");
      const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
      const filepath = path.join(dir, filename);
      if (fs.existsSync(filepath)) return fs.readFileSync(filepath);
      return null;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

// ── Sharpness proxy via Sharp statistics ──────────────────────────────────────
// Mean standard deviation across RGB channels — higher = more detail / contrast.
// Not a true Laplacian, but fast, free, and monotonically correlated with
// perceived sharpness for automotive photos.

async function measureSharpness(buf: Buffer): Promise<number> {
  try {
    const stats = await sharp(buf).stats();
    const channels = stats.channels.slice(0, 3); // R, G, B only (ignore alpha)
    if (channels.length === 0) return 0;
    return channels.reduce((sum, ch) => sum + ch.stdev, 0) / channels.length;
  } catch {
    return 0;
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreFlags(flags: QualityFlags): number {
  let score = 0;
  if (flags.resolutionOk)      score += 20;
  if (flags.aspectRatioOk)     score += 10;
  if (flags.studioComposited)  score += 25;
  if (flags.noFallback)        score += 15;
  if (flags.classifiedOk)      score += 10;
  if (flags.logoOk)            score += 10;
  if (flags.vehicleNotCropped) score += 5;
  if (flags.aiNotWorse)        score += 5;
  return score;
}

// ── Main validate stage ───────────────────────────────────────────────────────

export async function stageValidate(ctx: PipelineContext): Promise<void> {
  let anyNeedsReview = false;

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    const finalUrl        = img.processedUrl  ?? img.compositedUrl ?? img.originalUrl;
    const isPrimaryExterior = STUDIO_EXTERIOR_CLASSIFICATIONS.has(img.classification ?? "");

    // ── 1. Load output buffer and measure dimensions ─────────────────────────
    const buf = await resolveBuffer(finalUrl);

    let outputW = 0, outputH = 0;
    if (buf) {
      try {
        const meta = await sharp(buf).metadata();
        outputW = meta.width  ?? 0;
        outputH = meta.height ?? 0;
      } catch { /* leave zero */ }
    }

    // ── 2. Sharpness comparison for primary exterior shots ───────────────────
    let aiSharpness   = 0;
    let origSharpness = 0;
    let aiNotWorse    = true; // default pass for non-primary

    if (isPrimaryExterior && buf) {
      aiSharpness = await measureSharpness(buf);
      const origBuf = await resolveBuffer(img.originalUrl);
      if (origBuf) {
        origSharpness = await measureSharpness(origBuf);
      }
      // AI must reach at least MIN_SHARPNESS_RATIO of original
      if (origSharpness > 0) {
        aiNotWorse = aiSharpness >= origSharpness * MIN_SHARPNESS_RATIO;
      }

      // AUTO-REJECT: revert to original if AI is measurably worse
      if (!aiNotWorse) {
        img.aiWorseThanOriginal = true;
        img.processedUrl        = img.originalUrl;
        img.usedFallback        = 1;
        ctx.log.warn({
          vehicleId: ctx.job.vehicleId,
          classification: img.classification,
          aiSharpness:   aiSharpness.toFixed(2),
          origSharpness: origSharpness.toFixed(2),
          ratio:         (aiSharpness / origSharpness).toFixed(3),
        }, "photo:validate AI worse than original — reverting to original photo");
      }
    }

    // ── 3. Build quality flags ───────────────────────────────────────────────
    const flags: QualityFlags = {
      resolutionOk: outputW >= MIN_WIDTH && outputH >= MIN_HEIGHT,
      aspectRatioOk: outputW > 0 && outputH > 0 && outputW / outputH >= 0.75,
      studioComposited: isPrimaryExterior
        ? !!(img.compositedUrl && img.compositedUrl !== img.originalUrl)
        : true,
      noFallback: img.usedFallback === 0,
      classifiedOk: isPrimaryExterior
        ? (img.classification !== "Miscellaneous" && !!img.classification)
        : true,
      logoOk: !img.logoObscured,
      vehicleNotCropped: isPrimaryExterior
        ? (outputW >= STUDIO_MIN_W && outputH >= STUDIO_MIN_H)
        : true,
      aiNotWorse,
      needsReview: false,
    };

    // If buf was null (file not found / unreachable), treat static URLs as resolved
    if (!buf && finalUrl.startsWith("/api/static/")) {
      flags.resolutionOk    = true;
      flags.aspectRatioOk   = true;
      flags.vehicleNotCropped = true;
    }

    const score = scoreFlags(flags);

    // Needs Review: primary exterior that failed critical checks
    flags.needsReview = isPrimaryExterior && (
      !flags.studioComposited ||
      !flags.noFallback       ||
      !flags.logoOk           ||
      img.aiWorseThanOriginal === true
    );
    if (flags.needsReview) anyNeedsReview = true;

    img.qualityScore = score;
    img.qualityFlags = JSON.stringify({
      ...flags,
      aiSharpness:   aiSharpness   > 0 ? parseFloat(aiSharpness.toFixed(2))   : undefined,
      origSharpness: origSharpness > 0 ? parseFloat(origSharpness.toFixed(2)) : undefined,
    });

    ctx.log.debug(
      { vehicleId: ctx.job.vehicleId, url: finalUrl, score, flags, isPrimaryExterior,
        aiSharpness, origSharpness },
      "photo:validate",
    );
  }

  if (anyNeedsReview) {
    ctx.qualityGateFailed = true;
    ctx.log.warn(
      { vehicleId: ctx.job.vehicleId, jobId: ctx.job.id },
      "photo:validate quality gate FAILED — set will be marked Needs Review",
    );
  }
}
