import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getFeedDealerId,
  isAlphaManassasVehicle,
  markVerifiedFeedLotLocation,
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
