// Inventory Worker — XML feed sync, delta detection, location scraping.
// Wraps the existing runSyncNow() pipeline (feed fetch → import → opportunity
// refresh → photo auto-enqueue). Scheduling itself (24h + startup catch-up) is
// handled by the generic scheduler in index.ts.
import { runSyncNow } from "../inventory/scheduler";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function run({ log, trigger }: { log: import("pino").Logger; trigger: "auto" | "manual" }): Promise<WorkerRunOutcome> {
  const summary = await runSyncNow(log, trigger === "manual" ? "manual" : "auto");

  if (!summary) {
    return { summary: "Inventory sync skipped — no feed URL configured", skipped: true };
  }

  const parts: string[] = [];
  if (summary.created > 0) parts.push(`${summary.created} new`);
  if (summary.updated > 0) parts.push(`${summary.updated} updated`);
  if (summary.removed > 0) parts.push(`${summary.removed} sold/removed`);
  const changeSummary = parts.length > 0 ? parts.join(", ") : "no changes";

  return {
    summary: `Inventory synced automatically — ${changeSummary} (${summary.active} active)`,
    detail: {
      created: summary.created,
      updated: summary.updated,
      removed: summary.removed,
      active: summary.active,
      errors: summary.errors,
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
