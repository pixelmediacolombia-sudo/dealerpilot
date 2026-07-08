import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Current status of each registered worker — one row per workerId, upserted
// after every run. Powers GET /api/workers/status and the dashboard panel.
// lastStatus: Success | Failed | Skipped
export const workerStateTable = pgTable("worker_state", {
  workerId: text("worker_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastDurationMs: integer("last_duration_ms"),
  lastResultJson: text("last_result_json"),
  lastErrorMessage: text("last_error_message"),
  // Set only when the worker deliberately paused itself (e.g. daily budget
  // exhausted, no eligible work). Cleared on the next run once the condition
  // no longer holds — this is what lets a paused worker resume automatically
  // (e.g. after the midnight budget reset) with no manual intervention.
  pauseReason: text("pause_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertWorkerStateSchema = createInsertSchema(workerStateTable);
export type InsertWorkerState = z.infer<typeof insertWorkerStateSchema>;
export type WorkerState = typeof workerStateTable.$inferSelect;
