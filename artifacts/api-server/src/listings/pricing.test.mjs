import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMarketplaceTitle } from "./pricing.ts";

const vehicle = {
  year: 2021,
  make: "Toyota",
  model: "Tacoma",
  trim: null,
};

test("Marketplace title uses the persisted down payment as the Spanish hook", () => {
  assert.equal(
    buildMarketplaceTitle(vehicle, 2500),
    "2021 Toyota Tacoma — $2,500 DE ENGANCHE",
  );
});

test("Marketplace title does not invent a down payment when none is persisted", () => {
  assert.equal(buildMarketplaceTitle(vehicle, null), "2021 Toyota Tacoma");
});

test("Marketplace title includes trim without changing the price source", () => {
  assert.equal(
    buildMarketplaceTitle({ ...vehicle, trim: "SR5" }, 3000),
    "2021 Toyota Tacoma SR5 — $3,000 DE ENGANCHE",
  );
});
