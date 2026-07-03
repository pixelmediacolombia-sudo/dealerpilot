// Stage 4: Enhance v2.4 — premium automotive photography treatment.
//
// v2.4 design principles — stronger, visually-obvious enhancement:
//   • GOAL: "This car looks newer, cleaner and more valuable" — immediately obvious
//     at a glance, not just on a diff-comparison tool.
//   • LOSSLESS INTERMEDIATE BUFFERS: all intermediate .toBuffer() calls use .png()
//     to prevent multi-generation JPEG compression artifacts.
//   • SHARPEN ADDED: exterior and interior both get a moderate unsharp mask. Safe
//     because the lossless pipeline has already removed compression artifacts before
//     the sharpen runs.
//   • BEFORE/AFTER DELTA: brightness + contrast (stdev proxy) are measured on the
//     original input and the final enhanced output. If the improvement is below the
//     "none" threshold (<1.5 brightness counts + <0.8 stdev) the enhanced file is
//     discarded and the source is used as-is (no point spending I/O on a no-op).
//   • IMPROVEMENT LEVEL stored on img.enhancementDelta for the validate stage to
//     persist in quality_flags JSON.
//
// PRESETS (v2.4 targets)
// ────────────────────────────────────────────────────────────────────────────
//   exterior_premium      → brightnessDelta ≈ 8–14 · contrastDelta ≈ 3–7  → "medium"–"high"
//   interior_premium      → brightnessDelta ≈ 4–8  · contrastDelta ≈ 2–4  → "medium"
//   technical_readability → brightnessDelta ≈ 2–6  · contrastDelta ≈ 1–3  → "low"–"medium"
//
// Quality target: Naturalness ≥ 85, Artifact Detection ≥ 85, Marketplace Ready ≥ 85
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { EXTERIOR_CLASSIFICATIONS, STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

export const ENHANCE_PRESET_VERSION = "v2.4";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAiPhotosDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("/api/static/ai-photos/")) {
    const filename = urlOrPath.replace("/api/static/ai-photos/", "");
    const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
    return fs.readFileSync(path.join(dir, filename));
  }
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Fetch failed ${urlOrPath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(urlOrPath);
}

// ── Brightness/contrast measurement ──────────────────────────────────────────
// Returns mean brightness (0–255 scale) and mean stdev (contrast proxy) across
// the R, G, B channels.

async function measureImageStats(buf: Buffer): Promise<{ meanBrightness: number; meanContrast: number }> {
  try {
    const stats = await sharp(buf).stats();
    const channels = stats.channels.slice(0, 3);
    if (channels.length === 0) return { meanBrightness: 0, meanContrast: 0 };
    const meanBrightness = channels.reduce((s, c) => s + c.mean, 0) / channels.length;
    const meanContrast = channels.reduce((s, c) => s + c.stdev, 0) / channels.length;
    return { meanBrightness, meanContrast };
  } catch {
    return { meanBrightness: 0, meanContrast: 0 };
  }
}

// Classify improvement level based on absolute deltas (0–255 scale).
// Thresholds are conservative — "none" only triggers when the enhancement
// is genuinely imperceptible (< 0.6% brightness change + < 0.3% contrast).
function classifyImprovement(
  brightnessDelta: number,
  contrastDelta: number,
): "none" | "low" | "medium" | "high" {
  const b = Math.abs(brightnessDelta);
  const c = Math.abs(contrastDelta);
  if (b < 1.5 && c < 0.8) return "none";
  if (b < 5  && c < 2.0)  return "low";
  if (b < 14 || c < 7)    return "medium";
  return "high";
}

