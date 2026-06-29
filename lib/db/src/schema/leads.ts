import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";
import { vehiclesTable } from "./vehicles";
import { listingsTable } from "./listings";
import { conversationsTable } from "./conversations";

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(
    () => conversationsTable.id,
  ),
  dealerId: integer("dealer_id").references(() => dealersTable.id),
  buyerName: text("buyer_name"),
  phone: text("phone"),
  language: text("language").default("en"),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  listingId: integer("listing_id").references(() => listingsTable.id),
  sourceUrl: text("source_url"),
  messageText: text("message_text"),
  suggestedReply: text("suggested_reply"),
  publishedDownPayment: integer("published_down_payment"),
  buyerAvailableDownPayment: integer("buyer_available_down_payment"),
  buyerTimeline: text("buyer_timeline"),
  hasId: boolean("has_id"),
  hasProofOfIncome: boolean("has_proof_of_income"),
  appointmentIntent: boolean("appointment_intent"),
  leadScore: integer("lead_score").default(0),
  temperature: text("temperature").default("Cold"),
  status: text("status").notNull().default("New"),
  conversationSummary: text("conversation_summary"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
