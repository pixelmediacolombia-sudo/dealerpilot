import { integer, pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";

export const pagePublishingBatchesTable = pgTable(
  "page_publishing_batches",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull().references(() => dealersTable.id),
    batchNumber: integer("batch_number").notNull().default(1),
    status: text("status").notNull().default("Scheduled"),
    totalVehicles: integer("total_vehicles").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_publishing_batches_dealer_idx").on(table.dealerId),
    uniqueIndex("page_publishing_batches_dealer_number_idx").on(table.dealerId, table.batchNumber),
  ],
);

export const insertPagePublishingBatchSchema = createInsertSchema(pagePublishingBatchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPagePublishingBatch = z.infer<typeof insertPagePublishingBatchSchema>;
export type PagePublishingBatch = typeof pagePublishingBatchesTable.$inferSelect;
