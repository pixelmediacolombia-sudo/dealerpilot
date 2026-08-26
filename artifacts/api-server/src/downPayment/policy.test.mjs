import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDownPaymentInstruction,
  formatDownPaymentAmounts,
  normalizePlanAmounts,
  resolveDownPaymentPolicy,
} from "./policyCore.ts";

const now = new Date("2026-08-26T15:00:00.000Z");

function config(overrides = {}) {
  return {
    id: 10,
    dealerId: 1,
    planAmounts: [3000, 1000, 2000],
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("normalizes, deduplicates, and sorts configured plans", () => {
  assert.deepEqual(normalizePlanAmounts([3000, 1000, 1000, 0, "2000", null]), [1000, 3000]);
});

test("selects the most recent effective dealer configuration", () => {
  const policy = resolveDownPaymentPolicy([
    config({ id: 1, planAmounts: [1000], effectiveFrom: new Date("2026-01-01T00:00:00.000Z") }),
    config({ id: 2, planAmounts: [2000, 3000], effectiveFrom: new Date("2026-08-01T00:00:00.000Z") }),
  ], null, now);
  assert.deepEqual(policy.planAmounts, [2000, 3000]);
  assert.equal(policy.minimumAmount, 2000);
  assert.equal(policy.source, "dealer_config");
});

test("vehicle override wins only while its effective window is active", () => {
  const active = resolveDownPaymentPolicy([config()], {
    downPaymentOverride: 4500,
    downPaymentOverrideEffectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
    downPaymentOverrideEffectiveTo: null,
  }, now);
  assert.equal(active.minimumAmount, 4500);
  assert.equal(active.source, "vehicle_override");

  const expired = resolveDownPaymentPolicy([config()], {
    downPaymentOverride: 4500,
    downPaymentOverrideEffectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    downPaymentOverrideEffectiveTo: new Date("2026-08-01T00:00:00.000Z"),
  }, now);
  assert.equal(expired.minimumAmount, 1000);
  assert.equal(expired.source, "dealer_config");
});

test("no current configuration produces no approved amount", () => {
  const policy = resolveDownPaymentPolicy([
    config({ effectiveTo: new Date("2026-08-01T00:00:00.000Z") }),
  ], null, now);
  assert.deepEqual(policy.planAmounts, []);
  assert.equal(policy.minimumAmount, null);
  assert.match(buildDownPaymentInstruction(policy, "es"), /No hay una configuración vigente/);
});

test("formats configured amounts without inventing a range", () => {
  assert.equal(formatDownPaymentAmounts([1000, 2000, 3000], "es"), "$1,000, $2,000 y $3,000");
  assert.equal(formatDownPaymentAmounts([1000, 2000, 3000], "en"), "$1,000, $2,000, and $3,000");
});
