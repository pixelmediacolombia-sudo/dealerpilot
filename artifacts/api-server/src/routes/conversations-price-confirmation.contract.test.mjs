import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("price confirmation is global and runs before the dealer-specific Lucki path", () => {
  const detector = source.indexOf('detectPriceIntent(currentMessage) === CONFIRM_PRICE_INTENT');
  const luckiPath = source.indexOf('if (dealerId === LUCKI_MAZDA_DEALER_ID)');
  assert.ok(detector >= 0);
  assert.ok(luckiPath > detector);
  assert.match(source, /vehicleFacts\.inventoryPrice/);
  assert.match(source, /vehicleFacts\.listedPrice/);
});

test("confirmation is not a terminal handoff", () => {
  assert.match(source, /if \(stage === "confirm_price_intent"\)/);
  assert.doesNotMatch(source, /closeAfterDelivery = [^\n]*confirm_price_intent/);
  assert.match(source, /formatPriceConfirmation/);
});

test("inventory lookup is dealer-scoped", () => {
  assert.match(source, /eq\(vehiclesTable\.dealerId, dealerId\)/);
  assert.match(source, /eq\(vehiclesTable\.id, vehicleId/);
});
