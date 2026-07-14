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

export const dealerUsersTable = pgTable(
  "dealer_users",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealersTable.id),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("admin"),
    status: text("status").notNull().default("Active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("dealer_users_username_idx").on(table.username)],
);

export const insertDealerUserSchema = createInsertSchema(dealerUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDealerUser = z.infer<typeof insertDealerUserSchema>;
export type DealerUser = typeof dealerUsersTable.$inferSelect;
