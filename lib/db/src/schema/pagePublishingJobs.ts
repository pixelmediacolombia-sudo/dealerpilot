import { integer, pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";

export const pagePublishingJobsTable = pgTable(
  "page_publishing_jobs",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull().references(() => dealersTable.id),
    status: text("status").notNull().default("Scheduled"),
    currentStep: text("current_step"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedReason: text("failed_reason"),
    attempts: integer("attempts").notNull().default(0),
    metaPostId: text("meta_post_id"),
    postUrl: text("post_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_publishing_jobs_status_idx").on(table.status),
    index("page_publishing_jobs_batch_idx").on(table.batchId),
    index("page_publishing_jobs_due_idx").on(table.dealerId, table.status, table.scheduledAt),
    uniqueIndex("page_publishing_jobs_batch_vehicle_idx").on(table.batchId, table.vehicleId),
  ],
);

export const insertPagePublishingJobSchema = createInsertSchema(pagePublishingJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPagePublishingJob = z.infer<typeof insertPagePublishingJobSchema>;
export type PagePublishingJob = typeof pagePublishingJobsTable.$inferSelect;
