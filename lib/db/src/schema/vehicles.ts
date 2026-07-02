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

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    vin: text("vin").notNull(),
    stockNumber: text("stock_number"),
    year: integer("year"),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim"),
    mileage: integer("mileage"),
    price: integer("price"),
    exteriorColor: text("exterior_color"),
    interiorColor: text("interior_color"),
    bodyStyle: text("body_style"),
    transmission: text("transmission"),
    fuelType: text("fuel_type"),
    description: text("description"),
    vdpUrl: text("vdp_url"),
    sourceRaw: text("source_raw"),
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
