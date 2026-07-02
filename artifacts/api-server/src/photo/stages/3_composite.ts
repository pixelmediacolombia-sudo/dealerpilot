// Stage 3: Composite — places the background-removed vehicle onto the studio background.
// Uses Sharp.js for server-side compositing. Saves output to uploads/ai-photos/.
// Skipped if:
//   - No studio pack background is configured (AI_STUDIO_BACKGROUND env var or pack.backgroundUrl)
//   - Photo is interior/miscellaneous
//   - Background removal was not performed (usedFallback=1 with original that has BG)
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";

// Upload dir: resolved from workspace root (process.cwd() = /home/runner/workspace)
function getAiPhotosDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Fetch an image from a URL or file path → Buffer
async function fetchBuffer(urlOrPath: string): Promise<Buffer> {
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
]);

export async function stageComposite(ctx: PipelineContext): Promise<void> {
  const backgroundUrl = ctx.pack?.backgroundUrl ?? process.env["AI_STUDIO_BACKGROUND"] ?? null;

  // Hard gate: compositing is disabled until the official studio background has been
  // uploaded and stored in the studio pack. Do not silently fall through — record
  // the disabled reason on every image so the UI can surface it.
  if (!backgroundUrl) {
    ctx.log.warn(
      { jobId: ctx.job.id, dealerId: ctx.job.dealerId },
      "photo:composite DISABLED — no studio background configured. Upload the Alpha Motorsport background to enable compositing.",
    );
    for (const img of ctx.images) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      img.usedFallback = 1;
    }
    return;
  }

  // Load background once — reused for all images in this job
  let backgroundBuffer: Buffer;
  try {
    backgroundBuffer = await fetchBuffer(backgroundUrl);
  } catch (err) {
    ctx.log.warn({ err, backgroundUrl }, "photo:composite failed to load background — skipping");
    for (const img of ctx.images) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
    }
    return;
  }

  const bgMeta = await sharp(backgroundBuffer).metadata();
  const bgWidth = bgMeta.width ?? 1280;
  const bgHeight = bgMeta.height ?? 720;

  const uploadDir = getAiPhotosDir();
  const backgroundVersion = ctx.pack?.backgroundVersion ?? "v1";

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    // Only composite exterior shots with removed backgrounds
    if (!EXTERIOR_CLASSIFICATIONS.has(img.classification ?? "") || img.usedFallback === 1) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      continue;
    }

    const vehicleSrc = img.backgroundRemovedUrl ?? img.originalUrl;

    try {
      const vehicleBuffer = await fetchBuffer(vehicleSrc);
      const vehicleMeta = await sharp(vehicleBuffer).metadata();
      const vw = vehicleMeta.width ?? 800;
      const vh = vehicleMeta.height ?? 600;

      // Scale vehicle to fill ~85% of background width while preserving aspect ratio
      const scale = ctx.pack?.vehicleScale ?? 1.0;
      const targetW = Math.round(bgWidth * 0.85 * scale);
      const targetH = Math.round((vh / vw) * targetW);

      // Resize vehicle
      const vehicleResized = await sharp(vehicleBuffer)
        .resize(targetW, targetH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      // Center horizontally; place wheels near bottom of background
      const offsetX = ctx.pack?.vehicleOffsetX ?? 0;
      const offsetY = ctx.pack?.vehicleOffsetY ?? 0;
      const left = Math.round((bgWidth - targetW) / 2 + offsetX * bgWidth);
      const top = Math.round(bgHeight - targetH - bgHeight * 0.05 + offsetY * bgHeight);

      // Composite: background → vehicle (OVER)
      const composited = await sharp(backgroundBuffer)
        .composite([{ input: vehicleResized, left: Math.max(0, left), top: Math.max(0, top) }])
        .jpeg({ quality: 92 })
        .toBuffer();

      const filename = `${ctx.job.vehicleId}-${img.originalUrl.slice(-8).replace(/\W/g, "")}-${backgroundVersion}-${Date.now()}.jpg`;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, composited);

      img.compositedUrl = `/api/static/ai-photos/${filename}`;
      img.backgroundVersion = backgroundVersion;

      ctx.log.debug(
        { vehicleId: ctx.job.vehicleId, filename, bgW: bgWidth, bgH: bgHeight },
        "photo:composite",
      );
    } catch (err) {
      // Non-fatal: use background-removed (or original) as fallback
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      img.usedFallback = 1;
      ctx.log.warn({ err, url: img.originalUrl }, "photo:composite failed — using bg-removed");
    }
  }
}