// ── PRESET: exterior_premium ──────────────────────────────────────────────────
//
// Goal: certified-pre-owned premium inventory quality — Mercedes / BMW / Audi.
//   "This car looks newer, shinier and more valuable." Visible at a glance.
//
// v2.4 pipeline:
//   1. Pre-denoise blur(0.4)       — suppress JPEG block artifacts before tonal work
//   2. Gamma 1.12                  — clear midtone lift (vs 1.05 in v2.3)
//   3. Modulate brightness 1.04 / saturation 1.20  — punchy automotive colour
//   4. Linear(1.04, -6)            — noticeable contrast with mild shadow protection
//   5. Sharpen sigma 0.5 / m1 0.3 / m2 1.5  — crisp paint edges, no halo on curves
//   6. Post-denoise blur(0.3)      — suppress any artifact amplified by contrast/sharpen
//   7. JPEG 95 / 4:4:4             — single lossy step
export async function presetExteriorPremium(input: Buffer): Promise<Buffer> {
  // Pass 1: pre-denoise — lossless (prevents intermediate JPEG re-encoding).
  const preDenoised = await sharp(input)
    .blur(0.4)
    .png()
    .toBuffer();

  // Pass 2: tonal + sharpen — lossless intermediate.
  const tonal = await sharp(preDenoised)
    .normalise({ lower: 0.01, upper: 99.99 })
    .gamma(1.12)
    .modulate({ brightness: 1.04, saturation: 1.20 })
    .linear(1.04, -6)
    .sharpen({ sigma: 0.5, m1: 0.3, m2: 1.5, x1: 2, y2: 10, y3: 20 })
    .png()
    .toBuffer();

  // Pass 3: post-denoise + final JPEG (only lossy step).
  return sharp(tonal)
    .blur(0.3)
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── PRESET: interior_premium ──────────────────────────────────────────────────
//
// Goal: luxury dealer brochure photography — rich blacks, clean whites, texture pop.
//
// v2.4 pipeline:
//   1. Pre-denoise blur(0.3)       — preserve leather stitching detail
//   2. Gamma 1.08                  — moody lift (vs 1.04 in v2.3)
//   3. Modulate brightness 1.02 / saturation 1.12  — warm leather/trim pop
//   4. Linear(1.03, -4)            — deeper blacks, cleaner highlights
//   5. Sharpen sigma 0.4 / m1 0.4 / m2 1.2  — stitching + dashboard clarity
//   6. Post-denoise blur(0.3)      — minimum sigma; preserve micro-texture
//   7. JPEG 95 / 4:4:4
export async function presetInteriorPremium(input: Buffer): Promise<Buffer> {
  const preDenoised = await sharp(input)
    .blur(0.3)
    .png()
    .toBuffer();

  const tonal = await sharp(preDenoised)
    .normalise({ lower: 0.02, upper: 99.98 })
    .gamma(1.08)
    .modulate({ brightness: 1.02, saturation: 1.12 })
    .linear(1.03, -4)
    .sharpen({ sigma: 0.4, m1: 0.4, m2: 1.2, x1: 2, y2: 8, y3: 15 })
    .png()
    .toBuffer();

  return sharp(tonal)
    .blur(0.3)
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── PRESET: technical_readability ────────────────────────────────────────────
//
// Goal: maximum text/number legibility — VIN plates, odometer, gauge clusters.
//   Slight gamma lift added (v2.4) to help dim indoor shots.
export async function presetTechnicalReadability(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .normalise({ lower: 0.5, upper: 99.5 })
    .gamma(1.03)
    .sharpen({ sigma: 0.45, m1: 0.5, m2: 1.0, x1: 2, y2: 8, y3: 12 })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── Classification → Preset routing ──────────────────────────────────────────

function routePreset(classification: string): "exterior_premium" | "interior_premium" | "technical_readability" {
  if (
    EXTERIOR_CLASSIFICATIONS.has(classification) ||
    STUDIO_EXTERIOR_CLASSIFICATIONS.has(classification)
  ) {
    return "exterior_premium";
  }
  if (classification.startsWith("Interior")) {
    return "interior_premium";
  }
  if (
    classification.startsWith("Technical") ||
    classification.startsWith("Dealer") ||
    classification === "Miscellaneous"
  ) {
    return "technical_readability";
  }
  return "exterior_premium";
}

// ── Stage entry point ─────────────────────────────────────────────────────────

export async function stageEnhance(ctx: PipelineContext): Promise<void> {
  const uploadDir = getAiPhotosDir();

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    const src = img.compositedUrl ?? img.backgroundRemovedUrl ?? img.originalUrl;

    try {
      const buf = await fetchBuffer(src);

      // ── Measure BEFORE stats ─────────────────────────────────────────────
      const beforeStats = await measureImageStats(buf);

      const classification = img.classification ?? "Miscellaneous";
      const preset = routePreset(classification);

      let enhanced: Buffer;
      if (preset === "exterior_premium") {
        enhanced = await presetExteriorPremium(buf);
      } else if (preset === "interior_premium") {
        enhanced = await presetInteriorPremium(buf);
      } else {
        enhanced = await presetTechnicalReadability(buf);
      }

      // ── Measure AFTER stats ──────────────────────────────────────────────
      const afterStats = await measureImageStats(enhanced);
      const brightnessDelta = afterStats.meanBrightness - beforeStats.meanBrightness;
      const contrastDelta   = afterStats.meanContrast   - beforeStats.meanContrast;
      const improvementLevel = classifyImprovement(brightnessDelta, contrastDelta);

      img.enhancementDelta = {
        brightnessDelta: parseFloat(brightnessDelta.toFixed(2)),
        contrastDelta:   parseFloat(contrastDelta.toFixed(2)),
        improvementLevel,
      };

      if (improvementLevel === "none") {
        // Enhancement produced no visible change — don't write the file,
        // revert to source so we don't serve an identical byte-bloat copy.
        img.processedUrl = src;
        img.usedFallback = 1;
        ctx.log.info(
          { vehicleId: ctx.job.vehicleId, classification, preset, brightnessDelta, contrastDelta, version: ENHANCE_PRESET_VERSION },
          "photo:enhance no visible improvement — using source as-is",
        );
      } else {
        const filename = `enh-${ctx.job.vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        fs.writeFileSync(path.join(uploadDir, filename), enhanced);
        img.processedUrl = `/api/static/ai-photos/${filename}`;

        ctx.log.debug(
          { vehicleId: ctx.job.vehicleId, filename, classification, preset, improvementLevel,
            brightnessDelta: brightnessDelta.toFixed(2), contrastDelta: contrastDelta.toFixed(2),
            version: ENHANCE_PRESET_VERSION },
          "photo:enhance v2.4",
        );
      }
    } catch (err) {
      img.processedUrl = src;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: src }, "photo:enhance v2.4 failed — using source as-is");
    }
  }
}
