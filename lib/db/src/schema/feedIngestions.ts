import { integer, pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const feedIngestionsTable = pgTable(
  "feed_ingestions",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    vehicleCount: integer("vehicle_count").notNull().default(0),
    status: text("status").notNull(),
    abortReason: text("abort_reason"),
  },
  (table) => [index("feed_ingestions_dealer_status_idx").on(table.dealerId, table.status, table.ingestedAt)],
);

export type FeedIngestion = typeof feedIngestionsTable.$inferSelect;
