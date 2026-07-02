// Stage 2: Remove Background — strips the background from exterior photos using
// fal.ai BRIA RMBG 2.0. Interior/non-vehicle photos are skipped (no BG removal needed).
// If FAL_KEY is not configured, this stage sets usedFallback=1 and continues.
// If removal fails for one image, uses original URL and marks usedFallback=1.
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
      img.backgroundRemovedUrl = img.originalUrl; // use original as pass-through
    }
    return;
  }

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;
    if (!REMOVE_BG_CLASSIFICATIONS.has(img.classification ?? "")) {
      // Interior / miscellaneous: pass through
      img.backgroundRemovedUrl = img.originalUrl;
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
