import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInventoryXml } from "./xmlEngine.ts";

test("inventory parser keeps the physical feed city and catalog dealer id", () => {
  const xml = `<?xml version="1.0"?>
    <rss xmlns:g="http://base.google.com/ns/1.0"><channel>
      <item>
        <g:vehicle_id>F12345</g:vehicle_id><g:vin>1FVIN</g:vin>
        <g:make>Ford</g:make><g:model>F-150</g:model><g:year>2020</g:year>
        <g:dealer_id>DC1786</g:dealer_id>
        <g:address><g:component name="city">FREDERICKSBURG</g:component></g:address>
      </item>
      <item>
        <g:vehicle_id>M12345</g:vehicle_id><g:vin>1MVIN</g:vin>
        <g:make>Honda</g:make><g:model>Civic</g:model><g:year>2021</g:year>
        <g:dealer_id>DC1786</g:dealer_id>
        <g:address><g:component name="city">MANASSAS</g:component></g:address>
      </item>
    </channel></rss>`;

  const result = parseInventoryXml(xml);
  assert.equal(result.rawCount, 2);
  assert.equal(result.vehicles.length, 2);
  assert.deepEqual(
    result.vehicles.map((vehicle) => ({ stockNumber: vehicle.stockNumber, lotLocation: vehicle.lotLocation, feedDealerId: vehicle.feedDealerId })),
    [
      { stockNumber: "F12345", lotLocation: "Fredericksburg", feedDealerId: "DC1786" },
      { stockNumber: "M12345", lotLocation: "Manassas", feedDealerId: "DC1786" },
    ],
  );
});
