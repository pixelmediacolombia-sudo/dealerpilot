import { boolean, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type DealerMarketplaceKnowledgeLocale = {
  address?: string;
  phone?: string;
  hours?: string;
  title?: string;
  testDrive?: string;
  tradeIn?: string;
  payment?: string;
  financingRequirements?: string;
  citizenRequirements?: string;
  carfax?: string;
  warranty?: string;
};

export type DealerMarketplaceKnowledge = {
  es?: DealerMarketplaceKnowledgeLocale;
  en?: DealerMarketplaceKnowledgeLocale;
};

export const dealersTable = pgTable("dealers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  xmlFeedUrl: text("xml_feed_url"),
  plan: text("plan").notNull().default("complete"),
  status: text("status").notNull().default("Active"),
  notes: text("notes"),
  hasCleanTitleInventory: boolean("has_clean_title_inventory").notNull().default(false),
  marketplaceKnowledge: jsonb("marketplace_knowledge")
    .$type<DealerMarketplaceKnowledge>()
    .notNull()
    .default({}),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  country: text("country").default("US"),
  postalCode: text("postal_code"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertDealerSchema = createInsertSchema(dealersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDealer = z.infer<typeof insertDealerSchema>;
export type Dealer = typeof dealersTable.$inferSelect;
