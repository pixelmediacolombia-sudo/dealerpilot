// Stage 4: Enhance v2.1 — natural dealership photography treatment.
//
// v2.3 design principles — critical bug fix + two-pass denoise:
//   • LOSSLESS INTERMEDIATE BUFFERS: all intermediate .toBuffer() calls now use
//     .png() to force lossless encoding. Without this, Sharp inherits the input
//     format (JPEG at quality ~80) for intermediate buffers, producing multiple
//     JPEG re-encodes before the final output. 3 JPEG compressions in series was
//     the root cause of Artifact Detection failures. Now only the final .jpeg()
//     call encodes lossy.
//   • Two-pass denoise (pre + post tonal chain) — kept from v2.2.
//   • Tonal settings: same conservative values from v2.2 (gamma 1.05, sat 1.06).
//   • Interior post-denoise blur fixed to 0.3 (Sharp minimum is 0.3; 0.25 crashed).
//   • No sharpen on exterior or interior.
//   • Technical readability: single pass, no intermediate buffers needed.
//
// Quality target: Naturalness ≥ 85, Artifact Detection ≥ 85, Marketplace Ready ≥ 85
// (DealerPilot Photo Quality Gate — Phase 1.5).
//
// PRESETS
// ────────────────────────────────────────────────────────────────────────────
//   exterior_premium       → all exterior photos
//   interior_premium       → all interior photos
//   technical_readability  → documents, VIN, odometer, gauge cluster, stickers
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { EXTERIOR_CLASSIFICATIONS, STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

// Bump when tuning params so DB can track which preset was used.
export const ENHANCE_PRESET_VERSION = "v2.3";

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
//   "This car looks newer, cleaner and more valuable" — NOT "this image has a filter."
//
// Pipeline (v2.2 — two-pass denoise):
//   1. Pre-denoise    — blur(0.5) suppresses original JPEG block artifacts before
//                       any contrast work.
//   2. Normalise      — nearly-no-op (0.01/99.99) — only clips single stuck pixels.
//                       Removed aggressive stretch that was boosting artifact visibility.
//   3. Gamma(1.05)    — lighter midtone lift vs v2.0 (1.08); enough to brighten
//                       without the "HDR pop" that reads as filtered.
//   4. Modulate       — saturation 1.06 (was 1.09); +1% brightness; subtle only.
//   5. Linear(1.01,0) — barely-there contrast tick; removed the -1 offset that
//                       was crushing shadow detail.
//   6. Post-denoise   — blur(0.3) second pass after tonal corrections to suppress
//                       any JPEG artifacts that the contrast chain amplified.
//                       This is the key fix: the first pass can't pre-emptively
//                       suppress artifacts that don't exist yet.
//   7. NO sharpen.
//   8. JPEG 95 / 4:4:4.
export async function presetExteriorPremium(input: Buffer): Promise<Buffer> {
  // Pass 1: pre-denoise — lossless PNG output (critical: avoids intermediate JPEG).
  const preDenoised = await sharp(input)
    .blur(0.5)
    .png()         // lossless — prevents Sharp defaulting to JPEG quality ~80
    .toBuffer();

  // Pass 2: tonal corrections — soft touch, lossless intermediate.
  const tonal = await sharp(preDenoised)
    .normalise({ lower: 0.01, upper: 99.99 })
    .gamma(1.05)
    .modulate({ brightness: 1.01, saturation: 1.06 })
    .linear(1.01, 0)
    .png()         // lossless — still no JPEG encode yet
    .toBuffer();

  // Pass 3: post-denoise — ONLY lossy encode happens here, once, at full quality.
  return sharp(tonal)
    .blur(0.3)
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
// v2.2 changes (same two-pass denoise logic as exterior):
//   • Pre-denoise blur(0.4) — finer than exterior to preserve stitching detail.
//   • Nearly-no-op normalise (0.02/99.98).
//   • Gamma 1.04 — interiors should stay rich and slightly moody.
//   • Saturation 1.05 — very subtle leather/trim warmth.
//   • linear(1.01, 0) — no shadow crush.
//   • Post-denoise blur(0.25) — lighter than exterior; preserve micro-texture.
//   • No sharpen.
export async function presetInteriorPremium(input: Buffer): Promise<Buffer> {
  // Pass 1: pre-denoise — gentler than exterior (preserve stitching/knob detail).
  const preDenoised = await sharp(input)
    .blur(0.4)
    .png()         // lossless intermediate
    .toBuffer();

  // Pass 2: tonal — very light touch.
  const tonal = await sharp(preDenoised)
    .normalise({ lower: 0.02, upper: 99.98 })
    .gamma(1.04)
    .modulate({ brightness: 1.01, saturation: 1.05 })
    .linear(1.01, 0)
    .png()         // lossless intermediate
    .toBuffer();

  // Pass 3: post-denoise + final JPEG encode (only lossy step).
  // 0.3 minimum (Sharp requires sigma >= 0.3).
  return sharp(tonal)
    .blur(0.3)
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// ── PRESET: technical_readability ────────────────────────────────────────────
//
// Goal: maximum text and number clarity for documents, VIN, odometer, gauges.
//   • Only improve readability — do not stylize or color-grade
//
// Sharpen is kept for technical photos because:
//   • Text edges are hard, straight, and benefit from sharpening (no halo risk)
//   • No curved paint surfaces or dealer overlays to create artifact halos
//   • m2 reduced from 2.0 → 1.0 (v2.0 was too aggressive even for text)
//
// No noise reduction (would blur text/numbers).
// No saturation (preserve exact document colors).
// No gamma (preserve screen/sticker brightness).
export async function presetTechnicalReadability(input: Buffer): Promise<Buffer> {
  return sharp(input)
    // Moderate contrast stretch for dim screens / washed-out stickers.
    .normalise({ lower: 0.5, upper: 99.5 })
    // Local sharpen for text edges only.
    // sigma 0.45 — fine character stroke radius
    // m1 0.5     — skip smooth areas (blank paper / solid backgrounds)
    // m2 1.0     — reduced from 2.0; still crisp text without halo on ruled lines
    // x1 2 / y2 8 / y3 12 — overshoot caps (prevents print artifact amplification)
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
        "photo:enhance v2.1",
      );
    } catch (err) {
      img.processedUrl = src;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: src }, "photo:enhance v2.1 failed — using source as-is");
    }
  }
}
