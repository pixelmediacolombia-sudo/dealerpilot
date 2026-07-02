import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Studio Background Pack — visual environment for AI photo compositing.
// Each dealer can have multiple packs; one is marked isDefault.
export const aiStudioPacksTable = pgTable("ai_studio_packs", {
  id: serial("id").primaryKey(),
  dealerId: integer("dealer_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // Background image path or HTTPS URL. null = not yet configured.
  // Set via AI_STUDIO_BACKGROUND env var on startup, or uploaded via API.
  backgroundUrl: text("background_url"),
  // Increment whenever background is replaced — triggers AI re-processing.
  backgroundVersion: text("background_version").notNull().default("v1"),
  // Logo safe zone bounding box (0–1 relative coords): JSON {x,y,w,h}
  // Vehicles are positioned so they never overlap this area.
  logoSafeZoneJson: text("logo_safe_zone_json"),
  // Vehicle placement fine-tuning (0 = auto)
  vehicleOffsetX: real("vehicle_offset_x").notNull().default(0),
  vehicleOffsetY: real("vehicle_offset_y").notNull().default(0),
  vehicleScale: real("vehicle_scale").notNull().default(1.0),
  // studio_white | outdoor_cloudy | sunset | showroom | none
  lightingPreset: text("lighting_preset").notNull().default("studio_white"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAiStudioPackSchema = createInsertSchema(aiStudioPacksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiStudioPack = z.infer<typeof insertAiStudioPackSchema>;
export type AiStudioPack = typeof aiStudioPacksTable.$inferSelect;
