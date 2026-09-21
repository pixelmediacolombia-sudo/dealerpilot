import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("./publishing.worker.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../routes/publishing.ts", import.meta.url), "utf8");
const controlledModeSource = await readFile(new URL("../publishing/controlledMode.ts", import.meta.url), "utf8");

test("publishing worker verifies job and vehicle dealer before lot guard", () => {
  assert.match(workerSource, /currentVehicle\.dealerId !== job\.dealerId/);
  assert.match(workerSource, /isVerifiedDealerPublishingVehicle\(currentVehicle\)/);
  assert.match(workerSource, /alphaGuard \? "NON_MANASSAS_LOT" : "UNKNOWN_LOT"/);
});

test("assigned, payload, and controlled-mode paths use dealer-aware location policy", () => {
  assert.match(routeSource, /isVerifiedDealerPublishingVehicle/);
  assert.match(controlledModeSource, /isVerifiedDealerPublishingVehicle\(vehicle\)/);
  assert.doesNotMatch(controlledModeSource, /const lotCity = resolveAlphaLotCity\(vehicle\.lotLocation\)/);
});
