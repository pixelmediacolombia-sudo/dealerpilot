import assert from "node:assert/strict";
import { test } from "node:test";
import { LUCKI_MAZDA_SERIALIZED_XML } from "./luckiMazdaFixture.mjs";
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

test("inventory parser deduplicates repeated VINs and merges photos and changes", () => {
  const xml = `<?xml version="1.0"?>
    <inventory xmlns:v="urn:dealerpilot:inventory"><v:vehicle>
      <v:vin>1REPEATVIN</v:vin><v:vehicle_id>STK-1</v:vehicle_id>
      <v:make>Mazda</v:make><v:model>CX-5</v:model><v:year>2022</v:year>
      <v:price>24995</v:price><v:mileage>31000</v:mileage>
      <v:photo><v:url>https://img.example.test/one.jpg</v:url></v:photo>
      <v:photo><v:url>https://img.example.test/two.jpg</v:url></v:photo>
    </v:vehicle><v:vehicle>
      <v:vin>1REPEATVIN</v:vin><v:vehicle_id>STK-1</v:vehicle_id>
      <v:make>Mazda</v:make><v:model>CX-5</v:model><v:price>23995</v:price>
      <v:mileage>32000</v:mileage><v:description>Updated description</v:description>
      <v:photo><v:url>https://img.example.test/two.jpg</v:url></v:photo>
      <v:photo><v:url>https://img.example.test/three.jpg</v:url></v:photo>
    </v:vehicle></inventory>`;

  const result = parseInventoryXml(xml);
  assert.equal(result.rawCount, 2);
  assert.equal(result.errors, 0);
  assert.equal(result.vehicles.length, 1);
  assert.partialDeepStrictEqual(result.vehicles[0], {
    vin: "1REPEATVIN",
    stockNumber: "STK-1",
    price: 23995,
    mileage: 32000,
    description: "Updated description",
    lotLocation: null,
  });
  assert.deepEqual(
    result.vehicles[0].images.map((image) => image.url),
    [
      "https://img.example.test/one.jpg",
      "https://img.example.test/two.jpg",
      "https://img.example.test/three.jpg",
    ],
  );
});

test("inventory parser preserves explicit unknown locations but never invents one", () => {
  const xml = `<?xml version="1.0"?>
    <inventory><vehicle><vin>1NOLOCATION</vin><vehicle_id>S-2</vehicle_id>
      <make>Mazda</make><model>3</model><year>2021</year>
      <dealer_id>148954</dealer_id><vdp_url>https://dealer.example.test/vehicles/1</vdp_url>
    </vehicle><vehicle><vin>1EXPLICITLOCATION</vin><vehicle_id>S-3</vehicle_id>
      <make>Mazda</make><model>CX-30</model><location>Woodbridge</location>
    </vehicle></inventory>`;

  const result = parseInventoryXml(xml);
  assert.equal(result.vehicles[0].feedDealerId, "148954");
  assert.equal(result.vehicles[0].vdpUrl, "https://dealer.example.test/vehicles/1");
  assert.equal(result.vehicles[0].lotLocation, null);
  assert.equal(result.vehicles[1].lotLocation, "Woodbridge");
});

test("inventory parser preserves the per-vehicle condition for Marketplace", () => {
  const xml = `<?xml version="1.0"?>
    <inventory><vehicle><vin>1CONDITIONVIN</vin><vehicle_id>S-4</vehicle_id>
      <make>Mazda</make><model>CX-5</model><year>2024</year>
      <vehicle_condition>Excellent</vehicle_condition>
    </vehicle></inventory>`;

  const result = parseInventoryXml(xml);
  assert.equal(result.vehicles[0].condition, "Excellent");
});

test("inventory parser unwraps Vincue's serialized XML response", () => {
  const result = parseInventoryXml(LUCKI_MAZDA_SERIALIZED_XML);

  assert.equal(result.rawCount, 1);
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.errors, 0);
  assert.partialDeepStrictEqual(result.vehicles[0], {
    vin: "1SANITIZEDVIN0001",
    stockNumber: "U00016",
    year: 2022,
    make: "Mazda",
    model: "CX-5",
    price: 24995,
    mileage: 31000,
    feedDealerId: "148954",
    vdpUrl: "https://dealer.example.test/vdp/U00016",
    lotLocation: null,
  });
  assert.deepEqual(result.vehicles[0].images.map((image) => image.url), [
    "https://images.example.test/U00016-1.jpg",
    "https://images.example.test/U00016-2.jpg",
  ]);
});

test("Lucki's missing XML location stays null at parser level for dealer-scoped import fallback", () => {
  const result = parseInventoryXml(LUCKI_MAZDA_SERIALIZED_XML);
  assert.equal(result.vehicles[0].lotLocation, null);
  assert.doesNotMatch(result.vehicles[0].sourceRaw, /Woodbridge/i);
});
