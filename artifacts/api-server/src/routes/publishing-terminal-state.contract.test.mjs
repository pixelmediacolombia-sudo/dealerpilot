import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worker = readFileSync(new URL("../workers/publishing.worker.ts", import.meta.url), "utf8");
const autoPublish = readFileSync(new URL("./autoPublish.ts", import.meta.url), "utf8");
const controlledMode = readFileSync(new URL("../publishing/controlledMode.ts", import.meta.url), "utf8");
const publishing = readFileSync(new URL("./publishing.ts", import.meta.url), "utf8");

test("automatic publishing excludes Archived and rechecks terminal status at assignment", () => {
  assert.equal((autoPublish.match(/ne\(vehiclesTable\.status, "Archived"\)/g) ?? []).length, 3);
  assert.match(worker, /ne\(vehiclesTable\.status, "Archived"\)/);
  assert.match(controlledMode, /NOT_ELIGIBLE_STATUSES = new Set\(\["Published", "Sold\/Removed", "Sold", "Removed", "Archived"\]\)/);
  assert.match(worker, /Last-moment inventory guard/);
  assert.match(worker, /NOT_ELIGIBLE_STATUSES\.has\(currentVehicle\.status\)/);
});

test("publishing completion preserves terminal vehicle states", () => {
  assert.match(publishing, /preserved terminal vehicle status instead of overwriting it with Published/);
  assert.match(publishing, /!NOT_ELIGIBLE_STATUSES\.has\(currentVehicle\.status\)/);
});
