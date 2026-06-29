import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A background creative-generation job. Enqueued as "Queued", picked up by the
// in-process creative worker which transitions it Queued -> Generating ->
// Completed/Failed while updating `step`/`progress`, then links the resulting
// creative version. Generation never blocks the request that enqueues it.
export const creativeJobsTable = pgTable(
  "creative_jobs",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    templateKey: text("template_key").notNull(),
    status: text("status").notNull().default("Queued"),
    step: text("step"),
    progress: integer("progress").notNull().default(0),
    creativeVersionId: integer("creative_version_id"),
    failedReason: text("failed_reason"),
    attempts: integer("attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("creative_jobs_status_idx").on(table.status)],
);

export const insertCreativeJobSchema = createInsertSchema(creativeJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeJob = z.infer<typeof insertCreativeJobSchema>;
export type CreativeJob = typeof creativeJobsTable.$inferSelect;
