// Photo Worker — enqueues AI Photo Studio jobs for vehicles that need them,
// respecting a max-vehicles-per-run cap and a daily spend guardrail.
import { autoEnqueueAfterImport } from "../photo/autoEnqueue";
import { checkPhotoBudget, getPhotoMaxVehiclesPerRun } from "./costGuardrail";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEALER_ID = 1;

async function run({ log }: { log: import("pino").Logger }): Promise<WorkerRunOutcome> {
  const maxPerRun = getPhotoMaxVehiclesPerRun();
  const budget = await checkPhotoBudget(maxPerRun);

  if (budget.budgetExhausted) {
    return {
      summary: `Photo worker paused — daily FAL budget exhausted ($${budget.estimatedSpentTodayUsd.toFixed(2)} / $${budget.dailyBudgetUsd})`,
      detail: { ...budget },
      skipped: true,
    };
  }

  const { enqueued, skipped } = await autoEnqueueAfterImport(DEALER_ID, log, {
    maxCount: budget.allowedCount,
  });

  if (enqueued === 0) {
    return { summary: "No new vehicles needed AI photos this run", skipped: true, detail: { skipped } };
  }

  return {
    summary: `AI photos queued for ${enqueued} new vehicle${enqueued === 1 ? "" : "s"}`,
    detail: { enqueued, skipped, estimatedSpentTodayUsd: budget.estimatedSpentTodayUsd },
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
