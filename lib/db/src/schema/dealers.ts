import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dealersTable = pgTable("dealers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  xmlFeedUrl: text("xml_feed_url"),
  status: text("status").notNull().default("Active"),
  notes: text("notes"),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  country: text("country").default("US"),
  postalCode: text("postal_code"),
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
