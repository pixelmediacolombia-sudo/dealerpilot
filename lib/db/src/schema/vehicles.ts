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
import { dealersTable } from "./dealers";

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealersTable.id),
    vin: text("vin").notNull(),
    stockNumber: text("stock_number"),
    year: integer("year"),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim"),
    mileage: integer("mileage"),
    price: integer("price"),
    downPaymentOverride: integer("down_payment_override"),
    downPaymentOverrideEffectiveFrom: timestamp("down_payment_override_effective_from", { withTimezone: true }),
    downPaymentOverrideEffectiveTo: timestamp("down_payment_override_effective_to", { withTimezone: true }),
    exteriorColor: text("exterior_color"),
    interiorColor: text("interior_color"),
    bodyStyle: text("body_style"),
    transmission: text("transmission"),
    fuelType: text("fuel_type"),
    description: text("description"),
    vdpUrl: text("vdp_url"),
    sourceRaw: text("source_raw"),
    // Active Alpha Motorsports dealer lot location (Manassas).
    // null = not provided by feed or feed predates this field.
    lotLocation: text("lot_location"),
    status: text("status").notNull().default("New"),
    // AI Photo Studio
    // null | Pending | Processing | Ready | Failed | Skipped
    aiPhotoStatus: text("ai_photo_status"),
    aiPhotoSetId: integer("ai_photo_set_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
    lastSeenInFeedAt: timestamp("last_seen_in_feed_at", { withTimezone: true }),
    missingFeedCount: integer("missing_feed_count").notNull().default(0),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    soldDetectionSource: text("sold_detection_source"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("vehicles_dealer_vin_idx").on(table.dealerId, table.vin)],
);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
