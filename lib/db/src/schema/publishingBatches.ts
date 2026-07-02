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

// Statuses: Scheduled | Preparing | Active | Paused | Completed | Failed | Cancelled
export const publishingBatchesTable = pgTable(
  "publishing_batches",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    batchNumber: integer("batch_number").notNull().default(1),
    status: text("status").notNull().default("Scheduled"),
    mode: text("mode").notNull().default("Assisted"),
    totalVehicles: integer("total_vehicles").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    needsReviewCount: integer("needs_review_count").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lotLocation: text("lot_location"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("publishing_batches_dealer_idx").on(table.dealerId)],
);

export const insertPublishingBatchSchema = createInsertSchema(publishingBatchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPublishingBatch = z.infer<typeof insertPublishingBatchSchema>;
export type PublishingBatch = typeof publishingBatchesTable.$inferSelect;
