// Photo Worker — enqueues AI Photo Studio jobs for vehicles that need them,
// respecting a max-vehicles-per-run cap and two independent, hard-stop daily
// spend guardrails: FAL (background removal + AI Studio composite) and
// OpenAI (per-image classification). Both are backed by REAL usage counters
// (ai_usage_events), not estimates — see costGuardrail.ts.
//
// Before enqueuing ANY new job this worker estimates its cost and checks it
// against the remaining daily budget; if either budget can't cover even one
// more job, no jobs are enqueued this cycle, "... daily budget reached" is
// logged, and the worker tries again next cycle (both budgets reset
// automatically at midnight, so a paused worker resumes with no manual step).
import { autoEnqueueAfterImport } from "../photo/autoEnqueue";
import {
  checkFalBudget,
  checkOpenAiBudget,
  getPhotoMaxVehiclesPerRun,
  ESTIMATED_COST_PER_PHOTO_JOB_USD,
} from "./costGuardrail";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEALER_ID = 1;

async function run({ log }: { log: import("pino").Logger }): Promise<WorkerRunOutcome> {
  const openAiBudget = await checkOpenAiBudget();
  if (openAiBudget.budgetExhausted) {
    log.warn(
      { estimatedSpentTodayUsd: openAiBudget.estimatedSpentTodayUsd, dailyBudgetUsd: openAiBudget.dailyBudgetUsd },
      "OpenAI daily budget reached",
    );
    return {
      summary: `Photo worker paused — daily OpenAI budget exhausted ($${openAiBudget.estimatedSpentTodayUsd.toFixed(2)} / $${openAiBudget.dailyBudgetUsd})`,
      detail: { ...openAiBudget },
      skipped: true,
      pauseReason: "budget",
    };
  }

  // Estimate the cost of enqueuing a single new vehicle job — if even one
  // job can't be afforded, skip the whole cycle without enqueuing anything.
  const falBudget = await checkFalBudget(ESTIMATED_COST_PER_PHOTO_JOB_USD);
  if (falBudget.budgetExhausted) {
    log.warn(
      { estimatedSpentTodayUsd: falBudget.estimatedSpentTodayUsd, dailyBudgetUsd: falBudget.dailyBudgetUsd },
      "FAL daily budget reached",
    );
    return {
      summary: `Photo worker paused — daily FAL budget exhausted ($${falBudget.estimatedSpentTodayUsd.toFixed(2)} / $${falBudget.dailyBudgetUsd})`,
      detail: { ...falBudget },
      skipped: true,
      pauseReason: "budget",
    };
  }

  // Cap how many NEW jobs we enqueue this run by both the configured max and
  // how many the remaining FAL budget could plausibly afford — actual spend
  // is still hard-stopped per real API call inside the pipeline stages.
  const configuredMax = getPhotoMaxVehiclesPerRun();
  const affordableCount = Math.floor(falBudget.remainingBudgetUsd / ESTIMATED_COST_PER_PHOTO_JOB_USD);
  const maxCount = Math.max(0, Math.min(configuredMax, affordableCount));

  const { enqueued, skipped } = await autoEnqueueAfterImport(DEALER_ID, log, { maxCount });

  if (enqueued === 0) {
    return {
      summary: "No new vehicles needed AI photos this run",
      skipped: true,
      detail: { skipped },
      pauseReason: "no-vehicles",
    };
  }

  return {
    summary: `AI photos queued for ${enqueued} new vehicle${enqueued === 1 ? "" : "s"}`,
    detail: { enqueued, skipped, estimatedSpentTodayUsd: falBudget.estimatedSpentTodayUsd },
  };
}

export const photoWorker: WorkerDefinition = {
  id: "photo",
  name: "Photo Agent",
  description: "Finds vehicles without AI photo sets, enqueues jobs within cost guardrails",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
