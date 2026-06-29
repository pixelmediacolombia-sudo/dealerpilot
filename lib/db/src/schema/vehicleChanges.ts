import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehicleChangesTable = pgTable("vehicle_changes", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull(),
  feedRunId: integer("feed_run_id"),
  changeType: text("change_type").notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVehicleChangeSchema = createInsertSchema(vehicleChangesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVehicleChange = z.infer<typeof insertVehicleChangeSchema>;
export type VehicleChange = typeof vehicleChangesTable.$inferSelect;
