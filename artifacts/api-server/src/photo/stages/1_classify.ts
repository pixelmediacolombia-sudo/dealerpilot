// Stage 1: Classify — assigns each photo a category using GPT-5-mini vision.
// Graceful: if classification fails for one image, defaults to "Miscellaneous".
// Skip: if classification is already pre-loaded from a previous AI photo set
//       (background-version reprocess mode — avoids redundant OpenAI calls).
// Budget: enforced PER IMAGE (not per vehicle/job) via checkOpenAiBudget() —
//       once WORKER_DAILY_OPENAI_BUDGET_USD is exhausted, remaining images in
//       this job (and any other job) stop calling OpenAI for the rest of the
//       day and fall back to "Miscellaneous" without ever hitting the API.
import type { PipelineContext } from "../pipeline";
import { getClassificationProvider } from "../providers";
import { checkOpenAiBudget, recordOpenAiClassification } from "../../workers/costGuardrail";

export async function stageClassify(ctx: PipelineContext): Promise<void> {
  const provider = getClassificationProvider();
  let budgetExhaustedThisStage = false;

  for (const img of ctx.images) {
    if (img.processingStatus === "Failed") continue;

    // Skip if classification was pre-loaded from a prior set (reprocess mode).
    if (img.classification) {
      ctx.log.debug(
        { url: img.originalUrl, label: img.classification },
        "photo:classify skipped (pre-loaded from source set)",
      );
      continue;
    }

    if (!budgetExhaustedThisStage) {
      const budget = await checkOpenAiBudget();
      if (budget.budgetExhausted) {
        budgetExhaustedThisStage = true;
        ctx.log.warn(
          { estimatedSpentTodayUsd: budget.estimatedSpentTodayUsd, dailyBudgetUsd: budget.dailyBudgetUsd },
          "OpenAI daily budget reached",
        );
      }
    }

    if (budgetExhaustedThisStage) {
      // Stop calling OpenAI for the rest of today — classify as Miscellaneous
      // without spending an API call, and never throw.
      img.classification = "Miscellaneous";
      img.isExterior = 0;
      img.classificationProvider = provider.name;
      img.classificationModel = provider.model;
      img.classificationConfidence = 0;
      continue;
    }

    try {
      const result = await provider.classify(img.originalUrl);
      await recordOpenAiClassification();
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
