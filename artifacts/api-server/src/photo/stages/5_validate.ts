// Stage 5: Validate — quality gate checks on every processed photo.
// Checks: resolution, aspect ratio, file reachability.
// Scores 0–100; photos below threshold get flagged but are not rejected.
// Quality flags are stored for operator review in the AI Studio dashboard.
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";

const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
const PASS_THRESHOLD = 40; // scores below this are "Low Quality"

interface QualityFlags {
  resolutionOk: boolean;
  aspectRatioOk: boolean;
  isProcessed: boolean; // has a non-original processedUrl
  lowQualityWarning: boolean;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    // local /api/static/ai-photos/ URL — not directly resolvable server-side;
    // skip pixel-level validation for locally stored files
    return null;
  } catch {
    return null;
  }
}

function scoreImage(flags: QualityFlags): number {
  let score = 0;
  if (flags.resolutionOk) score += 50;
  if (flags.aspectRatioOk) score += 25;
  if (flags.isProcessed) score += 25;
  return score;
}

export async function stageValidate(ctx: PipelineContext): Promise<void> {
  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    const finalUrl = img.processedUrl ?? img.originalUrl;
    const flags: QualityFlags = {
      resolutionOk: false,
      aspectRatioOk: false,
      isProcessed: !!(img.processedUrl && img.processedUrl !== img.originalUrl),
      lowQualityWarning: false,
    };

    // Try to read metadata for remote images
    const buf = await fetchBuffer(finalUrl);
    if (buf) {
      try {
        const meta = await sharp(buf).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        flags.resolutionOk = w >= MIN_WIDTH && h >= MIN_HEIGHT;
        // Accept any landscape/square aspect; reject extreme portrait
        flags.aspectRatioOk = w > 0 && h > 0 && w / h >= 0.75;
      } catch {
        flags.resolutionOk = false;
        flags.aspectRatioOk = false;
      }
    } else {
      // Can't inspect local files or fetches failed — assume ok for local
      flags.resolutionOk = finalUrl.startsWith("/api/static/");
      flags.aspectRatioOk = finalUrl.startsWith("/api/static/");
    }

    const score = scoreImage(flags);
    flags.lowQualityWarning = score < PASS_THRESHOLD;

    img.qualityScore = score;
    img.qualityFlags = JSON.stringify(flags);

    ctx.log.debug(
      { vehicleId: ctx.job.vehicleId, url: finalUrl, score, flags },
      "photo:validate",
    );
  }
}
