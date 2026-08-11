import { integer, index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";

/**
 * One Meta Page connection per dealer/page. The access token is always stored
 * encrypted; it must never be returned to the dashboard or an extension.
 */
export const dealerMetaConnectionsTable = pgTable(
  "dealer_meta_connections",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealersTable.id),
    businessId: text("business_id"),
    pageId: text("page_id").notNull(),
    pageName: text("page_name"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    tokenKeyVersion: text("token_key_version").notNull().default("v1"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"),
    connectedByUserId: integer("connected_by_user_id"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dealer_meta_connections_dealer_page_idx").on(table.dealerId, table.pageId),
    index("dealer_meta_connections_dealer_status_idx").on(table.dealerId, table.status),
  ],
);

export const insertDealerMetaConnectionSchema = createInsertSchema(dealerMetaConnectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDealerMetaConnection = z.infer<typeof insertDealerMetaConnectionSchema>;
export type DealerMetaConnection = typeof dealerMetaConnectionsTable.$inferSelect;
