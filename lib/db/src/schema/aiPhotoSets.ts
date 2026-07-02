import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Versioned AI Photo Set for a vehicle. Each processing run creates a new version.
// Publishing uses the latest "Ready" set. Old versions are preserved for audit.
// status: Processing | Ready | Failed | Superseded
export const aiPhotoSetsTable = pgTable("ai_photo_sets", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull(),
  dealerId: integer("dealer_id").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("Processing"),
  imageHash: text("image_hash"),
  studioPackId: integer("studio_pack_id"),
  modelVersion: text("model_version"),
  presetVersion: text("preset_version"),
  totalPhotos: integer("total_photos").notNull().default(0),
  processedPhotos: integer("processed_photos").notNull().default(0),
  failedPhotos: integer("failed_photos").notNull().default(0),
  isLatest: boolean("is_latest").notNull().default(false),
  processingTimeMs: integer("processing_time_ms"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAiPhotoSetSchema = createInsertSchema(aiPhotoSetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPhotoSet = z.infer<typeof insertAiPhotoSetSchema>;
export type AiPhotoSet = typeof aiPhotoSetsTable.$inferSelect;
