// Stage 4: Enhance — applies premium image processing per photo category.
//
// STUDIO EXTERIOR  (Front / Front 45 / Side / Rear 45 / Rear)
//   — Full luxury dealership treatment:
//   1. CLAHE local contrast  (paint, panel lines, wheel spokes pop)
//   2. Normalise dynamic range
//   3. Saturation + brightness lift for richer paint / deeper colour
//   4. Contrast curve (deeper blacks, brighter highlights)
//   5. Unsharp mask (crisp paint, glass, badges — no halos)
//   6. Studio overhead light overlay — soft radial gradient 12 % opacity
//
// SECONDARY EXTERIOR  (Wheel / Engine / Bed / Tailgate)
//   — Exterior detail treatment, no studio bg:
//   1. CLAHE
//   2. Normalise
//   3. Saturation + moderate brightness lift
//   4. Sharpen for crisp wheel / engine detail
//
// INTERIOR  (all Interior_* labels)
//   — Premium showroom cabin treatment:
//   1. CLAHE small-block (fine leather / stitching / screen detail)
//   2. Normalise (broad tonal range, recover shadows)
//   3. Saturation + gentle brightness lift (richer colour depth)
//   4. Linear contrast curve (deeper blacks, cleaner whites)
//   5. Premium sharpen (leather texture, knobs, buttons, screens)
//
// TECHNICAL / DEALER / MISC
//   — Readability-only; preserve original framing / colours:
//   1. Normalise (gentle — keep full information range)
//   2. Light sharpen (text, numbers, VIN digits)
//
// Output: JPEG 95, 4:4:4 chroma (maximum colour fidelity).
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { STUDIO_EXTERIOR_CLASSIFICATIONS, EXTERIOR_CLASSIFICATIONS } from "../providers/types";

function getAiPhotosDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("/api/static/")) {
    const filename = urlOrPath.replace("/api/static/ai-photos/", "");
    const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
    return fs.readFileSync(path.join(dir, filename));
  }
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Failed to fetch ${urlOrPath}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(urlOrPath);
}

// Soft radial gradient — simulates a studio ceiling overhead light fixture.
async function buildStudioLightOverlay(w: number, h: number): Promise<Buffer> {
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="light" cx="50%" cy="18%" rx="55%" ry="38%">
      <stop offset="0%"   stop-color="white" stop-opacity="0.14"/>
      <stop offset="60%"  stop-color="white" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#light)"/>
</svg>`;
  return sharp(Buffer.from(svgStr)).png().toBuffer();
}

export async function stageEnhance(ctx: PipelineContext): Promise<void> {
  const uploadDir = getAiPhotosDir();

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    const src = img.compositedUrl ?? img.backgroundRemovedUrl ?? img.originalUrl;

    try {
      const buf = await fetchBuffer(src);
      const classification = img.classification ?? "";

      const isStudioExterior    = STUDIO_EXTERIOR_CLASSIFICATIONS.has(classification);
      const isSecondaryExterior = EXTERIOR_CLASSIFICATIONS.has(classification) && !isStudioExterior;
      const isInterior          = classification.startsWith("Interior");
      const isTechnical         = classification.startsWith("Technical") || classification.startsWith("Dealer");

      let enhanced: Buffer;

      if (isStudioExterior) {
        // ── Premium studio exterior ───────────────────────────────────────────
        // Full pipeline: CLAHE → normalise → colour lift → contrast curve → sharpen → overhead light
        const processed = await sharp(buf)
          .clahe({ width: 64, height: 64, maxSlope: 3 })
          .normalise({ lower: 0.5, upper: 99.5 })
          .modulate({ brightness: 1.03, saturation: 1.18, hue: 0 })
          .linear(1.05, -5)
          .sharpen({ sigma: 0.85, m1: 0.6, m2: 3.5, x1: 3, y2: 15, y3: 22 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

        const meta = await sharp(processed).metadata();
        const w = meta.width  ?? 1536;
        const h = meta.height ?? 1024;
        const lightOverlay = await buildStudioLightOverlay(w, h);

        enhanced = await sharp(processed)
          .composite([{ input: lightOverlay, blend: "screen" }])
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else if (isSecondaryExterior) {
        // ── Secondary exterior (Wheel / Engine / Bed / Tailgate) ──────────────
        // CLAHE for fine detail, normalise, saturation lift, crisp sharpen
        enhanced = await sharp(buf)
          .clahe({ width: 48, height: 48, maxSlope: 3 })
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: 1.02, saturation: 1.14 })
          .linear(1.04, -4)
          .sharpen({ sigma: 0.80, m1: 0.5, m2: 3.0, x1: 3, y2: 12, y3: 18 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else if (isInterior) {
        // ── Premium interior cabin treatment ──────────────────────────────────
        // Goal: clean showroom photo — rich leather/fabric, crisp screens,
        //       deep blacks, no muddy shadows, accurate colour depth.
        //
        // CLAHE with small tile (32×32) to recover fine stitching / knob detail
        // without blowing out bright spots (e.g. sun coming through windows).
        // Normalise with generous headroom to recover underexposed shadows.
        // Saturation lift brings out leather, wood trim, and screen colours.
        // Linear curve deepens blacks (removes milky shadow) and lifts mids.
        // Premium sharpen: high flat-region floor (m1), high slope (m2) so
        // leather grain, buttons, and infotainment text come through sharply.
        enhanced = await sharp(buf)
          .clahe({ width: 32, height: 32, maxSlope: 3 })
          .normalise({ lower: 0.5, upper: 99.5 })
          .modulate({ brightness: 1.04, saturation: 1.16, hue: 0 })
          .linear(1.07, -7)
          .sharpen({ sigma: 0.90, m1: 0.55, m2: 4.0, x1: 4, y2: 18, y3: 26 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else if (isTechnical) {
        // ── Technical & Dealer docs — readability only ────────────────────────
        // Gentle normalise to recover washed-out or dim screens/stickers.
        // Light sharpen for crisp text, VIN digits, gauge numbers.
        // No colour manipulation — preserve exact information content.
        enhanced = await sharp(buf)
          .normalise({ lower: 1.5, upper: 98.5 })
          .sharpen({ sigma: 0.60, m1: 0.35, m2: 1.8, x1: 3, y2: 10, y3: 14 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else {
        // ── Miscellaneous — gentle improvement ────────────────────────────────
        enhanced = await sharp(buf)
          .normalise({ lower: 1, upper: 99 })
          .sharpen({ sigma: 0.55, m1: 0.3, m2: 1.5 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();
      }

      const filename = `enh-${ctx.job.vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      fs.writeFileSync(path.join(uploadDir, filename), enhanced);
      img.processedUrl = `/api/static/ai-photos/${filename}`;

      ctx.log.debug(
        { vehicleId: ctx.job.vehicleId, filename, classification, isStudioExterior, isInterior, isTechnical },
        "photo:enhance",
      );
    } catch (err) {
      img.processedUrl = src;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: src }, "photo:enhance failed — using source as-is");
    }
  }
}
