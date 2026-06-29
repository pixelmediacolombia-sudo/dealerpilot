import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";
import { vehiclesTable } from "./vehicles";
import { listingsTable } from "./listings";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  dealerId: integer("dealer_id")
    .notNull()
    .references(() => dealersTable.id),
  externalThreadRef: text("external_thread_ref").notNull().unique(),
  buyerName: text("buyer_name"),
  language: text("language").notNull().default("en"),
  sourceUrl: text("source_url"),
  detectedListingUrl: text("detected_listing_url"),
  detectedVehicleTitle: text("detected_vehicle_title"),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  listingId: integer("listing_id").references(() => listingsTable.id),
  marketplaceDownPayment: integer("marketplace_down_payment"),
  marketplaceAskingPrice: integer("marketplace_asking_price"),
  vehicleType: text("vehicle_type"),
  status: text("status").notNull().default("active"),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertConversationSchema = createInsertSchema(
  conversationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
