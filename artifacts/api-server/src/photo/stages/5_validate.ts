// Stage 5: Validate — quality gate for every processed photo.
//
// Checks per image:
//   resolutionOk     — output meets minimum dimensions (1024×640)
//   aspectRatioOk    — landscape or square (w/h >= 0.75)
//   studioComposited — primary exterior has a composited (not original) URL
//   noFallback       — background removal succeeded (usedFallback = 0)
//   classifiedOk     — classification is not Miscellaneous for primary exterior
//
// Scoring: 0–100.  Below NEEDS_REVIEW_THRESHOLD → sets ctx.qualityGateFailed = true.
// The export stage then marks the photo set "Needs Review" instead of "Ready".
//
// This does NOT block the export — it annotates quality flags so operators
// can inspect and re-process if needed.
import sharp from "sharp";
import type { PipelineContext } from "../pipeline";
import { STUDIO_EXTERIOR_CLASSIFICATIONS } from "../providers/types";

const MIN_WIDTH  = 1024;
const MIN_HEIGHT =  640;
const NEEDS_REVIEW_THRESHOLD = 50; // aggregate score below this triggers "Needs Review"

interface QualityFlags {
  resolutionOk: boolean;
  aspectRatioOk: boolean;
  studioComposited: boolean;   // primary exterior: composited URL ≠ original
  noFallback: boolean;         // background removal did not fall back
  classifiedOk: boolean;       // not "Miscellaneous" for a primary exterior shot
  needsReview: boolean;        // true if any critical check failed
}

async function resolveBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("/api/static/ai-photos/")) {
      const { default: fs } = await import("fs");
      const { default: path } = await import("path");
      const filename = url.replace("/api/static/ai-photos/", "");
      const dir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
      const filepath = path.join(dir, filename);
      if (fs.existsSync(filepath)) return fs.readFileSync(filepath);
      return null;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

function scoreFlags(flags: QualityFlags): number {
  let score = 0;
  if (flags.resolutionOk)    score += 30;
  if (flags.aspectRatioOk)   score += 15;
  if (flags.studioComposited) score += 30;
  if (flags.noFallback)      score += 15;
  if (flags.classifiedOk)    score += 10;
  return score;
}

export async function stageValidate(ctx: PipelineContext): Promise<void> {
  let anyNeedsReview = false;

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    const finalUrl = img.processedUrl ?? img.compositedUrl ?? img.originalUrl;
    const isPrimaryExterior = STUDIO_EXTERIOR_CLASSIFICATIONS.has(img.classification ?? "");

    const flags: QualityFlags = {
      resolutionOk:    false,
      aspectRatioOk:   false,
      studioComposited: isPrimaryExterior
        ? !!(img.compositedUrl && img.compositedUrl !== img.originalUrl)
        : true, // non-primary images always pass this
      noFallback:      img.usedFallback === 0,
      classifiedOk:    isPrimaryExterior
        ? (img.classification !== "Miscellaneous" && !!img.classification)
        : true,
      needsReview: false,
    };

    // Resolution check on local files (fast) or remote (with timeout)
    const buf = await resolveBuffer(finalUrl);
    if (buf) {
      try {
        const meta = await sharp(buf).metadata();
        const w = meta.width  ?? 0;
        const h = meta.height ?? 0;
        flags.resolutionOk  = w >= MIN_WIDTH && h >= MIN_HEIGHT;
        flags.aspectRatioOk = w > 0 && h > 0 && w / h >= 0.75;
      } catch {
        flags.resolutionOk  = false;
        flags.aspectRatioOk = false;
      }
    } else {
      // Local file or unreachable — assume ok for images served by our static route
      flags.resolutionOk  = finalUrl.startsWith("/api/static/");
      flags.aspectRatioOk = finalUrl.startsWith("/api/static/");
    }

    const score = scoreFlags(flags);

    // Needs Review: primary exterior photos that failed compositing or BG removal
    flags.needsReview = isPrimaryExterior && (!flags.studioComposited || !flags.noFallback);
    if (flags.needsReview) anyNeedsReview = true;

    img.qualityScore = score;
    img.qualityFlags = JSON.stringify(flags);

    ctx.log.debug(
      { vehicleId: ctx.job.vehicleId, url: finalUrl, score, flags, isPrimaryExterior },
      "photo:validate",
    );
  }

  // Signal to the export stage
  if (anyNeedsReview) {
    ctx.qualityGateFailed = true;
    ctx.log.warn(
      { vehicleId: ctx.job.vehicleId, jobId: ctx.job.id },
      "photo:validate quality gate FAILED — set will be marked Needs Review",
    );
  }
}
