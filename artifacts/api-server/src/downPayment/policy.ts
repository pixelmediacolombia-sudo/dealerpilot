import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, dealerDownPaymentConfigsTable } from "@workspace/db";
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

  // Vehicle-level override columns are optional in the current production
  // schema. Do not query them here: a missing optional column must not turn
  // listing generation or Marketplace payload creation into a 500. The
  // dealer-level policy remains fully available until that migration lands.
  void vehicleId;
  return resolveDownPaymentPolicy(configs, null, now);
}
