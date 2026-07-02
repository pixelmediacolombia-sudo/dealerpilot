import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// AI Photo processing job queue — one job per vehicle per processing trigger.
// Mirrors the publishing job queue pattern: atomic claim, retry, monitoring.
// status: Queued | Processing | Completed | Failed | Cancelled
export const aiPhotoJobsTable = pgTable("ai_photo_jobs", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull(),
  dealerId: integer("dealer_id").notNull(),
  status: text("status").notNull().default("Queued"),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  // Hash that triggered this job (photo URLs + studio pack version + model version)
  imageHash: text("image_hash"),
  studioPackId: integer("studio_pack_id"),
  studioVersion: text("studio_version"),
  modelVersion: text("model_version").default("bria-rmbg-2.0"),
  presetVersion: text("preset_version").default("v1"),
  // Progress
  totalPhotos: integer("total_photos").notNull().default(0),
  processedPhotos: integer("processed_photos").notNull().default(0),
  failedPhotos: integer("failed_photos").notNull().default(0),
  currentStage: text("current_stage"),
  progressPercent: integer("progress_percent").notNull().default(0),
  outputSetId: integer("output_set_id"),
  sourceSetId: integer("source_set_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failedReason: text("failed_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAiPhotoJobSchema = createInsertSchema(aiPhotoJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPhotoJob = z.infer<typeof insertAiPhotoJobSchema>;
export type AiPhotoJob = typeof aiPhotoJobsTable.$inferSelect;
