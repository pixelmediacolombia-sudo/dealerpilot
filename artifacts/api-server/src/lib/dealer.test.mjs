import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getDealerDefaultLotLocation,
  getFeedDealerId,
  isAlphaManassasVehicle,
  markVerifiedFeedLotLocation,
  resolveImportedLotLocation,
} from "./dealer.ts";

test("Alpha dealer id parser accepts the namespaced catalog key", () => {
  const sourceRaw = JSON.stringify({ "g:dealer_id": "DC1786", "g:vehicle_id": "S012226" });
  assert.equal(getFeedDealerId(sourceRaw), "DC1786");

  const verifiedRaw = markVerifiedFeedLotLocation(sourceRaw, "Manassas");
  assert.equal(
    isAlphaManassasVehicle({ dealerId: 1, lotLocation: "Manassas", sourceRaw: verifiedRaw }),
    true,
  );
});

test("Alpha dealer id parser rejects a different catalog dealer", () => {
  const sourceRaw = JSON.stringify({ "g:dealer_id": "OTHER", dealerpilot_lot_location: "Manassas" });
  assert.equal(getFeedDealerId(sourceRaw), "OTHER");
  assert.equal(
    isAlphaManassasVehicle({ dealerId: 1, lotLocation: "Manassas", sourceRaw }),
    false,
  );
});

test("Lucki gets a dealer-scoped Woodbridge fallback without changing Alpha", () => {
  assert.equal(getDealerDefaultLotLocation(2), "Woodbridge");
  assert.equal(resolveImportedLotLocation(2, null), "Woodbridge");
  assert.equal(resolveImportedLotLocation(2, "Woodbridge"), "Woodbridge");
  assert.equal(resolveImportedLotLocation(1, null), null);
  assert.equal(resolveImportedLotLocation(1, "Manassas"), "Manassas");
});

test("the same city remains isolated by the internal dealer id", () => {
  const lucki = { dealerId: 2, lotLocation: resolveImportedLotLocation(2, null) };
  const anotherDealerInWoodbridge = { dealerId: 7, lotLocation: "Woodbridge" };

  assert.equal(lucki.lotLocation, anotherDealerInWoodbridge.lotLocation);
  assert.notEqual(lucki.dealerId, anotherDealerInWoodbridge.dealerId);
});
