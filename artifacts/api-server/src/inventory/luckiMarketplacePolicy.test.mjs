import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveLuckiBodyStyle,
  deriveLuckiCondition,
  deriveLuckiFuelType,
  fillOnlyWhenBlank,
  getLuckiIncomingValues,
  normalizeLuckiDescription,
} from "./luckiMarketplacePolicy.ts";

const van = {
  year: 2019,
  make: "Mercedes-Benz",
  model: "Sprinter Crew Van 2500",
  trim: "High Roof V6",
  mileage: 115735,
  stockNumber: "L296",
  exteriorColor: "Grey",
  interiorColor: "Black",
  bodyStyle: null,
  condition: null,
  transmission: null,
  fuelType: null,
  description: "Call us totoday ator callto schedule a test drive.",
  lotLocation: null,
};

test("Lucki Marketplace policy derives the required condition from mileage", () => {
  assert.equal(deriveLuckiCondition(null), "New");
  assert.equal(deriveLuckiCondition(0), "New");
  assert.equal(deriveLuckiCondition(1), "Used");
  assert.equal(getLuckiIncomingValues(van).condition, "Used");
});

test("Lucki Marketplace policy fills transmission, body style, and fuel type", () => {
  const values = getLuckiIncomingValues(van);
  assert.equal(values.transmission, "Automatic");
  assert.equal(values.bodyStyle, "Van");
  assert.equal(values.fuelType, "Gasoline Fuel");
  assert.equal(deriveLuckiBodyStyle({ ...van, bodyStyle: "SUV" }), "SUV");
  assert.equal(deriveLuckiFuelType({ ...van, fuelType: "Diesel" }), "Diesel");
});

test("Lucki Marketplace policy repairs malformed descriptions and supplies an empty fallback", () => {
  assert.equal(
    normalizeLuckiDescription(van),
    "Call us today or call to schedule a test drive.",
  );
  const empty = normalizeLuckiDescription({ ...van, description: null });
  assert.match(empty, /Lucki Mazda/);
  assert.match(empty, /Woodbridge/);
  assert.match(empty, /5717747848/);
  assert.match(empty, /2019 Mercedes-Benz Sprinter Crew Van 2500 High Roof V6/);
});

test("future Lucki imports only fill blank existing fields", () => {
  assert.equal(fillOnlyWhenBlank("Existing", "Incoming"), "Existing");
  assert.equal(fillOnlyWhenBlank(null, "Incoming"), "Incoming");
  assert.equal(fillOnlyWhenBlank("", "Incoming"), "Incoming");
});
