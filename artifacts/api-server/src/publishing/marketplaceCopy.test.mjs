import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFallbackMarketplaceCopy } from "./marketplaceCopy.ts";

test("Lucki fallback copy is dealer-specific and has no Alpha identity", () => {
  const copy = buildFallbackMarketplaceCopy({
    dealerId: 2,
    autoTitle: "2021 Chevrolet Silverado 2500HD Custom",
    priceTextEn: "$38,277",
    priceTextEs: "$38,277",
    mileageTextEn: "87,759 miles",
    mileageTextEs: "87,759 millas",
    lotLocation: "Woodbridge",
  });

  assert.match(copy.english, /Lucki Mazda in Woodbridge/);
  assert.match(copy.spanish, /Lucki Mazda en Woodbridge/);
  assert.match(`${copy.english}\n${copy.spanish}`, /571-774-7848/);
  assert.doesNotMatch(`${copy.english}\n${copy.spanish}`, /Alpha Motorsport|703-763-4675/);
});

test("Alpha fallback copy remains unchanged", () => {
  const copy = buildFallbackMarketplaceCopy({
    dealerId: 1,
    autoTitle: "2025 Mazda CX-5",
    priceTextEn: "$25,994",
    priceTextEs: "$25,994",
    mileageTextEn: "20 miles",
    mileageTextEs: "20 millas",
    lotLocation: "Manassas",
  });

  assert.match(copy.english, /available now at Alpha Motorsport/);
  assert.match(copy.spanish, /disponible ahora en Alpha Motorsport/);
  assert.match(`${copy.english}\n${copy.spanish}`, /703-763-4675/);
});
