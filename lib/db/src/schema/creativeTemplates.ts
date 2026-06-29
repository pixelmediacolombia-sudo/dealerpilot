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

// A creative template catalog entry. Templates describe the layout/treatment a
// generated creative uses (Marketplace Standard, Premium, Luxury, body-style
// specific, etc.). Seeded on startup; the dealer picks a default in Brand DNA.
export const creativeTemplatesTable = pgTable("creative_templates", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  recommendedBrandStyle: text("recommended_brand_style"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCreativeTemplateSchema = createInsertSchema(creativeTemplatesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCreativeTemplate = z.infer<typeof insertCreativeTemplateSchema>;
export type CreativeTemplate = typeof creativeTemplatesTable.$inferSelect;
