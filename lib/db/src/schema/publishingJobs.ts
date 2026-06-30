import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A unit of publishing work handed to the Chrome extension. Created when an
// approved listing version is queued. The extension claims a job, then reports
// completion or failure. The extension never auto-publishes without a job.
export const publishingJobsTable = pgTable(
  "publishing_jobs",
  {
    id: serial("id").primaryKey(),
    listingVersionId: integer("listing_version_id"),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    batchId: integer("batch_id"),
    // Assisted: operator clicks Publish manually. Controlled: extension may auto-click.
    mode: text("mode").notNull().default("Assisted"),
    status: text("status").notNull().default("Queued"),
    priority: integer("priority").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    claimedByExtension: text("claimed_by_extension"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedReason: text("failed_reason"),
    attempts: integer("attempts").notNull().default(0),
    listingUrl: text("listing_url"),
    assignedExtensionId: text("assigned_extension_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("publishing_jobs_status_idx").on(table.status)],
);

export const insertPublishingJobSchema = createInsertSchema(publishingJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPublishingJob = z.infer<typeof insertPublishingJobSchema>;
export type PublishingJob = typeof publishingJobsTable.$inferSelect;
