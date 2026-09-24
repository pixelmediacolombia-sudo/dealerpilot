// Inventory Worker — XML feed sync, delta detection, location scraping.
// Wraps the existing runSyncNow() pipeline (feed fetch → import → opportunity
// refresh → photo auto-enqueue). Scheduling itself (24h + startup catch-up) is
// handled by the generic scheduler in index.ts.
import { runLuckiSyncNow, runSyncNow } from "../inventory/scheduler";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function run({ log, trigger }: { log: import("pino").Logger; trigger: "auto" | "manual" }): Promise<WorkerRunOutcome> {
  const syncTrigger = trigger === "manual" ? "manual" : "auto";
  const alphaSummary = await runSyncNow(log, syncTrigger);
  const luckiSummary = await runLuckiSyncNow(log, syncTrigger);
  const summaries = [alphaSummary, luckiSummary].filter((summary): summary is NonNullable<typeof summary> => summary !== null);

  if (summaries.length === 0) {
    return { summary: "Inventory sync skipped — no feed URL configured", skipped: true };
  }

  const total = summaries.reduce((acc, summary) => ({
    created: acc.created + summary.created,
    updated: acc.updated + summary.updated,
    removed: acc.removed + summary.removed,
    active: acc.active + summary.active,
    errors: acc.errors + summary.errors,
  }), { created: 0, updated: 0, removed: 0, active: 0, errors: 0 });
  const parts: string[] = [];
  if (total.created > 0) parts.push(`${total.created} new`);
  if (total.updated > 0) parts.push(`${total.updated} updated`);
  if (total.removed > 0) parts.push(`${total.removed} sold/removed`);
  const changeSummary = parts.length > 0 ? parts.join(", ") : "no changes";

  return {
    summary: `Inventory synced automatically for configured dealers — ${changeSummary} (${total.active} active)`,
    detail: {
      created: total.created,
      updated: total.updated,
      removed: total.removed,
      active: total.active,
      errors: total.errors,
      dealers: {
        alpha: alphaSummary,
        lucki: luckiSummary,
      },
    },
  };
}

export const inventoryWorker: WorkerDefinition = {
  id: "inventory",
  name: "Inventory Agent",
  description: "XML feed sync, delta detection, sold/removed detection, location scraping",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
