import assert from "node:assert/strict";
import test from "node:test";
import { CONFIRM_PRICE_INTENT, detectPriceIntent } from "./priceIntentDetector.ts";

test("detects Spanish total-price confirmation variants", () => {
  for (const message of [
    "¿Ese es el precio total?",
    "¿Cuesta eso el vehículo?",
    "¿Es el valor final del carro?",
    "¿El precio mostrado es el total?",
    "¿Ese precio es el total?",
    "¿El precio es final?",
  ]) {
    assert.equal(detectPriceIntent(message), CONFIRM_PRICE_INTENT, message);
  }
});

test("detects English total-price confirmation without broadening normal price questions", () => {
  assert.equal(detectPriceIntent("Is that the total price?"), CONFIRM_PRICE_INTENT);
  assert.equal(detectPriceIntent("How much is the vehicle?"), null);
  assert.equal(detectPriceIntent("What is the price?"), null);
});
