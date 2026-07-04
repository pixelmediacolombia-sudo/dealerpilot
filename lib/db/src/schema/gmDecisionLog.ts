import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const gmDecisionLogTable = pgTable(
  "gm_decision_log",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    vehicleLabel: text("vehicle_label").notNull(),
    gmRecommendation: text("gm_recommendation").notNull(), // PUBLISH | HOLD | RECONSIDER
    gmConfidence: integer("gm_confidence"),
    // What the operator actually did
    operatorAction: text("operator_action").notNull(),
    // confirmed_publish | held | overridden | batch_blocked | batch_published
    overridden: boolean("overridden").notNull().default(false),
    finalPublishStatus: text("final_publish_status").notNull(),
    // published | held | batch_blocked
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gm_decision_log_vehicle_idx").on(table.vehicleId),
    index("gm_decision_log_created_idx").on(table.createdAt),
  ],
);

export type GmDecisionLog = typeof gmDecisionLogTable.$inferSelect;
