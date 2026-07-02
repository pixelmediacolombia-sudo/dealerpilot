// Stage 6: Order — assigns canonical positions to photos based on classification.
// Exterior hero shots come first; interior and miscellaneous last.
// Within the same classification, original order (feed order) is preserved.
import type { PipelineContext } from "../pipeline";
import { CLASSIFICATION_PRIORITY, type PhotoClassification } from "../providers/types";

export function stageOrder(ctx: PipelineContext): void {
  // Sort by classification priority, then by original index (stable)
  ctx.images.sort((a, b) => {
    const pa = CLASSIFICATION_PRIORITY[a.classification as PhotoClassification] ?? 99;
    const pb = CLASSIFICATION_PRIORITY[b.classification as PhotoClassification] ?? 99;
    if (pa !== pb) return pa - pb;
    // Preserve original feed order within same classification
    return ctx.images.indexOf(a) - ctx.images.indexOf(b);
  });

  // Assign sequential positions
  ctx.images.forEach((img, i) => {
    img.position = i;
  });

  ctx.log.debug(
    {
      vehicleId: ctx.job.vehicleId,
      order: ctx.images.map((img) => `${img.position}:${img.classification}`),
    },
    "photo:order",
  );
}
