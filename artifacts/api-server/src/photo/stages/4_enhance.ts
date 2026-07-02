// Stage 4: Enhance — applies Sharp.js image quality improvements.
// Exterior: sharpen + normalize + contrast boost (showroom-ready look).
// Interior: lighter touch (sharpen only).
// Output: JPEG saved alongside composited images, or returned as data URL.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";

function getAiPhotosDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("/api/static/")) {
    // Local file served by our static route
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

const EXTERIOR_CLASSIFICATIONS = new Set([
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
  "Wheels",
]);

export async function stageEnhance(ctx: PipelineContext): Promise<void> {
  const lightingPreset = ctx.pack?.lightingPreset ?? "studio_white";
  const uploadDir = getAiPhotosDir();

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    // Source: composited if available, else background-removed, else original
    const src = img.compositedUrl ?? img.backgroundRemovedUrl ?? img.originalUrl;

    try {
      const buf = await fetchBuffer(src);
      const isExterior = EXTERIOR_CLASSIFICATIONS.has(img.classification ?? "");

      let pipeline = sharp(buf);

      if (isExterior) {
        // Showroom-quality enhancement for exterior shots
        pipeline = pipeline
          .sharpen({ sigma: 1.2, m1: 0.8, m2: 2.5 })
          .normalise({ lower: 1, upper: 99 })
          .modulate({ brightness: lightingPreset === "studio_white" ? 1.04 : 1.0, saturation: 1.08 });
      } else {
        // Subtle enhancement for interiors — preserve natural tones
        pipeline = pipeline
          .sharpen({ sigma: 0.8, m1: 0.5, m2: 1.5 })
          .normalise({ lower: 1, upper: 99 });
      }

      const enhanced = await pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();

      const filename = `enh-${ctx.job.vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, enhanced);

      img.processedUrl = `/api/static/ai-photos/${filename}`;

      ctx.log.debug(
        { vehicleId: ctx.job.vehicleId, filename, isExterior, lightingPreset },
        "photo:enhance",
      );
    } catch (err) {
      // Non-fatal: use composited (or original) as final processedUrl
      img.processedUrl = src;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: src }, "photo:enhance failed — using source as-is");
    }
  }
}
