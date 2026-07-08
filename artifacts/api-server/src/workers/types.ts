import type { Logger } from "pino";

export interface WorkerRunContext {
  log: Logger;
  trigger: "auto" | "manual";
}

export interface WorkerRunOutcome {
  /** Short human-readable summary shown in worker_state.lastResultJson and the dashboard panel. */
  summary: string;
  /** Arbitrary structured detail persisted alongside the summary. */
  detail?: Record<string, unknown>;
  /** Set when the worker deliberately did nothing (e.g. guardrail, offline dependency). */
  skipped?: boolean;
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
