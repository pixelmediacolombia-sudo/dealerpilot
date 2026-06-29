import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-dealer brand identity used by the Creative Intelligence Engine to compose
// on-brand Marketplace creatives. One row per dealer (enforced by a unique
// index). Colors are stored as ordered hex arrays so a palette can grow without
// a schema change.
export const dealerBrandDnaTable = pgTable(
  "dealer_brand_dna",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    primaryColors: jsonb("primary_colors").$type<string[]>().notNull().default([]),
    secondaryColors: jsonb("secondary_colors").$type<string[]>().notNull().default([]),
    accentColors: jsonb("accent_colors").$type<string[]>().notNull().default([]),
    logoUrl: text("logo_url"),
    preferredFont: text("preferred_font").notNull().default("Inter"),
    brandStyle: text("brand_style").notNull().default("Sport"),
    backgroundStyle: text("background_style").notNull().default("Dark Studio"),
    defaultTemplateKey: text("default_template_key").notNull().default("marketplace-premium"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("dealer_brand_dna_dealer_idx").on(table.dealerId)],
);

export const insertDealerBrandDnaSchema = createInsertSchema(dealerBrandDnaTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDealerBrandDna = z.infer<typeof insertDealerBrandDnaSchema>;
export type DealerBrandDna = typeof dealerBrandDnaTable.$inferSelect;
