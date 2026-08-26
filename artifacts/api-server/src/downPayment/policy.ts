import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, dealerDownPaymentConfigsTable, vehiclesTable, type Vehicle } from "@workspace/db";
import {
  buildDownPaymentInstruction,
  formatDownPaymentAmounts,
  normalizePlanAmounts,
  resolveDownPaymentPolicy,
  type DownPaymentPolicy,
} from "./policyCore";

export {
  buildDownPaymentInstruction,
  formatDownPaymentAmounts,
  normalizePlanAmounts,
  resolveDownPaymentPolicy,
};
export type { DownPaymentPolicy };

export async function getDownPaymentPolicy(dealerId: number, vehicleId?: number, now = new Date()): Promise<DownPaymentPolicy> {
  const configs = await db
    .select()
    .from(dealerDownPaymentConfigsTable)
    .where(and(
      eq(dealerDownPaymentConfigsTable.dealerId, dealerId),
      lte(dealerDownPaymentConfigsTable.effectiveFrom, now),
      or(
        isNull(dealerDownPaymentConfigsTable.effectiveTo),
        gt(dealerDownPaymentConfigsTable.effectiveTo, now),
      ),
    ))
    .orderBy(desc(dealerDownPaymentConfigsTable.effectiveFrom));

  let vehicle: Pick<Vehicle, "downPaymentOverride" | "downPaymentOverrideEffectiveFrom" | "downPaymentOverrideEffectiveTo"> | null = null;
  if (vehicleId != null) {
    const [row] = await db
      .select({
        downPaymentOverride: vehiclesTable.downPaymentOverride,
        downPaymentOverrideEffectiveFrom: vehiclesTable.downPaymentOverrideEffectiveFrom,
        downPaymentOverrideEffectiveTo: vehiclesTable.downPaymentOverrideEffectiveTo,
      })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, dealerId)))
      .limit(1);
    vehicle = row ?? null;
  }
  return resolveDownPaymentPolicy(configs, vehicle, now);
}
