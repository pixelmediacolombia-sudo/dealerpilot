import type { Logger } from "pino";

export interface WorkerRunContext {
  log: Logger;
  trigger: "auto" | "manual";
}

export type WorkerPauseReason = "budget" | "no-vehicles";

export interface WorkerRunOutcome {
  /** Short human-readable summary shown in worker_state.lastResultJson and the dashboard panel. */
  summary: string;
  /** Arbitrary structured detail persisted alongside the summary. */
  detail?: Record<string, unknown>;
  /** Set when the worker deliberately did nothing (e.g. guardrail, offline dependency). */
  skipped?: boolean;
  /**
   * Set only when `skipped` is a deliberate pause the dashboard should surface
   * distinctly (e.g. "Paused (Budget)"). Persisted on worker_state and cleared
   * automatically the next time the worker runs without pausing — this is
   * what makes resumption automatic (no manual intervention required).
   */
  pauseReason?: WorkerPauseReason;
}

export interface WorkerDefinition {
  id: string;
  name: string;
  description: string;
  intervalMs: number;
  enabled: boolean;
  run(ctx: WorkerRunContext): Promise<WorkerRunOutcome>;
}

export type WorkerStatusLabel = "Online" | "Sleeping" | "Failed";

export interface WorkerStatusSummary {
  id: string;
  name: string;
  description: string;
  intervalMs: number;
  enabled: boolean;
  status: WorkerStatusLabel;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: string | null;
  lastError: string | null;
}
