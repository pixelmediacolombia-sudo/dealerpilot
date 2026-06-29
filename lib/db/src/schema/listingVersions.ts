import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A generated Marketplace listing for a vehicle. Versions are never overwritten:
// each generation appends a new row with an incremented `version`. The active
// version for a vehicle is flagged with `isCurrent`.
export const listingVersionsTable = pgTable(
  "listing_versions",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    descriptionEn: text("description_en"),
    descriptionEs: text("description_es"),
    language: text("language").notNull().default("en"),
    askingPrice: integer("asking_price"),
    downPayment: integer("down_payment"),
    callToAction: text("call_to_action"),
    buyerProfile: text("buyer_profile"),
    priority: text("priority"),
    status: text("status").notNull().default("AI Generated"),
    generatedBy: text("generated_by").notNull().default("ai"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("listing_versions_vehicle_idx").on(table.vehicleId)],
);

export const insertListingVersionSchema = createInsertSchema(listingVersionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertListingVersion = z.infer<typeof insertListingVersionSchema>;
export type ListingVersion = typeof listingVersionsTable.$inferSelect;
