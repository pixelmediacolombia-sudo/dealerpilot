import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Placeholder table for a future sprint (Marketplace Publisher). Not used yet.
export const listingsTable = pgTable("listings", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull(),
  channel: text("channel").notNull().default("marketplace"),
  status: text("status").notNull().default("Draft"),
  externalId: text("external_id"),
  externalUrl: text("external_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertListingSchema = createInsertSchema(listingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listingsTable.$inferSelect;
