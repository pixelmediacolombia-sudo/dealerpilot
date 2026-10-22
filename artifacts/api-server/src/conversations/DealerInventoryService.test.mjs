import assert from "node:assert/strict";
import test from "node:test";
import { DealerInventoryService } from "./dealerInventoryService.ts";

test("passes dealer_id and vehicle_id to the inventory lookup", async () => {
  const calls = [];
  const service = new DealerInventoryService(async (criteria) => {
    calls.push(criteria);
    return {
      id: 10,
      dealerId: criteria.dealerId,
      vin: "VIN-10",
      year: 2022,
      make: "Toyota",
      model: "Camry",
      trim: null,
      price: 32500,
      mileage: null,
      exteriorColor: null,
      vdpUrl: null,
      sourceRaw: null,
      lotLocation: null,
    };
  });

  const vehicle = await service.findVehicle({ dealerId: 7, vehicleId: 10 });
  assert.deepEqual(calls, [{ dealerId: 7, vehicleId: 10, vin: undefined }]);
  assert.equal(vehicle?.price, 32500);
});

test("supports a dealer-scoped VIN lookup and rejects missing scope", async () => {
  const calls = [];
  const service = new DealerInventoryService(async (criteria) => {
    calls.push(criteria);
    return null;
  });

  await service.findVehicle({ dealerId: 2, vin: " VIN-2 " });
  await service.findVehicle({ dealerId: 0, vehicleId: 2 });
  assert.deepEqual(calls, [{ dealerId: 2, vehicleId: undefined, vin: "VIN-2" }]);
});

test("keeps two dealer prices isolated", async () => {
  const service = new DealerInventoryService(async ({ dealerId }) => ({
    id: dealerId,
    dealerId,
    vin: `VIN-${dealerId}`,
    year: 2024,
    make: "Test",
    model: "Vehicle",
    trim: null,
    price: dealerId === 1 ? 32500 : 18200,
    mileage: null,
    exteriorColor: null,
    vdpUrl: null,
    sourceRaw: null,
    lotLocation: null,
  }));

  assert.equal((await service.findVehicle({ dealerId: 1, vehicleId: 101 }))?.price, 32500);
  assert.equal((await service.findVehicle({ dealerId: 2, vehicleId: 202 }))?.price, 18200);
});
