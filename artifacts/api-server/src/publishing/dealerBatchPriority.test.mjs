import assert from "node:assert/strict";
import { test } from "node:test";
import { getDealerBatchPriority, getLuckiCompletenessScore } from "./dealerBatchPriority.ts";

const completeLuckiVehicle = {
  vin: "VIN-1",
  stockNumber: "U00001",
  year: 2025,
  make: "Mazda",
  model: "CX-5",
  trim: "Preferred",
  mileage: 10,
  price: 28000,
  description: "Complete description",
  vdpUrl: "https://example.test/vdp/1",
  exteriorColor: "White",
  interiorColor: "Black",
  bodyStyle: "Sport Utility",
  transmission: "Automatic",
  fuelType: "Gasoline",
  lotLocation: "Woodbridge",
};

test("Lucki completeness rewards complete data and photos", () => {
  const complete = getLuckiCompletenessScore(completeLuckiVehicle, 24);
  const partial = getLuckiCompletenessScore({ ...completeLuckiVehicle, description: "", exteriorColor: null, vdpUrl: null }, 0);
  assert.equal(complete, 100);
  assert.ok(complete > partial);
});

test("Lucki completeness outranks the old score for first batches", () => {
  const complete = getDealerBatchPriority(2, 20, completeLuckiVehicle, 24);
  const partial = getDealerBatchPriority(2, 100, { ...completeLuckiVehicle, description: "", vdpUrl: null, lotLocation: null }, 0);
  assert.ok(complete.priorityScore > partial.priorityScore);
  assert.equal(complete.completenessScore, 100);
});

test("Alpha keeps the existing priority score unchanged", () => {
  const result = getDealerBatchPriority(1, 42, completeLuckiVehicle, 24);
  assert.deepEqual(result, { priorityScore: 42, completenessScore: 0 });
});
