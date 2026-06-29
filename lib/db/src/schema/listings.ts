import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A published/draft listing for a vehicle on a channel (e.g. Marketplace).
// Each vehicle has at most one listing per channel — enforced by a unique
// constraint so the publishing completion path can upsert atomically.
export const listingsTable = pgTable(
  "listings",
  {
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
  },
  (table) => [
    uniqueIndex("listings_vehicle_channel_idx").on(table.vehicleId, table.channel),
  ],
);

export const insertListingSchema = createInsertSchema(listingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listingsTable.$inferSelect;
