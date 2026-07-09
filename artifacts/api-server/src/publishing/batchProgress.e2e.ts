import assert from "node:assert/strict";
import test from "node:test";
import { deriveBatchProgress, getInitialBatchTiming } from "./batchProgress";

test("immediate auto-publish batches start active, not stuck preparing", () => {
  const nowMs = new Date("2026-07-09T22:33:00.000Z").getTime();
  const baseTime = new Date(nowMs);

  assert.deepEqual(getInitialBatchTiming(baseTime, nowMs), {
    status: "Active",
    startedAt: new Date(nowMs),
  });
});

test("future auto-publish batches remain scheduled until due", () => {
  const nowMs = new Date("2026-07-09T22:33:00.000Z").getTime();
  const baseTime = new Date(nowMs + 60_000);

  assert.deepEqual(getInitialBatchTiming(baseTime, nowMs), {
    status: "Scheduled",
    startedAt: null,
  });
});

test("batch progress reconciles from job terminal statuses", () => {
  assert.deepEqual(
    deriveBatchProgress({ completed: 1, failed: 0, skipped: 0, totalVehicles: 1 }),
    {
      completed: 1,
      failed: 0,
      skipped: 0,
      terminal: 1,
      isDone: true,
      status: "Completed",
    },
  );

  assert.deepEqual(
    deriveBatchProgress({ completed: 0, failed: 1, skipped: 0, totalVehicles: 1 }),
    {
      completed: 0,
      failed: 1,
      skipped: 0,
      terminal: 1,
      isDone: true,
      status: "Failed",
    },
  );
});

test("in-flight batch stays active while the extension is still publishing", () => {
  assert.deepEqual(
    deriveBatchProgress({ completed: 0, failed: 0, skipped: 0, totalVehicles: 1 }),
    {
      completed: 0,
      failed: 0,
      skipped: 0,
      terminal: 0,
      isDone: false,
      status: "Active",
    },
  );
});
