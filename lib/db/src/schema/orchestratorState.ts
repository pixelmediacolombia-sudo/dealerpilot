import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Single-row table (id=1) tracking the most recent orchestration cycle.
// The Orchestrator itself never calls OpenAI/FAL and never fabricates data —
// it only reads existing worker/inventory/budget state and decides RUN/SKIP/
// PAUSE per worker, then delegates actual execution to runWorkerOnce().
// status: Active | Failed (Failed only if the cycle itself threw despite
// its own defensive try/catch — the API must never crash even then).
export const orchestratorStateTable = pgTable("orchestrator_state", {
  id: serial("id").primaryKey(),
  lastDecisionAt: timestamp("last_decision_at", { withTimezone: true }),
  lastDecisionJson: text("last_decision_json"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertOrchestratorStateSchema = createInsertSchema(orchestratorStateTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrchestratorState = z.infer<typeof insertOrchestratorStateSchema>;
export type OrchestratorState = typeof orchestratorStateTable.$inferSelect;
