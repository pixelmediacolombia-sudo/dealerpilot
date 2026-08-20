import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("Alpha Manassas qualification follows the new required order", () => {
  assert.match(source, /QUALIFICATION FUNNEL FOR ALPHA MANASSAS/);
  assert.match(source, /function historyHasBuyerPhone\(/);
  assert.match(source, /function extractBuyerQualification\(/);
  assert.match(source, /MINIMUM_DOWN_PAYMENT = 1000/);
  assert.match(source, /function buyerAcceptedCashPurchase/);
  assert.match(source, /never mistake the buyer's phone number for a down payment/i);
  assert.match(source, /cash, contado, or in cash/);
  assert.match(source, /plans starting at \$1,000, \$2,000, and \$3,000 down/);
  assert.match(source, /planes desde \$1,000, \$2,000 y \$3,000 de down payment/);
  assert.match(source, /currently requires more than \$1,000 down/);
  assert.match(source, /this week or this month/);
  assert.match(source, /in 15 days/);
  assert.match(source, /en 15 dias/);
  assert.match(source, /next month/);
  assert.match(source, /el otro mes/);
  assert.match(source, /named month/);
  assert.match(source, /valid ID and proof of income/);
  assert.match(source, /qualified_exit/);
  assert.match(source, /Alpha Manassas dealership phone/);
  assert.doesNotMatch(source, /Fredericksburg/);
  assert.doesNotMatch(source, /active bank account/);
  assert.match(source, /buyerPhoneAlreadyKnown/);
  assert.match(source, /if \(buyerPhoneAlreadyKnown/);
  assert.match(source, /buyerQualification\.downPayment/);
  assert.match(source, /buyerQualification\.timeline/);
  assert.match(source, /buyerQualification\.documents/);
});
