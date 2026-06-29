import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A single rendered Marketplace output (one size/placement) belonging to a
// creative version. `url` is a placeholder today; a future image provider fills
// it with a generated asset without any schema change.
export interface CreativeOutput {
  format: string;
  label: string;
  width: number;
  height: number;
  url: string;
}

// The deterministic composition recipe for a creative. The pipeline produces it
// from the vehicle + dealer Brand DNA + template; the UI renders a faithful
// preview from it. Pluggable: a real image provider can consume the same recipe.
export interface CreativeRenderSpec {
  template: string;
  brandStyle: string;
  backgroundStyle: string;
  colors: { primary: string; secondary: string; accent: string };
  font: string;
  dealerName: string;
  logoUrl: string | null;
  vehicleImageUrl: string | null;
  headline: string;
  subline: string;
  price: string;
  cta: string;
  steps: string[];
}

// A generated creative for a vehicle. Versions are never overwritten: each
// generation appends a new row with an incremented `version`. At most one
// version per vehicle is the default (used as the Marketplace cover).
export const creativeVersionsTable = pgTable(
  "creative_versions",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    version: integer("version").notNull(),
    templateKey: text("template_key").notNull(),
    brandStyle: text("brand_style").notNull(),
    backgroundStyle: text("background_style").notNull(),
    status: text("status").notNull().default("Generated"),
    isDefault: boolean("is_default").notNull().default(false),
    renderSpec: jsonb("render_spec").$type<CreativeRenderSpec>().notNull(),
    outputs: jsonb("outputs").$type<CreativeOutput[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("creative_versions_vehicle_idx").on(table.vehicleId),
    uniqueIndex("creative_versions_vehicle_version_unique").on(table.vehicleId, table.version),
  ],
);

export const insertCreativeVersionSchema = createInsertSchema(creativeVersionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeVersion = z.infer<typeof insertCreativeVersionSchema>;
export type CreativeVersion = typeof creativeVersionsTable.$inferSelect;
