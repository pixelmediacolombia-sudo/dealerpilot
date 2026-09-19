import assert from "node:assert/strict";
import test from "node:test";
import { fetchFeedXml } from "./feedSource.ts";
import { LUCKI_MAZDA_SERIALIZED_XML } from "./luckiMazdaFixture.mjs";
import { parseInventoryXml } from "./xmlEngine.ts";

test("Vincue feed E2E preserves x-api-key request, stock, price, VDP and images", async (t) => {
  let receivedApiKey = null;
  let receivedAccept = null;
  let receivedPath = null;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(String(input));
    receivedApiKey = init?.headers?.["x-api-key"] ?? null;
    receivedAccept = init?.headers?.Accept ?? null;
    receivedPath = `${requestUrl.pathname}${requestUrl.search}`;
    return new Response(LUCKI_MAZDA_SERIALIZED_XML, {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
  };

  const xml = await fetchFeedXml(
    "https://provider.example.test/api/Inventory/ActiveInventoryXML?dealerID=148954",
    { headers: { "x-api-key": "fixture-auth-value", Accept: "application/xml" } },
  );
  const result = parseInventoryXml(xml);

  assert.equal(receivedApiKey, "fixture-auth-value");
  assert.equal(receivedAccept, "application/xml");
  assert.equal(receivedPath, "/api/Inventory/ActiveInventoryXML?dealerID=148954");
  assert.equal(result.rawCount, 1);
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].stockNumber, "U00016");
  assert.equal(result.vehicles[0].year, 2022);
  assert.equal(result.vehicles[0].make, "Mazda");
  assert.equal(result.vehicles[0].model, "CX-5");
  assert.equal(result.vehicles[0].price, 24995);
  assert.equal(result.vehicles[0].mileage, 31000);
  assert.equal(result.vehicles[0].feedDealerId, "148954");
  assert.equal(result.vehicles[0].vdpUrl, "https://dealer.example.test/vdp/U00016");
  assert.deepEqual(result.vehicles[0].images.map((image) => image.url), [
    "https://images.example.test/U00016-1.jpg",
    "https://images.example.test/U00016-2.jpg",
  ]);
  assert.equal(result.vehicles[0].lotLocation, null);
});
