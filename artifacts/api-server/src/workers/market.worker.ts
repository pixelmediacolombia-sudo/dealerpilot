// Market Intelligence Worker — analyzes active inventory to surface buyer
// segment opportunities and duplicate listing conflicts. Read-only: it
// reports on data the Opportunity Engine already computed (primarySegment,
// adAngle, pricing) plus a real duplicate-conflict scan across active
// vehicles at the same lot.
import { db, vehiclesTable, vehicleIntelligenceTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEALER_ID = 1;
const ACTIVE_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish"];
const AFFORDABLE_PRICE_CEILING_USD = 20000;
const TRUCK_BODY_STYLES = ["Truck", "Pickup"];
const SUV_BODY_STYLES = ["SUV", "Crossover"];

async function run(): Promise<WorkerRunOutcome> {
  const rows = await db
    .select({
      id: vehiclesTable.id,
      year: vehiclesTable.year,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      bodyStyle: vehiclesTable.bodyStyle,
      price: vehiclesTable.price,
      lotLocation: vehiclesTable.lotLocation,
      status: vehiclesTable.status,
      primarySegment: vehicleIntelligenceTable.primarySegment,
      secondarySegment: vehicleIntelligenceTable.secondarySegment,
      suggestedLanguage: vehicleIntelligenceTable.suggestedLanguage,
    })
    .from(vehiclesTable)
    .leftJoin(vehicleIntelligenceTable, eq(vehicleIntelligenceTable.vehicleId, vehiclesTable.id))
    .where(and(eq(vehiclesTable.dealerId, DEALER_ID)));

  const active = rows.filter((r) => ACTIVE_STATUSES.includes(r.status));

  const spanishFirst = active.filter(
    (r) => r.suggestedLanguage === "Spanish-first" || r.primarySegment === "Spanish-first Family",
  ).length;
  const affordablePayment = active.filter((r) => (r.price ?? Infinity) <= AFFORDABLE_PRICE_CEILING_USD).length;
  const trucks = active.filter((r) => TRUCK_BODY_STYLES.includes(r.bodyStyle ?? "")).length;
  const familySuvs = active.filter((r) => SUV_BODY_STYLES.includes(r.bodyStyle ?? "")).length;

  // Duplicate conflict: same year/make/model at the same lot, both active —
  // self-competition risk if both get published around the same time.
  const seen = new Map<string, number[]>();
  for (const r of active) {
    if (!r.lotLocation) continue;
    const key = `${r.year}|${r.make}|${r.model}|${r.lotLocation}`;
    const list = seen.get(key) ?? [];
    list.push(r.id);
    seen.set(key, list);
  }
  const duplicateGroups = [...seen.values()].filter((ids) => ids.length > 1);
  const duplicateConflicts = duplicateGroups.reduce((sum, ids) => sum + ids.length, 0);

  return {
    summary: `Market scan — ${spanishFirst} Spanish-first, ${affordablePayment} affordable-payment, ${trucks} truck/work, ${familySuvs} family SUV, ${duplicateConflicts} duplicate conflicts`,
    detail: {
      activeCount: active.length,
      spanishFirst,
      affordablePayment,
      trucks,
      familySuvs,
      duplicateConflictGroups: duplicateGroups.length,
      duplicateConflictVehicleIds: duplicateGroups.flat(),
    },
  };
}

export const marketWorker: WorkerDefinition = {
  id: "market",
  name: "Market Agent",
  description: "Identifies buyer segment opportunities and duplicate listing conflicts",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};

// Exported for the Publishing Worker's duplicate-conflict guardrail.
export async function getDuplicateConflictVehicleIds(): Promise<Set<number>> {
  const outcome = await run();
  const ids = (outcome.detail?.duplicateConflictVehicleIds as number[] | undefined) ?? [];
  return new Set(ids);
}
