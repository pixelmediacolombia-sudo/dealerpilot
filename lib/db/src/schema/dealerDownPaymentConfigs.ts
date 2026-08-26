import {
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";

export const dealerDownPaymentConfigsTable = pgTable(
  "dealer_down_payment_configs",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealersTable.id),
    planAmounts: jsonb("plan_amounts").$type<number[]>().notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("dealer_down_payment_configs_active_idx").on(table.dealerId, table.effectiveFrom)],
);

export const insertDealerDownPaymentConfigSchema = createInsertSchema(
  dealerDownPaymentConfigsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDealerDownPaymentConfig = z.infer<typeof insertDealerDownPaymentConfigSchema>;
export type DealerDownPaymentConfig = typeof dealerDownPaymentConfigsTable.$inferSelect;
