import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = readFileSync(new URL("./publishing.ts", import.meta.url), "utf8");
const autoPublishSource = readFileSync(new URL("./autoPublish.ts", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../workers/publishing.worker.ts", import.meta.url), "utf8");
const batchProgressCardSource = readFileSync(
  new URL("../../../dashboard/src/features/listings/components/BatchProgressCard.tsx", import.meta.url),
  "utf8",
);

test("batch list exposes live job progress instead of terminal counts only", () => {
  assert.match(autoPublishSource, /max\(\$\{publishingJobsTable\.progressPercent\}\)/);
  assert.match(autoPublishSource, /progressPercent: Number\(row\.progressPercent \?\? 0\)/);
  assert.match(autoPublishSource, /currentStep: row\.currentStep \?\? null/);
  assert.match(batchProgressCardSource, /batch\.progressPercent \?\? 0/);
});

test("failure sync accepts active auto-publishing states instead of returning 409", () => {
  assert.match(routeSource, /eq\(publishingJobsTable\.status, "Auto Publishing"\)/);
  assert.match(routeSource, /eq\(publishingJobsTable\.status, "Opening Facebook"\)/);
});

test("batch review counters include only jobs that belong to the batch", () => {
  assert.match(autoPublishSource, /needsReviewCount: 0/);
  assert.doesNotMatch(autoPublishSource, /const needsReviewCount = ineligible\.length/);
});

test("publishing next endpoint does not expose queued jobs before scheduledAt", () => {
  assert.match(
    routeSource,
    /eq\(publishingJobsTable\.status,\s*"Queued"\)[\s\S]*or\(isNull\(publishingJobsTable\.scheduledAt\),\s*lte\(publishingJobsTable\.scheduledAt,\s*now\)\)/,
  );
});

test("assigned endpoint only returns due assigned jobs", () => {
  assert.match(
    routeSource,
    /eq\(publishingJobsTable\.status,\s*"Assigned"\)[\s\S]*or\(isNull\(publishingJobsTable\.scheduledAt\),\s*lte\(publishingJobsTable\.scheduledAt,\s*new Date\(\)\)\)/,
  );
});

test("assigned endpoint can map the extension storage id to the online Chrome connection", () => {
  assert.match(
    routeSource,
    /select name, chrome_extension_id from extension_connections where status = 'online' and last_heartbeat_at > now\(\) - interval '5 minutes'/,
  );
  assert.match(routeSource, /if \(online\?\.name\) aliases\.add\(online\.name\);/);
  assert.match(routeSource, /if \(online\?\.chrome_extension_id\) aliases\.add\(online\.chrome_extension_id\);/);
});

test("bulk schedule keeps future vehicles scheduled and assigns only due jobs", () => {
  assert.match(routeSource, /const claimableNow: number\[\] = \[\];/);
  assert.match(routeSource, /status:\s*jobDueNow\s*\?\s*"Queued"\s*:\s*"Scheduled"/);
  assert.match(routeSource, /if \(jobDueNow\) claimableNow\.push\(job!\.id\);/);
  assert.match(routeSource, /\.where\(inArray\(publishingJobsTable\.id,\s*claimableNow\)\)/);
});

test("bulk schedule preserves the operator selected vehicle order", () => {
  assert.match(routeSource, /const vehicleOrder = new Map\(vehicleIds\.map\(\(id, index\) => \[id, index\]\)\);/);
  assert.match(
    routeSource,
    /\.sort\([\s\S]*vehicleOrder\.get\(a\.id\)[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*vehicleOrder\.get\(b\.id\)[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*\)/,
  );
});

test("publishing worker also respects scheduledAt for queued jobs", () => {
  assert.match(
    workerSource,
    /eq\(publishingJobsTable\.status,\s*"Queued"\)[\s\S]*or\(isNull\(publishingJobsTable\.scheduledAt\),\s*lte\(publishingJobsTable\.scheduledAt,\s*new Date\(\)\)\)/,
  );
});

test("cancelled auto-publish batches are excluded from the operational list", () => {
  assert.match(
    autoPublishSource,
    /GET \/auto-publish\/batches[\s\S]*ne\(publishingBatchesTable\.status,\s*"Cancelled"\)/,
  );
});

test("dashboard also hides cancelled batches defensively", () => {
  assert.match(batchProgressCardSource, /b\.status !== "Cancelled" && !dismissed\.has\(b\.id\)/);
  assert.doesNotMatch(batchProgressCardSource, /recentCompleted[\s\S]*b\.status === "Cancelled"/);
});

test("dashboard batch progress counts Needs Review jobs as terminal", () => {
  assert.match(
    batchProgressCardSource,
    /batch\.completedCount \+ batch\.failedCount \+ batch\.skippedCount \+ batch\.needsReviewCount/,
  );
  assert.match(batchProgressCardSource, /batch\.needsReviewCount > 0/);
});

test("enabling a fully automatic plan kicks the publishing worker without Schedule Batch", () => {
  assert.match(
    autoPublishSource,
    /function shouldKickAutoPublish\(settings: AutoPublishSettings\): boolean \{[\s\S]*settings\.enabled[\s\S]*!settings\.requireApproval[\s\S]*resolvePublishMode\(settings\.autoClickPublish\) === "Controlled"/,
  );
  assert.match(
    autoPublishSource,
    /if \(shouldKickAutoPublish\(row\)\) \{[\s\S]*runWorkerOnce\(publishingWorker,\s*req\.log,\s*"manual",\s*null\)/,
  );
});

test("cancelled batches do not block the auto-publish frequency gate", () => {
  assert.match(
    workerSource,
    /from\(publishingBatchesTable\)[\s\S]*eq\(publishingBatchesTable\.dealerId,\s*DEALER_ID\)[\s\S]*ne\(publishingBatchesTable\.status,\s*"Cancelled"\)[\s\S]*orderBy\(desc\(publishingBatchesTable\.createdAt\)\)/,
  );
});
