import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLuckiMazdaFeedConfig, getLuckiMazdaFeedConfig } from "./dealerFeedConfig.ts";

test("Lucki runtime config creates x-api-key headers without persisting the key", () => {
  const config = getLuckiMazdaFeedConfig({
    VINCUE_API_KEY_LUCKI_MAZDA: "runtime-only-test-value",
    VINCUE_LUCKI_MAZDA_DEALER_ID: "148954",
    VINCUE_LUCKI_MAZDA_XML_URL: "https://inventory.example.test/lucki.xml",
  });

  assert.equal(config.providerName, "Vincue");
  assert.equal(config.providerDealerId, "148954");
  assert.equal(config.xmlFeedUrl, "https://inventory.example.test/lucki.xml");
  assert.equal(config.feedAuthMode, "x-api-key");
  assert.equal(config.headers["x-api-key"], "runtime-only-test-value");
  assert.equal(config.headers.Accept, "application/xml");
});

test("Lucki runtime config fails closed when the API key is absent", () => {
  const config = getLuckiMazdaFeedConfig({
    VINCUE_LUCKI_MAZDA_DEALER_ID: "148954",
    VINCUE_LUCKI_MAZDA_XML_URL: "https://inventory.example.test/lucki.xml",
  });

  assert.throws(() => assertLuckiMazdaFeedConfig(config), /missing its runtime Vincue API key/);
  assert.deepEqual(config.headers, {});
});
