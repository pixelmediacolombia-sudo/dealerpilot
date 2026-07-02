// Stage 1: Classify — assigns each photo a category using GPT-5-mini vision.
// Graceful: if classification fails for one image, defaults to "Miscellaneous".
import type { PipelineContext } from "../pipeline";
import { getClassificationProvider } from "../providers";

export async function stageClassify(ctx: PipelineContext): Promise<void> {
  const provider = getClassificationProvider();

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    try {
      const result = await provider.classify(img.originalUrl);
      img.classification = result.label;
      img.isExterior = result.isExterior ? 1 : 0;
      img.classificationProvider = result.provider;
      img.classificationModel = result.model;
      img.classificationConfidence = result.confidence;

      ctx.log.debug(
        { url: img.originalUrl, label: result.label, confidence: result.confidence },
        "photo:classify",
      );
    } catch (err) {
      // Non-fatal: default to Miscellaneous
      ctx.log.warn({ err, url: img.originalUrl }, "photo:classify failed — using Miscellaneous");
      img.classification = "Miscellaneous";
      img.isExterior = 0;
      img.classificationProvider = provider.name;
      img.classificationModel = provider.model;
      img.classificationConfidence = 0;
    }
  }
}
