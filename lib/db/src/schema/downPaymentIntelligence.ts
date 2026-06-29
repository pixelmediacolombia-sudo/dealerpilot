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

export const downPaymentIntelligenceTable = pgTable(
  "down_payment_intelligence",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealersTable.id),
    conversationId: integer("conversation_id").references(
      () => conversationsTable.id,
    ),
    vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
    listingId: integer("listing_id").references(() => listingsTable.id),
    vehicleType: text("vehicle_type"),
    publishedDownPayment: integer("published_down_payment"),
    buyerAvailableDownPayment: integer("buyer_available_down_payment"),
    buyerTimeline: text("buyer_timeline"),
    leadTemperature: text("lead_temperature"),
    leadScore: integer("lead_score"),
    appointmentIntent: boolean("appointment_intent"),
    outcome: text("outcome").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

export const insertDownPaymentIntelligenceSchema = createInsertSchema(
  downPaymentIntelligenceTable,
).omit({ id: true, createdAt: true });

export type InsertDownPaymentIntelligence = z.infer<
  typeof insertDownPaymentIntelligenceSchema
>;
export type DownPaymentIntelligence =
  typeof downPaymentIntelligenceTable.$inferSelect;
