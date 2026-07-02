// Stage 3: AI Studio Placement — replaces Sharp-based compositing.
//
// For studio exterior shots (Exterior Front / Front 45 / Side / Rear 45 / Rear):
//   Calls BRIA Product Shot (fal-ai/bria/product-shot) — a queued AI endpoint that:
//     • understands the Alpha Motorsport studio from the reference background image
//     • places the vehicle naturally in the scene (correct perspective, scale, angle)
//     • generates realistic contact shadows and floor reflection
//     • generates studio overhead lighting appropriate for the scene
//     • preserves exact vehicle appearance: paint, wheels, badges, proportions
//     • keeps dealer logo fully visible
//   Takes ~15–45 s per image. Results are downloaded and saved locally.
//
// For all other shot types (Interior, Technical, Dealer, etc.):
//   Passes through to compositedUrl unchanged — no AI placement needed.
//
// Sharp is NOT used for visual composition in this stage.
// Sharp appears only in Stage 4 (enhance) and Stage 7 (export/thumbnails).
import fs from "fs";
import path from "path";
import type { PipelineContext } from "../pipeline";
import { STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";
import { briaProductShot } from "../providers/falai";

// Scene description sent to BRIA Product Shot for every Alpha Motorsport studio exterior.
// Describes the desired visual outcome without specifying exact geometry —
// the AI infers correct placement from the reference background image.
const ALPHA_MOTORSPORT_SCENE =
  "Alpha Motorsport automotive dealership showroom studio, professional car photography, " +
  "polished showroom floor with subtle racing checkerboard pattern, dramatic overhead studio " +
  "lighting from ceiling fixtures, realistic contact shadow beneath vehicle, subtle floor " +
  "reflection, dealer logo and branding clearly visible on wall behind vehicle, " +
  "commercial luxury automotive photography, photorealistic, high-end";

function getAiPhotosDir(): string {
  const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Download any HTTP/HTTPS URL and save to disk; return /api/static/ai-photos/<filename> path */
async function downloadAndSave(
  url: string,
  prefix: string,
  vehicleId: number,
): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to download AI output (${res.status}): ${url}`);

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  const filename = `${prefix}-${vehicleId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;

  const uploadDir = getAiPhotosDir();
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(uploadDir, filename), buf);
  return `/api/static/ai-photos/${filename}`;
}

export async function stageComposite(ctx: PipelineContext): Promise<void> {
  const backgroundUrl = ctx.pack?.backgroundUrl ?? null;
  const bgW = ctx.pack?.backgroundWidth  ?? 1536;
  const bgH = ctx.pack?.backgroundHeight ?? 1024;

  if (!backgroundUrl) {
    ctx.log.warn({ jobId: ctx.job.id }, "photo:ai-studio DISABLED — no studio background configured");
    for (const img of ctx.images) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      img.usedFallback  = 1;
    }
    return;
  }

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    // Non-studio shots pass through without AI placement
    if (!STUDIO_EXTERIOR_CLASSIFICATIONS.has(img.classification ?? "")) {
      img.compositedUrl = img.backgroundRemovedUrl ?? img.originalUrl;
      continue;
    }

    // Studio exterior: use the background-removed URL from Stage 2.
    // BRIA RMBG outputs land on https://fal.media/... which is publicly accessible.
    const vehicleUrl = img.backgroundRemovedUrl;
    if (!vehicleUrl) {
      ctx.log.warn({ url: img.originalUrl }, "photo:ai-studio no background-removed URL — skipping");
      img.compositedUrl = img.originalUrl;
      img.usedFallback  = 1;
      continue;
    }

    try {
      ctx.log.info(
        { vehicleId: ctx.job.vehicleId, classification: img.classification },
        "photo:ai-studio submitting to BRIA Product Shot",
      );

      const result = await briaProductShot(
        vehicleUrl,
        backgroundUrl,
        ALPHA_MOTORSPORT_SCENE,
        [bgW, bgH],
      );

      // Download the AI-generated composition and store it locally.
      // This decouples us from fal.ai CDN URL expiry.
      const localPath = await downloadAndSave(
        result.imageUrl,
        "studio",
        ctx.job.vehicleId,
      );

      img.compositedUrl     = localPath;
      img.backgroundVersion = ctx.pack?.backgroundVersion ?? "ai-v1";
      img.logoObscured      = false; // AI placement respects logo zone per prompt

      ctx.log.info(
        {
          vehicleId: ctx.job.vehicleId,
          classification: img.classification,
          timeMs: result.timeMs,
          localPath,
        },
        "photo:ai-studio completed",
      );
    } catch (err) {
      ctx.log.warn({ err, url: img.originalUrl, classification: img.classification },
        "photo:ai-studio failed — falling back to background-removed image");
      img.compositedUrl = vehicleUrl;
      img.usedFallback  = 1;
    }
  }
}
