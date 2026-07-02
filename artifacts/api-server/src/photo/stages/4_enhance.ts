// Stage 4: Enhance — applies luxury dealership-quality image processing.
//
// Studio Exterior composites (have a studio background):
//   Professional studio treatment:
//   1. CLAHE local contrast (paint reflections / panel lines pop)
//   2. Normalise dynamic range
//   3. Saturation + brightness lift for richer paint
//   4. Contrast curve (deeper blacks, brighter highlights)
//   5. Unsharp mask (crisp detail, no halos)
//   6. Studio overhead light overlay — soft radial gradient at 12 % opacity
//      to simulate a real studio ceiling fixture
//
// Secondary Exterior (Wheel, Engine, Bed, Tailgate — no studio bg):
//   Moderate: normalise + saturation + sharpen.
//
// Interior:
//   Gentle: normalise + subtle saturation + soft sharpen.
//
// Technical / Dealer:
//   Light sharpen only.
//
// Output: JPEG 95, 4:4:4 chroma.
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

// Build a soft radial gradient PNG that simulates a studio overhead light.
// Centred at the upper-middle of the image, fades to transparent toward edges.
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

      const isStudioExterior   = STUDIO_EXTERIOR_CLASSIFICATIONS.has(classification);
      const isSecondaryExterior = EXTERIOR_CLASSIFICATIONS.has(classification) && !isStudioExterior;

      let enhanced: Buffer;

      if (isStudioExterior) {
        // ── Luxury studio exterior treatment ─────────────────────────────────
        // Steps 1–5: standard Sharp chain
        const processed = await sharp(buf)
          .clahe({ width: 64, height: 64, maxSlope: 3 })
          .normalise({ lower: 0.5, upper: 99.5 })
          .modulate({ brightness: 1.03, saturation: 1.18, hue: 0 })
          .linear(1.05, -5)
          .sharpen({ sigma: 0.85, m1: 0.6, m2: 3.5, x1: 3, y2: 15, y3: 22 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

        // Step 6: composite studio overhead light overlay
        const meta = await sharp(processed).metadata();
        const w = meta.width  ?? 1536;
        const h = meta.height ?? 1024;
        const lightOverlay = await buildStudioLightOverlay(w, h);

        enhanced = await sharp(processed)
          .composite([{ input: lightOverlay, blend: "screen" }])
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else if (isSecondaryExterior) {
        // ── Secondary exterior ────────────────────────────────────────────────
        enhanced = await sharp(buf)
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: 1.02, saturation: 1.10 })
          .sharpen({ sigma: 0.75, m1: 0.5, m2: 2.5 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else if (classification.startsWith("Interior")) {
        // ── Interior — preserve natural cabin lighting ────────────────────────
        enhanced = await sharp(buf)
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: 1.01, saturation: 1.06 })
          .sharpen({ sigma: 0.65, m1: 0.4, m2: 1.8 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();

      } else {
        // ── Technical / Dealer / Misc — clarity only ─────────────────────────
        enhanced = await sharp(buf)
          .sharpen({ sigma: 0.5, m1: 0.3, m2: 1.2 })
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();
      }

      const filename = `enh-${ctx.job.vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      fs.writeFileSync(path.join(uploadDir, filename), enhanced);
      img.processedUrl = `/api/static/ai-photos/${filename}`;

      ctx.log.debug(
        { vehicleId: ctx.job.vehicleId, filename, classification, isStudioExterior },
        "photo:enhance",
      );
    } catch (err) {
      img.processedUrl = src;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: src }, "photo:enhance failed — using source as-is");
    }
  }
}
