import {
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-image AI processing result within a photo set.
// Full provenance: provider, model, timing, quality, classification.
// processedUrl=null means the original was used as fallback.
export const aiPhotoImagesTable = pgTable("ai_photo_images", {
  id: serial("id").primaryKey(),
  setId: integer("set_id").notNull(),
  vehicleId: integer("vehicle_id").notNull(),
  originalUrl: text("original_url").notNull(),
  // Final URL used for publishing (null → use originalUrl)
  processedUrl: text("processed_url"),
  // Stage-level intermediate URLs for debugging
  backgroundRemovedUrl: text("background_removed_url"),
  compositedUrl: text("composited_url"),
  // Classification
  // Exterior Front | Exterior Front 45 | Exterior Side | Exterior Rear |
  // Exterior Rear 45 | Wheels | Engine | Interior Front | Interior Dashboard |
  // Interior Rear Seats | Trunk | Miscellaneous
  classification: text("classification"),
  isExterior: integer("is_exterior"), // 1=exterior 0=interior null=unknown
  position: integer("position").notNull().default(0),
  processingStatus: text("processing_status").notNull().default("Pending"),
  failedReason: text("failed_reason"),
  usedFallback: integer("used_fallback").notNull().default(0),
  // AI Provenance — never lose this
  classificationProvider: text("classification_provider"),
  classificationModel: text("classification_model"),
  classificationConfidence: real("classification_confidence"),
  removalProvider: text("removal_provider"),
  removalModel: text("removal_model"),
  removalTimeMs: integer("removal_time_ms"),
  backgroundVersion: text("background_version"),
  promptVersion: text("prompt_version"),
  totalProcessingTimeMs: integer("total_processing_time_ms"),
  // Quality gate
  qualityScore: real("quality_score"),
  // JSON: { vehicleDetected, noMirrorCut, noWheelCut, logoVisible, resolutionOk }
  qualityFlags: text("quality_flags"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiPhotoImageSchema = createInsertSchema(aiPhotoImagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiPhotoImage = z.infer<typeof insertAiPhotoImageSchema>;
export type AiPhotoImage = typeof aiPhotoImagesTable.$inferSelect;
