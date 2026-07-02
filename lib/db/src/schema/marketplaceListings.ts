import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tracks every vehicle that has been successfully published to Facebook Marketplace.
// Populated (or updated) by the POST /publishing/jobs/:id/complete endpoint.
// Separate from the generic `listings` table so Sales AI can read marketplace-specific
// fields (message counts, lead quality, assigned BDC) without coupling to the publish
// workflow internals.
export const marketplaceListingsTable = pgTable("marketplace_listings", {
  id: serial("id").primaryKey(),
  // One Marketplace listing record per vehicle — enforced at app level, not DB constraint,
  // so we can upsert by vehicleId without needing composite unique here.
  vehicleId: integer("vehicle_id").notNull().unique(),
  dealerId: integer("dealer_id").notNull(),

  listingUrl: text("listing_url"),
  facebookListingId: text("facebook_listing_id"),

  publishedAt: timestamp("published_at", { withTimezone: true }),

  // Live | Needs Review | Sold | Failed
  status: text("status").notNull().default("Live"),

  // Message tracking — populated later when Messenger integration is connected.
  messagesReceived: integer("messages_received").notNull().default(0),
  unreadMessages: integer("unread_messages").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),

  assignedTo: text("assigned_to"),
  // Hot | Warm | Cold
  leadQuality: text("lead_quality"),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertMarketplaceListingSchema = createInsertSchema(marketplaceListingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMarketplaceListing = z.infer<typeof insertMarketplaceListingSchema>;
export type MarketplaceListing = typeof marketplaceListingsTable.$inferSelect;
