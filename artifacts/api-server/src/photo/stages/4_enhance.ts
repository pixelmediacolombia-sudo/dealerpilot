// Stage 4: Enhance — applies luxury dealership-quality image processing.
//
// Primary exterior composites (studio background photos):
//   Full professional treatment:
//   - CLAHE local contrast (makes paint reflections pop)
//   - Dynamic range expansion (normalise)
//   - Saturation + brightness lift (richer paint colours)
//   - Contrast curve (deeper blacks, brighter highlights)
//   - High-quality unsharp mask (crisp, no artifacts)
//
// Secondary exterior (Wheel, Engine, Bed, Tailgate — no studio bg):
//   Moderate: normalise + saturation + sharpen.
//
// Interior:
//   Gentle: normalise + subtle saturation + soft sharpen.
//   Preserves natural cabin tones.
//
// Technical / Dealer:
//   Light sharpen only — clarity without colour distortion.
//
// Output: JPEG at quality 95 with 4:4:4 chroma (no colour bleed).
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

      let pipeline = sharp(buf);

      if (isStudioExterior) {
        // ── Luxury studio exterior treatment ─────────────────────────────────
        // 1. CLAHE — local contrast adaptation (paint reflections, panel lines pop)
        // 2. Normalise — expand dynamic range to full 0–255 without clipping
        // 3. Saturation + brightness lift — richer paint, warm studio feel
        // 4. Contrast curve — deeper blacks, clean highlights
        // 5. Unsharp mask — crisp detail without halos
        pipeline = pipeline
          .clahe({ width: 64, height: 64, maxSlope: 3 })
          .normalise({ lower: 0.5, upper: 99.5 })
          .modulate({ brightness: 1.04, saturation: 1.20, hue: 0 })
          .linear(1.06, -6)
          .sharpen({ sigma: 0.85, m1: 0.6, m2: 3.5, x1: 3, y2: 15, y3: 22 });
      } else if (isSecondaryExterior) {
        // ── Secondary exterior (detail shots — no composite bg) ───────────────
        pipeline = pipeline
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: 1.02, saturation: 1.10 })
          .sharpen({ sigma: 0.75, m1: 0.5, m2: 2.5 });
      } else if (classification.startsWith("Interior")) {
        // ── Interior — preserve natural cabin lighting ────────────────────────
        pipeline = pipeline
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: 1.01, saturation: 1.06 })
          .sharpen({ sigma: 0.65, m1: 0.4, m2: 1.8 });
      } else {
        // ── Technical / Dealer / Misc — clarity only ─────────────────────────
        pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0.3, m2: 1.2 });
      }

      const enhanced = await pipeline
        .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
        .toBuffer();

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
