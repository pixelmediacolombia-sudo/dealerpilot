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

test("publishing worker assigns each online dealer to its own extension", () => {
  assert.match(workerSource, /findOnlineExtensions/);
  assert.match(workerSource, /inArray\(publishingJobsTable\.dealerId, onlineDealerIds\)/);
  assert.match(workerSource, /const extensionByDealer = new Map\(onlineExtensions\.map/);
  assert.match(workerSource, /const extension = extensionByDealer\.get\(job\.dealerId\)/);
  assert.match(workerSource, /assignedExtensionId: extension\.id/);
  assert.match(workerSource, /alphaExtensionOnline/);
});

test("publishing routes reject an extension configured for another dealer", () => {
  assert.match(routeSource, /getExtensionDealerScope\(parsed\.data\.extensionId, job\.dealerId\)/);
  assert.match(routeSource, /Extension is not configured for this dealer/);
  assert.match(routeSource, /eq\(publishingJobsTable\.dealerId, extensionScope\.dealerId\)/);
});
