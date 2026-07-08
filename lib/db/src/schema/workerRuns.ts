import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per execution of a worker (manual or scheduled).
// status: Running | Success | Failed | Skipped
export const workerRunsTable = pgTable(
  "worker_runs",
  {
    id: serial("id").primaryKey(),
    workerId: text("worker_id").notNull(),
    status: text("status").notNull().default("Running"),
    trigger: text("trigger").notNull().default("auto"), // auto | manual
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    resultJson: text("result_json"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("worker_runs_worker_idx").on(table.workerId),
    index("worker_runs_started_idx").on(table.startedAt),
  ],
);

export const insertWorkerRunSchema = createInsertSchema(workerRunsTable).omit({
  id: true,
});
export type InsertWorkerRun = z.infer<typeof insertWorkerRunSchema>;
export type WorkerRun = typeof workerRunsTable.$inferSelect;
