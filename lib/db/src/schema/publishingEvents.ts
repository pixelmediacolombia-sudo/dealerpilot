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

// Progress events sent by the Chrome extension during a publishing job.
// Events: job_claimed | marketplace_opened | photos_loading | photos_uploaded |
//         fields_filled | validation_passed | waiting_operator |
//         auto_publish_clicked | published | failed | skipped | safety_halt
export const publishingEventsTable = pgTable(
  "publishing_events",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    batchId: integer("batch_id"),
    event: text("event").notNull(),
    details: text("details"),
    extensionId: text("extension_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("publishing_events_job_idx").on(table.jobId),
    index("publishing_events_batch_idx").on(table.batchId),
  ],
);

export const insertPublishingEventSchema = createInsertSchema(publishingEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPublishingEvent = z.infer<typeof insertPublishingEventSchema>;
export type PublishingEvent = typeof publishingEventsTable.$inferSelect;
