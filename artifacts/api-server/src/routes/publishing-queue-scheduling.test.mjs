import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = readFileSync(new URL("./publishing.ts", import.meta.url), "utf8");
const autoPublishSource = readFileSync(new URL("./autoPublish.ts", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../workers/publishing.worker.ts", import.meta.url), "utf8");
const publishingRepositorySource = readFileSync(
  new URL("../features/publishing/infrastructure/publishingRepository.ts", import.meta.url),
  "utf8",
);
const pricingSource = readFileSync(new URL("../listings/pricing.ts", import.meta.url), "utf8");
const conversationsSource = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");
const authSource = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const queueClientSource = readFileSync(
  new URL("../../../../chrome-extension/src/background/queueClient.js", import.meta.url),
  "utf8",
);
const publisherFlowSource = readFileSync(
  new URL("../../../../chrome-extension/src/content/facebook/publisherFlow.js", import.meta.url),
  "utf8",
);
const batchProgressCardSource = readFileSync(
  new URL("../../../dashboard/src/features/listings/components/BatchProgressCard.tsx", import.meta.url),
  "utf8",
);
const authGateSource = readFileSync(
  new URL("../../../dashboard/src/app/AuthGate.tsx", import.meta.url),
  "utf8",
);
const salesAiSource = readFileSync(
  new URL("../../../dashboard/src/features/sales-ai/pages/index.tsx", import.meta.url),
  "utf8",
);
const restorationSpecSource = readFileSync(
  new URL("../photo/restorationSpec.ts", import.meta.url),
  "utf8",
);
const enhanceStageSource = readFileSync(
  new URL("../photo/stages/4_enhance.ts", import.meta.url),
  "utf8",
);
const openAiRestorationSource = readFileSync(
  new URL("../photo/providers/openaiRestoration.ts", import.meta.url),
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

test("cancelled and dismissed auto-publish batches are excluded from the operational list", () => {
  assert.match(
    autoPublishSource,
    /GET \/auto-publish\/batches[\s\S]*ne\(publishingBatchesTable\.status,\s*"Cancelled"\)/,
  );
  assert.match(
    autoPublishSource,
    /GET \/auto-publish\/batches[\s\S]*ne\(publishingBatchesTable\.status,\s*"Dismissed"\)/,
  );
});

test("dashboard persists removed batches as dismissed", () => {
  assert.match(batchProgressCardSource, /data: \{ status: "Dismissed" \}/);
  assert.match(batchProgressCardSource, /b\.status !== "Cancelled" && b\.status !== "Dismissed"/);
  assert.doesNotMatch(batchProgressCardSource, /const recentCompleted/);
  assert.match(batchProgressCardSource, /const shown = activeBatches\.slice\(0,\s*5\)/);
  assert.doesNotMatch(batchProgressCardSource, /useState<Set<number>>/);
});

test("dashboard batch progress counts Needs Review jobs as terminal", () => {
  assert.match(
    batchProgressCardSource,
    /batch\.completedCount \+ batch\.failedCount \+ batch\.skippedCount \+ batch\.needsReviewCount/,
  );
  assert.match(batchProgressCardSource, /batch\.needsReviewCount > 0/);
});

test("moving a published job to Needs Review clears contradictory published state", () => {
  assert.match(publishingRepositorySource, /status:\s*"Needs Review"/);
  assert.match(publishingRepositorySource, /currentStep:\s*"Needs Review"/);
  assert.match(publishingRepositorySource, /listingUrl:\s*null/);
  assert.match(publishingRepositorySource, /claimedByExtension:\s*null/);
  assert.match(publishingRepositorySource, /assignedExtensionId:\s*null/);
  assert.match(publishingRepositorySource, /assignedAt:\s*null/);
});

test("batch list derives terminal counters from jobs instead of stale batch columns", () => {
  assert.match(autoPublishSource, /terminalCountRows[\s\S]*from\(publishingJobsTable\)/);
  assert.match(autoPublishSource, /needsReviewCount:\s*sql<number>`count\(\*\) filter \(where \$\{publishingJobsTable\.status\} = 'Needs Review'\)`/);
  assert.match(autoPublishSource, /completedCount:\s*terminalCounts\.completedCount/);
  assert.match(autoPublishSource, /needsReviewCount:\s*terminalCounts\.needsReviewCount/);
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

test("cancelled and dismissed batches do not block the auto-publish frequency gate", () => {
  assert.match(
    workerSource,
    /from\(publishingBatchesTable\)[\s\S]*eq\(publishingBatchesTable\.dealerId,\s*DEALER_ID\)[\s\S]*ne\(publishingBatchesTable\.status,\s*"Cancelled"\)[\s\S]*orderBy\(desc\(publishingBatchesTable\.createdAt\)\)/,
  );
  assert.match(
    workerSource,
    /from\(publishingBatchesTable\)[\s\S]*eq\(publishingBatchesTable\.dealerId,\s*DEALER_ID\)[\s\S]*ne\(publishingBatchesTable\.status,\s*"Dismissed"\)[\s\S]*orderBy\(desc\(publishingBatchesTable\.createdAt\)\)/,
  );
});

test("Alpha auth seeds the requested login and logout removes the access token in the UI", () => {
  assert.match(authSource, /const ALPHA_USERNAME = "alpha\.manassas"/);
  assert.match(authSource, /const ALPHA_PASSWORD = "Alpha2026"/);
  assert.match(authSource, /create table if not exists dealer_users/);
  assert.match(authSource, /dealer_id integer not null references dealers\(id\)/);
  assert.match(authGateSource, /const TOKEN_KEY = "dealerpilot\.sessionToken"/);
  assert.match(authGateSource, /authFetch\("\/auth\/logout", token/);
  assert.match(authGateSource, /localStorage\.removeItem\(TOKEN_KEY\)/);
  assert.match(authGateSource, /Log out/);
});

test("Marketplace pricing always posts the full vehicle price", () => {
  assert.match(pricingSource, /marketplaceDisplayedPrice: actualVehiclePrice/);
  assert.match(pricingSource, /priceMode: "FULL_PRICE"/);
  assert.doesNotMatch(pricingSource, /FULL_PRICE_THRESHOLD/);
  assert.doesNotMatch(pricingSource, /marketplaceDisplayedPrice:\s*(recommendedDownPayment|dp)/);
});

test("publishing payload prefers the latest ready AI photo set before raw images", () => {
  assert.match(publishingRepositorySource, /findLatestReadySetId/);
  assert.match(publishingRepositorySource, /eq\(aiPhotoSetsTable\.status,\s*"Ready"\)/);
  assert.match(publishingRepositorySource, /desc\(aiPhotoSetsTable\.isLatest\)/);
  assert.match(publishingRepositorySource, /source: "ai" as const/);
});

test("AI photo enhancement uses DealerPilot Vision Engine with strict fidelity validation", () => {
  assert.match(restorationSpecSource, /dealerpilot-photo-enhancement-v2/);
  assert.match(restorationSpecSource, /Super Resolution/);
  assert.match(restorationSpecSource, /Deblur/);
  assert.match(restorationSpecSource, /Noise Reduction/);
  assert.match(restorationSpecSource, /White Balance/);
  assert.match(restorationSpecSource, /Dynamic Range Recovery/);
  assert.match(restorationSpecSource, /Shadow Recovery/);
  assert.match(restorationSpecSource, /Micro Detail Enhancement/);
  assert.match(restorationSpecSource, /MIN_PHOTO_FIDELITY_SCORE = 9\.5/);
  assert.match(enhanceStageSource, /DealerPilot Vision Engine/);
  assert.match(enhanceStageSource, /VehicleGeometryFidelity|vehicleGeometryFidelity/);
  assert.match(enhanceStageSource, /restoreWithValidation/);
  assert.match(enhanceStageSource, /conservative/);
  assert.match(enhanceStageSource, /enhancement_rejected_original_preserved/);
  assert.match(enhanceStageSource, /photoFidelityFlags/);
  assert.match(openAiRestorationSource, /PHOTO_RESTORATION_ALLOW_GENERATIVE/);
  assert.match(openAiRestorationSource, /vision-engine/);
});

test("Sales AI intake writes Messenger messages to the CRM and Marketplace metrics", () => {
  assert.match(publisherFlowSource, /type: "CONVERSATION_INTAKE"/);
  assert.match(publisherFlowSource, /externalThreadRef/);
  assert.match(publisherFlowSource, /href="tel:\+17037634675"/);
  assert.match(conversationsSource, /\+1 703-763-4675/);
  assert.match(conversationsSource, /role:\s*"user"/);
  assert.match(conversationsSource, /syncMarketplaceListingMetrics/);
  assert.match(conversationsSource, /messagesReceived/);
  assert.match(conversationsSource, /unreadMessages/);
});

test("Sales AI empty state shows connected Facebook readiness instead of reconnecting", () => {
  assert.match(salesAiSource, /useGetConnectionStatus/);
  assert.match(salesAiSource, /facebookReady = extOnline && fbLoggedIn && mktConnected/);
  assert.match(salesAiSource, /Facebook Connected/);
  assert.match(salesAiSource, /Waiting for the first buyer message/);
  assert.match(salesAiSource, /Open Marketplace/);
  assert.match(salesAiSource, /Connect Facebook/);
});

test("extension closes Marketplace after a completed publish and respects scheduled spacing", () => {
  assert.match(queueClientSource, /async CLOSE_CURRENT_TAB/);
  assert.match(queueClientSource, /chrome\.tabs\.remove\(tabId\)/);
  assert.match(queueClientSource, /handler\(message,\s*_sender\)/);
  assert.match(publisherFlowSource, /closeMarketplaceTabSoon/);
  assert.match(publisherFlowSource, /type: "CLOSE_CURRENT_TAB"/);
  assert.match(queueClientSource, /scheduled_at_wait/);
  assert.match(queueClientSource, /Math\.max\(finishedMs \+ INTER_JOB_DELAY_MS/);
});

test("Marketplace vehicle category selector prefers the broad Vehicles option", () => {
  assert.match(publisherFlowSource, /"truck": "Car\/Truck"/);
  assert.match(publisherFlowSource, /"suv": "Car\/Truck"/);
  assert.match(publisherFlowSource, /"vehicles"/);
  assert.match(publisherFlowSource, /CAR_ALIASES\.some/);
});
