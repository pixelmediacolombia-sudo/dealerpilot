import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const extensionConnectionsTable = pgTable("extension_connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  backendUrl: text("backend_url"),
  status: text("status").notNull().default("offline"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertExtensionConnectionSchema = createInsertSchema(
  extensionConnectionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExtensionConnection = z.infer<
  typeof insertExtensionConnectionSchema
>;
export type ExtensionConnection = typeof extensionConnectionsTable.$inferSelect;
