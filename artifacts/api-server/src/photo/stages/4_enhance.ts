// Stage 4: Enhance v2 — natural dealership photography treatment.
//
// v2 design principles (vs v1):
//   • Noise FIRST — blur before any contrast/sharpen so we suppress JPEG artifacts
//     before enhancement, not amplify them.
//   • No CLAHE — the biggest source of the "crunchy" look in v1; removed entirely.
//   • No fake overlays — studio light gradient removed (artificial).
//   • Conservative saturation — 1.07–1.09 (v1 used 1.18 which looked oversaturated).
//   • gamma() for midtone lift — more natural roll-off than linear() contrast.
//   • Very light unsharp mask — sigma ≤ 0.5, m2 ≤ 2.0; local edges only.
//
// PRESETS
// ────────────────────────────────────────────────────────────────────────────
//   exterior_premium       → all exterior photos (studio + detail shots)
//   interior_premium       → all interior photos
//   technical_readability  → documents, VIN, odometer, gauge cluster, stickers
//
// Quality target: Mercedes / BMW / Porsche certified-pre-owned inventory photos.
// The operator should feel "this car looks newer, cleaner and more valuable"
// — NOT "this image has a filter."
//
// If the enhanced image is measurably worse (sharpness regression), Stage 5
// automatically reverts it to the original.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { EXTERIOR_CLASSIFICATIONS, STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

// ── Preset version (bump when tuning params so DB can track which preset was used) ──
export const ENHANCE_PRESET_VERSION = "v2.0";

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

// ── PRESET: exterior_premium ──────────────────────────────────────────────────
//
// Goal: Mercedes / BMW / Porsche certified-pre-owned inventory quality.
//   • Cleaner, better lit, glossier, more premium
//   • Paint depth, glass clarity, wheel contrast
//   • Original background kept; no color changes; no HDR look
//
// Pipeline (follows spec priority order):
//   1. Noise / JPEG-artifact reduction — subtle Gaussian sigma 0.4
//      (Must be a separate pass so sharpen does NOT amplify noise)
//   2. Dynamic range — barely touch histogram tails (0.1 / 99.9)
//   3. Exposure — gamma(1.08) lifts midtones naturally without blowing highlights
//   4. Shadow recovery — modulate brightness +1% lifts crushed shadows
//   5. Highlight recovery — covered by gamma roll-off (no linear clip)
//   6. Mild contrast — linear(1.02, -1) barely deepens blacks
//   7. Paint depth / color — saturation 1.09 (subtle, not HDR)
//   8. Very light local sharpen — sigma 0.45, m2 1.6 (edges only, no halos)
//   9. High-quality JPEG output 95 / 4:4:4
export async function presetExteriorPremium(input: Buffer): Promise<Buffer> {
  // Pass 1: noise / JPEG artifact reduction
  // A small Gaussian sigma smooths 8×8 JPEG blocking artifacts.
  // This runs as a separate toBuffer() so the sharpen in pass 2 never
  // "sees" JPEG noise — the single biggest fix over v1.
  const denoised = await sharp(input)
    .blur(0.4)
    .toBuffer();

  // Pass 2: all tonal + color + output in one libvips pass
  return sharp(denoised)
    // Dynamic range: barely clip tails (0.1 / 99.9) — recover washed-out photos
    // without hard clipping that creates banding.
    .normalise({ lower: 0.1, upper: 99.9 })
    // Gamma: lifts midtones (paint, glass, bodywork) naturally.
    // 1.08 = ~8% midtone brightness boost with natural roll-off at highlights.
    .gamma(1.08)
    // Color: very subtle saturation lift for paint depth.
    // brightness 1.01 = shadow recovery (+1% global lift).
    // saturation 1.09 = just enough to make paint pop without looking filtered.
    .modulate({ brightness: 1.01, saturation: 1.09 })
    // Contrast: linear(1.02, -1) — deepens blacks by 1 point, lifts contrast 2%.
    // Much gentler than v1's linear(1.05, -5) which crushed shadow detail.
    .linear(1.02, -1)
    // Sharpen: local only, no halos, no crunch.
    // sigma 0.45  — target feature radius (sub-pixel paint texture, badge edges)
    // m1 0.5      — flat-region threshold: skip smooth areas (sky, panels)
    // m2 1.6      — edge slope: gentle (v1 used 3.5 which created crunchiness)
    // x1 2        — overshoot floor
    // y2 8, y3 12 — overshoot ceiling (caps halos)
    .sharpen({ sigma: 0.45, m1: 0.5, m2: 1.6, x1: 2, y2: 8, y3: 12 })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── PRESET: interior_premium ──────────────────────────────────────────────────
//
// Goal: luxury dealer brochure photography.
//   • Leather texture, seat stitching, dashboard detail, screen clarity
//   • Deep blacks, clean whites, noise-free
//   • DO NOT: change upholstery color, over-brighten screens, make leather look fake
//
// Slightly different from exterior:
//   • gentler blur (0.3) — interiors are already softer, avoid blurring stitching
//   • gamma 1.05 — interiors should stay richer/darker (not blown out)
//   • saturation 1.07 — leather and trim benefit from subtle richness
//   • slightly stronger sharpen — leather grain, buttons, knobs benefit from detail
export async function presetInteriorPremium(input: Buffer): Promise<Buffer> {
  // Pass 1: very subtle noise reduction
  const denoised = await sharp(input)
    .blur(0.3)
    .toBuffer();

  // Pass 2: tonal + color + output
  return sharp(denoised)
    .normalise({ lower: 0.15, upper: 99.85 })
    // Gamma 1.05 — lighter touch than exterior; interiors should stay rich
    .gamma(1.05)
    .modulate({ brightness: 1.01, saturation: 1.07 })
    // Slightly more contrast — deep blacks are critical for premium interior look
    .linear(1.03, -2)
    // Slightly more targeted sharpen — leather grain, button labels, infotainment text
    .sharpen({ sigma: 0.5, m1: 0.55, m2: 1.8, x1: 3, y2: 10, y3: 15 })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── PRESET: technical_readability ────────────────────────────────────────────
//
// Goal: maximum text and number clarity for documents, VIN, odometer, gauges.
//   • Only improve readability
//   • DO NOT: stylize, apply color grade, change information content
//
// No noise reduction (would blur text/numbers).
// No saturation (preserve exact colors of documents and screens).
// No gamma (preserve actual brightness of stickers/screens).
// Very light sharpen tuned for fine line / text clarity.
export async function presetTechnicalReadability(input: Buffer): Promise<Buffer> {
  return sharp(input)
    // Gentle dynamic range stretch — recover washed-out or dim screens/stickers
    .normalise({ lower: 0.5, upper: 99.5 })
    // Sharpen for crisp text, VIN digits, gauge numbers
    // Higher m2 (2.0) than exterior because we need sharp text edges specifically
    .sharpen({ sigma: 0.5, m1: 0.4, m2: 2.0, x1: 3, y2: 10, y3: 14 })
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
  // Default: exterior treatment (safe for unknown labels)
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

      const filename = `enh-${ctx.job.vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      fs.writeFileSync(path.join(uploadDir, filename), enhanced);
      img.processedUrl = `/api/static/ai-photos/${filename}`;

      ctx.log.debug(
        { vehicleId: ctx.job.vehicleId, filename, classification, preset, version: ENHANCE_PRESET_VERSION },
        "photo:enhance v2",
      );
    } catch (err) {
      // Non-fatal — fall back to source URL; Stage 5 will flag the sharpness regression
      img.processedUrl = src;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: src }, "photo:enhance v2 failed — using source as-is");
    }
  }
}
