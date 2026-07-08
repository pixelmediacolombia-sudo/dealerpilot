import { db, workerRunsTable, workerStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";
import { logTimelineEvent } from "./timeline";

const runningWorkers = new Set<string>();

async function upsertState(
  workerId: string,
  patch: Partial<typeof workerStateTable.$inferInsert>,
): Promise<void> {
  const existing = await db
    .select({ workerId: workerStateTable.workerId })
    .from(workerStateTable)
    .where(eq(workerStateTable.workerId, workerId));

  if (existing.length === 0) {
    await db.insert(workerStateTable).values({ workerId, enabled: true, ...patch });
  } else {
    await db.update(workerStateTable).set(patch).where(eq(workerStateTable.workerId, workerId));
  }
}

/**
 * Runs a worker exactly once: records a worker_runs row, upserts worker_state,
 * emits a system timeline event, and NEVER throws — worker errors are caught
 * and recorded as failed runs so a broken worker can never crash the process.
 */
export async function runWorkerOnce(
  worker: WorkerDefinition,
  log: Logger,
  trigger: "auto" | "manual",
  nextRunAt: Date | null,
): Promise<WorkerRunOutcome> {
  if (runningWorkers.has(worker.id)) {
    const outcome: WorkerRunOutcome = { summary: "Skipped — previous run still in progress", skipped: true };
    return outcome;
  }
  runningWorkers.add(worker.id);

  try {
    return await runWorkerOnceInner(worker, log, trigger, nextRunAt);
  } catch (err) {
    // Defense in depth: even a failure to write worker_runs/worker_state (e.g.
    // a transient DB hiccup) must never escape as an unhandled rejection —
    // that would crash the whole API process for the auto-scheduled path.
    log.error({ err, worker: worker.id }, "worker framework bookkeeping failed — swallowed, process continues");
    return { summary: `Failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    runningWorkers.delete(worker.id);
  }
}

async function runWorkerOnceInner(
  worker: WorkerDefinition,
  log: Logger,
  trigger: "auto" | "manual",
  nextRunAt: Date | null,
): Promise<WorkerRunOutcome> {
  const startedAt = new Date();
  const [runRow] = await db
    .insert(workerRunsTable)
    .values({ workerId: worker.id, status: "Running", trigger, startedAt })
    .returning({ id: workerRunsTable.id });

  const workerLog = log.child({ worker: worker.id });

  try {
    const outcome = await worker.run({ log: workerLog, trigger });
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const status = outcome.skipped ? "Skipped" : "Success";

    if (runRow) {
      await db
        .update(workerRunsTable)
        .set({
          status,
          completedAt,
          durationMs,
          resultJson: JSON.stringify({ summary: outcome.summary, detail: outcome.detail ?? {} }),
        })
        .where(eq(workerRunsTable.id, runRow.id));
    }

    await upsertState(worker.id, {
      lastRunAt: startedAt,
      nextRunAt,
      lastStatus: status,
      lastDurationMs: durationMs,
      lastResultJson: outcome.summary,
      lastErrorMessage: null,
      // Cleared whenever the worker doesn't report a pause this run — this is
      // what lets a paused worker resume automatically (e.g. after the
      // midnight budget reset) with no manual intervention.
      pauseReason: outcome.pauseReason ?? null,
    });

    workerLog.info({ status, durationMs, summary: outcome.summary }, "worker run complete");
    await logTimelineEvent(worker.id, outcome.summary, outcome.detail, workerLog, worker.id);

    return outcome;
  } catch (err) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (runRow) {
      await db
        .update(workerRunsTable)
        .set({ status: "Failed", completedAt, durationMs, errorMessage })
        .where(eq(workerRunsTable.id, runRow.id));
    }

    await upsertState(worker.id, {
      lastRunAt: startedAt,
      nextRunAt,
      lastStatus: "Failed",
      lastDurationMs: durationMs,
      lastErrorMessage: errorMessage,
    });

    workerLog.error({ err, durationMs }, "worker run failed — swallowed, process continues");
    await logTimelineEvent(
      worker.id,
      `${worker.name} failed: ${errorMessage}`,
      undefined,
      workerLog,
      worker.id,
    );

    return { summary: `Failed: ${errorMessage}` };
  }
}

/** Starts a repeating interval loop for a single worker (does not run immediately). */
export function scheduleWorker(worker: WorkerDefinition, log: Logger): void {
  const tick = () => {
    const nextRunAt = new Date(Date.now() + worker.intervalMs);
    void runWorkerOnce(worker, log, "auto", nextRunAt);
  };
  setInterval(tick, worker.intervalMs);
}
