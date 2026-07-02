// Stage 2: Remove Background — strips the background from exterior photos using
// fal.ai BRIA RMBG 2.0. Interior/non-vehicle photos are skipped (no BG removal needed).
// If FAL_KEY is not configured, this stage sets usedFallback=1 and continues.
// If removal fails for one image, uses original URL and marks usedFallback=1.
// Skip: if backgroundRemovedUrl is already pre-loaded from a previous AI photo set
//       (background-version reprocess mode — avoids redundant Fal.ai calls).
import type { PipelineContext } from "../pipeline";
import { getBackgroundRemovalProvider } from "../providers";

// Only remove backgrounds from these exterior-focused categories
const REMOVE_BG_CLASSIFICATIONS = new Set([
  "Exterior Front",
  "Exterior Front 45",
  "Exterior Side",
  "Exterior Rear 45",
  "Exterior Rear",
]);

export async function stageRemoveBackground(ctx: PipelineContext): Promise<void> {
  const provider = getBackgroundRemovalProvider();

  if (!provider) {
    ctx.log.warn(
      "FAL_KEY not set — background removal skipped. Set FAL_KEY to enable BRIA RMBG.",
    );
    for (const img of ctx.images) {
      // Preserve pre-loaded bg-removed URL if already set (reprocess mode)
      if (!img.backgroundRemovedUrl) {
        img.backgroundRemovedUrl = img.originalUrl;
      }
    }
    return;
  }

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;
    if (!REMOVE_BG_CLASSIFICATIONS.has(img.classification ?? "")) {
      // Interior / miscellaneous: pass through (preserve pre-loaded if present)
      if (!img.backgroundRemovedUrl) {
        img.backgroundRemovedUrl = img.originalUrl;
      }
      continue;
    }

    // Skip if a real bg-removed URL was pre-loaded from a prior set (reprocess mode).
    // A "real" bg-removed URL is one that differs from the original (i.e. was actually processed).
    if (img.backgroundRemovedUrl && img.backgroundRemovedUrl !== img.originalUrl) {
      ctx.log.debug(
        { url: img.originalUrl, bgUrl: img.backgroundRemovedUrl },
        "photo:remove-bg skipped (pre-loaded from source set)",
      );
      continue;
    }

    const t0 = Date.now();
    try {
      const result = await provider.removeBackground(img.originalUrl);
      img.backgroundRemovedUrl = result.url;
      img.removalProvider = result.provider;
      img.removalModel = result.model;
      img.removalTimeMs = result.timeMs;

      ctx.log.debug(
        { url: img.originalUrl, bgRemovedUrl: result.url, ms: result.timeMs },
        "photo:remove-bg",
      );
    } catch (err) {
      // Non-fatal: use original, mark fallback
      img.backgroundRemovedUrl = img.originalUrl;
      img.usedFallback = 1;
      img.removalProvider = provider.name;
      img.removalModel = provider.model;
      img.removalTimeMs = Date.now() - t0;
      ctx.log.warn({ err, url: img.originalUrl }, "photo:remove-bg failed — using original");
    }
  }
}
