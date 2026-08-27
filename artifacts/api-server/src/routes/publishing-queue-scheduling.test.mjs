import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const routeSource = readFileSync(new URL("./publishing.ts", import.meta.url), "utf8");
const queueCompactionSource = readFileSync(
  new URL("../publishing/autoPublishQueueCompaction.ts", import.meta.url),
  "utf8",
);
const autoPublishSource = readFileSync(new URL("./autoPublish.ts", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../workers/publishing.worker.ts", import.meta.url), "utf8");
const staleCleanerSource = readFileSync(new URL("../publishing/staleCleaner.ts", import.meta.url), "utf8");
const publishingRepositorySource = readFileSync(
  new URL("../features/publishing/infrastructure/publishingRepository.ts", import.meta.url),
  "utf8",
);
const pricingSource = readFileSync(new URL("../listings/pricing.ts", import.meta.url), "utf8");
const listingGeneratorSource = readFileSync(new URL("../listings/generator.ts", import.meta.url), "utf8");
const opportunityEngineSource = readFileSync(new URL("../intelligence/opportunityEngine.ts", import.meta.url), "utf8");
const conversationsSource = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");
const authSource = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const extensionRouteSource = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
const marketplaceListingsSource = readFileSync(new URL("./marketplaceListings.ts", import.meta.url), "utf8");
const vehiclesRouteSource = readFileSync(new URL("./vehicles.ts", import.meta.url), "utf8");
const soldStateSource = readFileSync(new URL("../marketplace/soldState.ts", import.meta.url), "utf8");
const controlledModeSource = readFileSync(new URL("../publishing/controlledMode.ts", import.meta.url), "utf8");
const listingsRouteSource = readFileSync(new URL("./listings.ts", import.meta.url), "utf8");
const queueClientSource = readFileSync(
  new URL("../../../../chrome-extension/src/background/queueClient.js", import.meta.url),
  "utf8",
);
const publisherFlowSource = readFileSync(
  new URL("../../../../chrome-extension/src/content/facebook/publisherFlow.js", import.meta.url),
  "utf8",
);
const messengerClientSource = readFileSync(
  new URL("../../../../chrome-extension-messenger/src/background/messengerClient.js", import.meta.url),
  "utf8",
);
const messengerAiSource = readFileSync(
  new URL("../../../../chrome-extension-messenger/src/content/facebook/messengerAi.js", import.meta.url),
  "utf8",
);
const messengerPopupSource = readFileSync(
  new URL("../../../../chrome-extension-messenger/popup/popup.html", import.meta.url),
  "utf8",
);
const batchProgressCardSource = readFileSync(
  new URL("../../../dashboard/src/features/listings/components/BatchProgressCard.tsx", import.meta.url),
  "utf8",
);
const listingsWorkspaceSource = readFileSync(
  new URL("../../../dashboard/src/features/listings/components/ListingsWorkspaceContent.tsx", import.meta.url),
  "utf8",
);
const publishedCardSource = readFileSync(
  new URL("../../../dashboard/src/features/listings/components/PublishedCard.tsx", import.meta.url),
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
const pagesWorkerSource = readFileSync(
  new URL("../pages/pagesPublishing.worker.ts", import.meta.url),
  "utf8",
);
const pagesRouteSource = readFileSync(new URL("./pages.ts", import.meta.url), "utf8");
const pagesWorkspaceSource = readFileSync(
  new URL("../../../dashboard/src/features/pages/pagesWorkspace.tsx", import.meta.url),
  "utf8",
);
const dailyPlanSource = readFileSync(
  new URL("../../../dashboard/src/lib/dailyPlan.ts", import.meta.url),
  "utf8",
);
const restorationSpecSource = readFileSync(
  new URL("../photo/restorationSpec.ts", import.meta.url),
  "utf8",
);
const photoStudioRouteSource = readFileSync(
  new URL("./photoStudio.ts", import.meta.url),
  "utf8",
);
const photoAutoEnqueueSource = readFileSync(
  new URL("../photo/autoEnqueue.ts", import.meta.url),
  "utf8",
);
const photoPublishReadinessSource = readFileSync(
  new URL("../photo/publishReadiness.ts", import.meta.url),
  "utf8",
);
const photoQueueWorkerSource = readFileSync(
  new URL("../workers/photo.worker.ts", import.meta.url),
  "utf8",
);
const photoPipelineSource = readFileSync(
  new URL("../photo/pipeline.ts", import.meta.url),
  "utf8",
);
const orchestratorSource = readFileSync(
  new URL("../workers/orchestrator.ts", import.meta.url),
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
const openAiImageClientSource = readFileSync(
  new URL("../../../../lib/integrations-openai-ai-server/src/image/client.ts", import.meta.url),
  "utf8",
);
const openAiClassifierSource = readFileSync(
  new URL("../photo/providers/openai.ts", import.meta.url),
  "utf8",
);
const photoExportSource = readFileSync(
  new URL("../photo/stages/7_export.ts", import.meta.url),
  "utf8",
);
const photoWorkerRuntimeSource = readFileSync(
  new URL("../photo/worker.ts", import.meta.url),
  "utf8",
);
const photoPublishingHandoffSource = readFileSync(
  new URL("../photo/publishingHandoff.ts", import.meta.url),
  "utf8",
);
const photoSetViewerSource = readFileSync(
  new URL("../../../dashboard/src/features/photo-studio/components/PhotoSetViewer.tsx", import.meta.url),
  "utf8",
);
const photoDirectorSource = readFileSync(
  new URL("../photo/photoDirector.ts", import.meta.url),
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

test("assigned polling repairs due jobs after the extension identifier changes", () => {
  assert.match(routeSource, /if \(online\?\.chrome_extension_id === extensionId\)/);
  assert.match(routeSource, /set\(\{ assignedExtensionId: extensionId, assignedAt: new Date\(\) \}\)/);
  assert.match(
    routeSource,
    /eq\(publishingJobsTable\.status,\s*"Assigned"\)[\s\S]*isNull\(publishingJobsTable\.claimedByExtension\)[\s\S]*lte\(publishingJobsTable\.scheduledAt,\s*new Date\(\)\)/,
  );
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

test("Publish Now cleanup cannot cancel scheduled or automatic batch jobs", () => {
  assert.match(
    routeSource,
    /Cancel stale direct Publish Now jobs[\s\S]*eq\(publishingJobsTable\.source,\s*"publish_now"\)[\s\S]*lt\(publishingJobsTable\.createdAt,\s*STALE_THRESHOLD\)/,
  );
});

test("publishing worker rebinds due unclaimed jobs after the Chrome extension id changes", () => {
  assert.match(workerSource, /rebindDueAssignedJobsToOnlineExtension/);
  assert.match(workerSource, /eq\(publishingJobsTable\.status,\s*"Assigned"\)/);
  assert.match(workerSource, /ne\(publishingJobsTable\.assignedExtensionId,\s*extensionId\)/);
  assert.match(workerSource, /Publishing worker rebound unclaimed jobs to the active extension/);
});

test("publishing worker repairs legacy stale assignments before selecting the next vehicle", () => {
  assert.match(workerSource, /repairLegacyStaleAssignedJobs/);
  assert.match(workerSource, /status:\s*"Retry"/);
  assert.match(workerSource, /failedReason} like 'Auto-expired:%'/);
  assert.match(workerSource, /Publishing worker repaired legacy stale assignments back to Retry/);
});

test("automatic batching isolates active vehicles instead of blocking the next candidates", () => {
  assert.match(workerSource, /select\(\{ vehicleId: publishingJobsTable\.vehicleId \}\)/);
  assert.match(workerSource, /const activeVehicleIds = new Set\(activeJobs\.map\(\(job\) => job\.vehicleId\)\);/);
  assert.match(workerSource, /isolating those vehicles so the next candidates can continue/);
  assert.match(workerSource, /if \(activeVehicleIds\.has\(vehicle\.id\)\) return null;/);
  assert.doesNotMatch(workerSource, /if \(activeJobs\.length > 0\) \{\s*return \{ created: 0, summary:/);
});

test("automatic selection excludes vehicles whose latest publishing job is Needs Review", () => {
  assert.match(autoPublishSource, /findLatestNeedsReviewVehicleIds/);
  assert.match(autoPublishSource, /needsReviewVehicleIds\.has\(v\.id\)/);
  assert.match(autoPublishSource, /Latest publishing job is Needs Review/);
  assert.match(workerSource, /findLatestNeedsReviewVehicleIds/);
  assert.match(workerSource, /needsReviewVehicleIds\.has\(vehicle\.id\)/);
});

test("marking a job Published clears stale review metadata", () => {
  assert.match(routeSource, /status: "Published"[\s\S]*needsReview: false[\s\S]*reviewReason: null/);
  assert.match(routeSource, /already Published[\s\S]*set\(\{ needsReview: false, reviewReason: null \}\)/);
});

test("Alpha inventory normalizes every non-empty legacy lot to Manassas", () => {
  assert.match(controlledModeSource, /function normalizeAlphaLotLocation\(lotLocation: string \| null\)/);
  assert.match(controlledModeSource, /return lotLocation && lotLocation\.trim\(\) \? "Manassas" : null/);
  assert.match(workerSource, /normalizeAlphaInventoryAndRequeueLotReviews/);
  assert.match(workerSource, /set\(\{ lotLocation: "Manassas" \}\)/);
  assert.match(workerSource, /payload failed: 422/);
});

test("extension records the next queue vehicle and clears terminal local jobs", () => {
  assert.match(queueClientSource, /lastQueueDecision/);
  assert.match(queueClientSource, /QUEUE_NEXT_OBSERVED/);
  assert.match(queueClientSource, /secondsUntilEligible/);
  assert.match(queueClientSource, /\["Published", "Failed", "Cancelled", "Needs Review"\]/);
});

test("scheduled jobs expire relative to their scheduled slot instead of batch creation", () => {
  assert.match(
    staleCleanerSource,
    /coalesce\(\$\{publishingJobsTable\.scheduledAt\},\s*\$\{publishingJobsTable\.createdAt\}\)/,
  );
});

test("extension recreates its scheduled-job polling alarm after Chrome clears it", () => {
  assert.match(queueClientSource, /async function ensurePollAssignedAlarm\(\)/);
  assert.match(queueClientSource, /await chrome\.alarms\.get\("pollAssigned"\)/);
  assert.match(queueClientSource, /ensurePollAssignedAlarm\(\)\.catch/);
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
  assert.match(autoPublishSource, /skippedCount:\s*sql<number>`count\(\*\) filter \(where \$\{publishingJobsTable\.status\} in \('Skipped', 'Cancelled'\)\)`/);
  assert.match(autoPublishSource, /status:\s*derivedProgress\?\.isDone \? derivedProgress\.status : row\.status/);
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
  assert.match(
    autoPublishSource,
    /if \(mode === "Controlled" && jobs\.some\(\(job\) => job\.status === "Queued"\)\) \{[\s\S]*runWorkerOnce\(publishingWorker,\s*req\.log,\s*"manual",\s*null\)/,
  );
});

test("Controlled Auto stays automatic without requiring a second deployment switch", () => {
  assert.match(controlledModeSource, /if \(isFullAutoMode\(\) \|\| dealerAutoClickPublish\) return "Controlled"/);
  assert.match(routeSource, /job\.source === "publish_now"[\s\S]*resolvePublishMode\(autoPublishSettings\?\.autoClickPublish \?\? false\)/);
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
  assert.match(authSource, /const ALPHA_INITIAL_PASSWORD = process\.env\.ALPHA_INITIAL_PASSWORD/);
  assert.match(authSource, /create table if not exists dealer_users/);
  assert.match(authSource, /create table if not exists auth_events/);
  assert.match(authSource, /dealer_id integer not null references dealers\(id\)/);
  assert.match(authSource, /router\.post\("\/auth\/change-password"/);
  assert.match(authSource, /passwordPolicyErrors/);
  assert.match(authSource, /removeUserSessions\(user\.id\)/);
  assert.match(authSource, /MAX_LOGIN_FAILURES = 5/);
  assert.match(authSource, /login_failed/);
  assert.doesNotMatch(authSource, /verifyPassword\(ALPHA_INITIAL_PASSWORD, existing\.password_hash\)/);
  assert.match(authGateSource, /const TOKEN_KEY = "dealerpilot\.sessionToken"/);
  assert.match(authGateSource, /ChangePasswordPanel/);
  assert.match(authGateSource, /\/auth\/change-password/);
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

test("Marketplace publishing puts persisted down payment in the title", () => {
  assert.match(pricingSource, /export function buildMarketplaceTitle/);
  assert.match(pricingSource, /DE ENGANCHE/);
  assert.match(routeSource, /buildMarketplaceTitle\(vehicle, publicationDownPayment\)/);
  assert.match(routeSource, /price: pricing\.marketplaceDisplayedPrice/);
});

test("publishing payload sends friendly bilingual Marketplace descriptions", () => {
  assert.match(routeSource, /buildBilingualMarketplaceDescription/);
  assert.match(routeSource, /English/);
  assert.match(routeSource, /Español/);
  assert.match(routeSource, /descriptionEs: fillDescriptionEs/);
  assert.match(routeSource, /Call \+1 703-763-4675/);
  assert.match(listingGeneratorSource, /PUBLIC MARKETPLACE COPY/);
  assert.match(listingGeneratorSource, /bilingual Marketplace descriptions/);
  assert.match(listingGeneratorSource, /Use tasteful emojis/);
});

test("daily plan ranking prioritizes click-friendly Marketplace fit", () => {
  assert.match(dailyPlanSource, /marketplaceFitAdjustment/);
  assert.match(dailyPlanSource, /TRUST_LEADER_MAKES = new Set\(\["toyota", "honda"\]\)/);
  assert.match(dailyPlanSource, /price >= 7_000 && price < 16_000/);
  assert.match(dailyPlanSource, /High-click Marketplace price range/);
  assert.match(dailyPlanSource, /segment\.includes\("ev"\)/);
});

test("opportunity and auto-publish scoring reward accessible mainstream vehicles", () => {
  assert.match(opportunityEngineSource, /computeMarketplaceFitAdjustment/);
  assert.match(opportunityEngineSource, /Toyota\/Honda trust signal/);
  assert.match(opportunityEngineSource, /Luxury price band - lower Facebook Marketplace click fit/);
  assert.match(autoPublishSource, /price >= 7000 && price < 16000\) priceBonus = 22/);
  assert.match(workerSource, /price >= 7000 && price < 16000 \? 22/);
});

test("publishing payload uses approved Photo Director handoff when available", () => {
  assert.match(publishingRepositorySource, /export async function getVehiclePhotos/);
  assert.match(publishingRepositorySource, /export async function getVehicleRawPhotos/);
  assert.match(publishingRepositorySource, /const MARKETPLACE_PHOTO_LIMIT = 10/);
  assert.match(publishingRepositorySource, /function limitMarketplacePhotos/);
  assert.match(publishingRepositorySource, /\.slice\(0,\s*MARKETPLACE_PHOTO_LIMIT\)/);
  assert.match(publishingRepositorySource, /img\.processingStatus !== "Failed"/);
  assert.match(routeSource, /const images = await getVehiclePhotos\(vehicle\.id, vehicle\.aiPhotoSetId, vehicle\.aiPhotoStatus\)/);
  assert.match(routeSource, /const usingAiPhotos = images\.some\(\(image\) => image\.source === "ai"\)/);
  assert.match(routeSource, /const images = await getVehiclePhotos\(/);
  assert.match(publisherFlowSource, /const DEFAULT_MAX = 10/);
  assert.doesNotMatch(publisherFlowSource, /const DEFAULT_MAX = 20/);
});

test("publishing jobs wait for Photo Director before reaching Marketplace", () => {
  assert.match(photoPublishReadinessSource, /export async function ensurePhotoDirectorReadyForPublish/);
  assert.match(photoPublishReadinessSource, /isPhotoDirectorReadyForPublish/);
  assert.match(photoPublishReadinessSource, /PHOTO_DIRECTOR_WAITING_REASON/);
  assert.match(photoPublishReadinessSource, /presetVersionForMode\("balanced", \[\], \[\], \[\], "balanced"\)/);
  assert.match(photoPublishReadinessSource, /\.insert\(aiPhotoJobsTable\)/);
  assert.match(photoPublishReadinessSource, /priority: -5/);
  assert.match(routeSource, /deferPublishingJobForPhotoDirector/);
  assert.match(routeSource, /Publish Now job created and deferred until Photo Director is ready/);
  assert.match(routeSource, /status: "Scheduled"[\s\S]*currentStep: "Waiting for Photo Director"[\s\S]*source: "publish_now"/);
  assert.match(routeSource, /Publishing payload blocked until Photo Director is ready/);
  assert.match(routeSource, /Bulk-schedule deferred vehicles until Photo Director is ready/);
  assert.match(autoPublishSource, /ensurePhotoDirectorReadyForPublish\(v, req\.log\)/);
  assert.match(autoPublishSource, /photoDirectorPublishBlockReason\(v\)/);
  assert.match(workerSource, /ensurePhotoDirectorReadyForPublish\(entry\.vehicle, log\)/);
  assert.match(workerSource, /deferJobForPhotoDirector/);
  assert.match(workerSource, /Publishing worker deferred job until Photo Director is ready/);
  assert.match(photoPublishingHandoffSource, /releasePublishingJobsWaitingForPhotoDirector/);
  assert.match(photoPublishingHandoffSource, /status: "Queued"[\s\S]*currentStep: "Queued"[\s\S]*failedReason: null/);
  assert.match(photoExportSource, /releasePublishingJobsWaitingForPhotoDirector\(ctx\.job\.vehicleId\)/);
  assert.match(photoWorkerRuntimeSource, /runWorkerOnce\(publishingWorker/);
});

test("inventory worker is anchored to the daily 10 AM dealer-local sync window", () => {
  assert.match(orchestratorSource, /const INVENTORY_SYNC_TIME_ZONE = "America\/New_York"/);
  assert.match(orchestratorSource, /const INVENTORY_SYNC_HOUR = 10/);
  assert.match(orchestratorSource, /function nextInventorySyncAtAfter/);
  assert.match(orchestratorSource, /function currentInventorySyncWindow/);
  assert.match(orchestratorSource, /daily 10:00 AM inventory sync is due/);
  assert.doesNotMatch(orchestratorSource, /last sync \$\{state\?\.lastRunAt \? "over 24h ago" : "never ran"\}/);
});

test("Marketplace live-list reconciliation can keep confirmed vehicles and demote missing live rows", () => {
  assert.match(marketplaceListingsSource, /\/marketplace-listings\/reconcile-published/);
  assert.match(marketplaceListingsSource, /publishedVehicleIds/);
  assert.match(marketplaceListingsSource, /demoteIds/);
  assert.match(marketplaceListingsSource, /\.insert\(marketplaceListingsTable\)/);
  assert.match(marketplaceListingsSource, /target: \[marketplaceListingsTable\.vehicleId\]/);
  assert.match(marketplaceListingsSource, /\.insert\(listingsTable\)/);
  assert.match(marketplaceListingsSource, /target: \[listingsTable\.vehicleId, listingsTable\.channel\]/);
  assert.match(marketplaceListingsSource, /keptLiveVehicleIds/);
  assert.match(marketplaceListingsSource, /demotedVehicleIds/);
});

test("listing workspace does not show stale published jobs as live without Marketplace proof", () => {
  assert.match(listingsRouteSource, /const latestJobHasLiveProof =/);
  assert.match(listingsRouteSource, /Boolean\(latestJob\.listingUrl\)/);
  assert.match(listingsRouteSource, /!marketplaceListing \|\| marketplaceListing\.status === "Live"/);
  assert.match(listingsRouteSource, /const isPublishedFromSource = isMarketplaceLive \|\| hasPublishedListing \|\| latestJobHasLiveProof/);
  assert.match(listingsRouteSource, /latestJob\?\.status === "Published" && !isPublishedFromSource[\s\S]*"Needs Review"/);
  assert.match(listingsRouteSource, /const isPublished = publishStatus === "Published"/);
});

test("sold inventory feeds Marketplace and extension state so vehicles cannot be republished", () => {
  assert.match(soldStateSource, /export async function syncSoldMarketplaceState/);
  assert.match(soldStateSource, /marketplaceListingsTable[\s\S]*\.set\(\{ status: "Sold", notes: note, updatedAt: now \}\)/);
  assert.match(soldStateSource, /listingsTable[\s\S]*\.set\(\{ status: "Sold", updatedAt: now \}\)/);
  assert.match(soldStateSource, /publishingJobsTable[\s\S]*status: "Cancelled"[\s\S]*Vehicle marked Sold\/Removed in DealerPilot inventory/);
  assert.match(vehiclesRouteSource, /syncSoldMarketplaceState/);
  assert.match(vehiclesRouteSource, /const soldSync = action === "mark_sold"[\s\S]*syncSoldMarketplaceState\(updated\.map\(\(v\) => v\.id\), "manual"\)/);
  assert.match(vehiclesRouteSource, /const soldSync = parsed\.data\.status === "Sold\/Removed"[\s\S]*syncSoldMarketplaceState\(\[id\], "manual"\)/);
  assert.match(extensionRouteSource, /\/extension\/marketplace-sold-actions/);
  assert.match(extensionRouteSource, /eq\(marketplaceListingsTable\.status, "Sold"\)/);
  assert.match(extensionRouteSource, /eq\(vehiclesTable\.status, "Sold\/Removed"\)/);
  assert.match(queueClientSource, /apiGet\("\/api\/extension\/marketplace-sold-actions"\)/);
  assert.match(queueClientSource, /activeSoldAction: action/);
  assert.match(queueClientSource, /MARKETPLACE_SOLD_ACTION_OPENED/);
  assert.match(publisherFlowSource, /const isMarketplaceItem = \/\\\/marketplace\\\/item\\\//);
  assert.match(publisherFlowSource, /async function runMarketplaceSoldAction\(\)/);
  assert.match(publisherFlowSource, /currentPageMatchesSoldAction\(activeSoldAction\)/);
  assert.match(publisherFlowSource, /"mark as sold"/);
  assert.match(publisherFlowSource, /"marcar como vendido"/);
  assert.match(publisherFlowSource, /soldActionCompletedId/);
  assert.match(controlledModeSource, /NOT_ELIGIBLE_STATUSES = new Set\(\["Published", "Sold\/Removed", "Sold", "Removed", "Archived"\]\)/);
  assert.match(routeSource, /\["Published", "Sold\/Removed", "Sold", "Removed", "Archived"\]\.includes\(v\.status\)/);
});

test("publishing cockpit shows only the primary owner-requested tabs and compact live cards", () => {
  assert.match(listingsWorkspaceSource, /PRIMARY_TABS = new Set\(\["ready", "scheduled", "published", "failed", "to-remove", "all"\]\)/);
  assert.match(listingsWorkspaceSource, /<TabsTrigger value="to-remove"/);
  assert.match(listingsWorkspaceSource, /ToRemovePanel/);
  assert.match(listingsWorkspaceSource, /"needs-update": "published"/);
  assert.match(listingsWorkspaceSource, /Live \{countBadge\(publishedWorkspacesCount\)\}/);
  assert.match(listingsWorkspaceSource, /Schedule \{countBadge\(scheduledCount\)\}/);
  assert.doesNotMatch(listingsWorkspaceSource, /<TabsTrigger value="generating"/);
  assert.doesNotMatch(listingsWorkspaceSource, /<TabsTrigger value="needs-update"/);
  assert.doesNotMatch(listingsWorkspaceSource, /<TabsTrigger value="sold"/);
  assert.doesNotMatch(listingsWorkspaceSource, /<TabsTrigger value="queue"/);
  assert.match(listingsWorkspaceSource, /lg:grid-cols-4 2xl:grid-cols-5 gap-4/);
  assert.match(publishedCardSource, /rounded-lg bg-card/);
  assert.match(publishedCardSource, /aspect-\[16\/9\]/);
  assert.match(publishedCardSource, /p-3 flex flex-col flex-1/);
});

test("AI photo enhancement uses DealerPilot Vision Engine with strict fidelity validation", () => {
  assert.match(restorationSpecSource, /dealerpilot-photo-enhancement-v4-gpt-image-2-premium-marketplace/);
  assert.match(restorationSpecSource, /professional automotive inventory photo retoucher/);
  assert.match(restorationSpecSource, /Cars\.com, AutoTrader/);
  assert.match(restorationSpecSource, /Preserve the exact vehicle geometry/);
  assert.match(restorationSpecSource, /exact OEM paint color/);
  assert.match(restorationSpecSource, /chrome brightness/);
  assert.match(restorationSpecSource, /avoid over-brightening white walls/);
  assert.match(restorationSpecSource, /not an AI-generated image/);
  assert.match(restorationSpecSource, /MIN_PHOTO_FIDELITY_SCORE = 9\.5/);
  assert.match(enhanceStageSource, /DealerPilot Vision Engine/);
  assert.match(enhanceStageSource, /VehicleGeometryFidelity|vehicleGeometryFidelity/);
  assert.match(enhanceStageSource, /restoreWithValidation/);
  assert.match(enhanceStageSource, /authorizedPhotoIds\.length > 0/);
  assert.match(enhanceStageSource, /photo_director_paid_ai_selected/);
  assert.match(enhanceStageSource, /photoDirectorMode === "balanced" \|\| photoDirectorMode === "premium"/);
  assert.match(enhanceStageSource, /photoDirectorMode === "economy"/);
  assert.match(enhanceStageSource, /localEnhancementPhotoIdsFromPresetVersion/);
  assert.match(enhanceStageSource, /local_enhancement_too_subtle_original_preserved/);
  assert.match(enhanceStageSource, /paid_restoration_not_selected_for_this_photo/);
  assert.match(enhanceStageSource, /conservative/);
  assert.match(enhanceStageSource, /enhancement_rejected_original_preserved/);
  assert.match(enhanceStageSource, /photoFidelityFlags/);
  assert.match(enhanceStageSource, /localVisionNoImprovement/);
  assert.match(openAiRestorationSource, /PHOTO_RESTORATION_ALLOW_GENERATIVE/);
  assert.match(openAiRestorationSource, /PHOTO_RESTORATION_PROVIDER.*openai/s);
  assert.match(openAiRestorationSource, /gpt-image-2/);
  assert.match(openAiRestorationSource, /disabled/);
  assert.match(openAiImageClientSource, /PHOTO_RESTORATION_OPENAI_QUALITY/);
  assert.match(openAiImageClientSource, /PHOTO_RESTORATION_OPENAI_MODEL/);
  assert.match(openAiImageClientSource, /quality/);
  assert.match(openAiImageClientSource, /output_format/);
  assert.match(openAiClassifierSource, /data:image\/jpeg;base64/);
  assert.match(openAiClassifierSource, /toOpenAiDataUrl/);
  assert.match(openAiClassifierSource, /response_format: \{ type: "json_object" \}/);
  assert.match(photoExportSource, /processingStatus: img\.processingStatus === "Failed" \? "Failed" : "Completed"/);
  assert.match(photoSetViewerSource, /function FallbackImage/);
  assert.match(photoSetViewerSource, /fallbackSrc/);
});

test("Photo Director improves the selected ten by plan and builds selected-photo handoff", () => {
  assert.match(photoDirectorSource, /PhotoDirectorMode = "economy" \| "balanced" \| "premium"/);
  assert.match(photoDirectorSource, /PHOTO_DIRECTOR_COST_CAPS_USD/);
  assert.match(photoDirectorSource, /balanced: 1\.5/);
  assert.match(photoDirectorSource, /premium: 1\.5/);
  assert.match(photoDirectorSource, /return 10/);
  assert.match(photoDirectorSource, /input\.mode === "economy"[\s\S]*"LOCAL_ENHANCEMENT"[\s\S]*"PAID_AI_RESTORATION"/);
  assert.match(photoDirectorSource, /PAID_AI_RESTORATION/);
  assert.match(photoDirectorSource, /localEnhancementPhotoIds/);
  assert.match(photoStudioRouteSource, /presetVersionForMode\([\s\S]*selectionMode/);
  assert.match(photoPipelineSource, /photoDirectorModeFromPresetVersion/);
  assert.match(photoPipelineSource, /applyPhotoDirectorSelection/);
  assert.match(photoPipelineSource, /stage\.name === "Classify"[\s\S]*applyPhotoDirectorSelection/);
  assert.match(photoStudioRouteSource, /buildPhotoDirectorPlan/);
  assert.match(photoStudioRouteSource, /getPhotoDirectorSourceSet/);
  assert.match(photoStudioRouteSource, /desc\(aiPhotoSetsTable\.totalPhotos\)/);
  assert.match(photoStudioRouteSource, /paidAiRestorationPhotoIds/);
  assert.match(photoStudioRouteSource, /localEnhancementPhotoIds/);
  assert.match(photoStudioRouteSource, /defaultCostCapUsd/);
  assert.match(photoStudioRouteSource, /sourceSetId/);
});

test("manual photo reprocess stays pinned to the selected vehicle", () => {
  assert.match(photoStudioRouteSource, /async function getActivePhotoJob\(vehicleId: number\)/);
  assert.match(photoStudioRouteSource, /eq\(aiPhotoJobsTable\.vehicleId,\s*vehicleId\)/);
  assert.match(photoStudioRouteSource, /inArray\(aiPhotoJobsTable\.status,\s*\["Queued",\s*"Processing"\]\)/);
  assert.match(photoStudioRouteSource, /activeJobs\.find\(\(job\) => job\.status === "Processing"\)/);
  assert.match(photoStudioRouteSource, /res\.status\(202\)\.json\(\{\s*job,\s*reused: true,/);
  assert.match(photoStudioRouteSource, /selectedPhotoIds: processingPhotos\.selectedPhotoIds/);
  assert.match(photoStudioRouteSource, /sourceSetId: processingPhotos\.sourceSetId/);
  assert.match(photoStudioRouteSource, /priority:\s*-10/);
  assert.match(photoStudioRouteSource, /manual trigger = highest priority for this vehicle/);
});

test("automatic photo queueing is disabled unless explicitly enabled", () => {
  assert.match(photoAutoEnqueueSource, /PHOTO_AUTO_ENQUEUE_ON_IMPORT/);
  assert.match(photoAutoEnqueueSource, /!opts\.force && !isAutoEnqueueEnabled\(\)/);
  assert.match(photoAutoEnqueueSource, /photo:auto-enqueue skipped - disabled by default/);
  assert.match(photoQueueWorkerSource, /PHOTO_AUTO_QUEUE_WORKER_ENABLED/);
  assert.match(photoQueueWorkerSource, /enabled:\s*isPhotoAutoQueueWorkerEnabled\(\)/);
  assert.match(orchestratorSource, /automatic photo queue disabled - photos run per selected vehicle/);
});

test("Sales AI intake is owned by the Messenger AI extension and backend contract", () => {
  assert.doesNotMatch(queueClientSource, /ensureSalesAiMonitorTab|SALES_AI_MONITOR_TAB_OPENED|CONVERSATION_INTAKE/);
  assert.doesNotMatch(publisherFlowSource, /initMessengerAiControls|Read Chat|lastMessengerCaptureHash|findMessengerSendButton/);
  assert.match(messengerClientSource, /CONVERSATION_INTAKE/);
  assert.match(messengerClientSource, /\/api\/conversations\/intake/);
  assert.match(messengerClientSource, /lastConversationIntake/);
  assert.match(messengerClientSource, /lastError/);
  assert.match(messengerAiSource, /dry_run_capture/);
  assert.match(messengerAiSource, /auto_reply_disabled/);
  assert.match(messengerAiSource, /composer_missing/);
  assert.match(messengerAiSource, /rawError/);
  assert.match(messengerPopupSource, /AI Debugger/);
  assert.match(messengerPopupSource, /Specific Error/);
  assert.match(messengerPopupSource, /Raw Error/);
  assert.match(messengerPopupSource, /Manual fallback reply/);
  assert.match(messengerPopupSource, /Show Debug Object/);
  assert.match(messengerAiSource, /manual_reply_after_buyer/);
  assert.match(messengerAiSource, /freshSnapshotStillPendingBuyer/);
  assert.match(conversationsSource, /parseConversationMessage/);
  assert.match(conversationsSource, /function normalizeIntentText/);
  assert.match(conversationsSource, /ubicad\[oa\]s\?/);
  assert.match(conversationsSource, /Estamos en \$\{storeAddress\}/);
  assert.match(conversationsSource, /9120 Euclid Ave, Manassas, VA 20110/);
  assert.match(conversationsSource, /Alpha Motorsports serves customers from Manassas only/);
  assert.match(conversationsSource, /legacyLocationToken/);
  assert.match(conversationsSource, /UI_MESSAGE_TEXT/);
  assert.match(conversationsSource, /isParticipantLabelText/);
  assert.match(conversationsSource, /buyer\|seller\|participant\|miembro\|comprador\|vendedor/);
  assert.match(conversationsSource, /send in messenger/);
  assert.match(conversationsSource, /anyone can find this group/);
  assert.match(conversationsSource, /isReliableBuyerName/);
  const buyerNameGuardSource = conversationsSource.match(/function isReliableBuyerName[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(buyerNameGuardSource, /UI_MESSAGE_TEXT\.has\(normalized\)/);
  assert.doesNotMatch(buyerNameGuardSource, /isUiConversationText\(cleaned\)/);
  assert.match(conversationsSource, /isBlockedFacebookSurface/);
  assert.match(conversationsSource, /resolveMarketplaceIntakeSourceUrl/);
  assert.match(conversationsSource, /https:\/\/www\.facebook\.com\/marketplace\/inbox/);
  assert.match(conversationsSource, /isBlockedFacebookSurface\(resolvedSourceUrl\)/);
  assert.match(conversationsSource, /sourceUrl:\s*resolvedSourceUrl \?\? existingConv\.sourceUrl/);
  assert.match(conversationsSource, /invalid Marketplace Sales AI context/);
  assert.match(conversationsSource, /blocked_facebook_surface/);
  assert.match(conversationsSource, /buyer_name_missing/);
  assert.match(conversationsSource, /normalizeVehicleTitle/);
  assert.match(conversationsSource, /extractMarketplaceItemId/);
  assert.match(conversationsSource, /marketplaceListingsTable\.facebookListingId/);
  assert.match(conversationsSource, /exactTitles\.includes\(normalizedDetectedTitle\)/);
  assert.match(conversationsSource, /vehicleMatchSource/);
  assert.match(conversationsSource, /preserved existing vehicle binding over unverified DOM title match/);
  assert.match(conversationsSource, /vehicleMatchSource !== "marketplace_listing_url"/);
  assert.match(conversationsSource, /Conversation intake skipped - no buyer message/);
  assert.match(conversationsSource, /SALES_AI_REPLY_TIMEOUT_MS = 12000/);
  assert.match(conversationsSource, /MESSENGER_DELIVERY_RETRY_DELAY_MS = 15000/);
  assert.match(conversationsSource, /resolveSalesReplyStage/);
  assert.match(conversationsSource, /extractPhoneNumber/);
  assert.match(conversationsSource, /isAiReplyAligned/);
  assert.match(conversationsSource, /isReplyLanguageMirrored/);
  assert.match(conversationsSource, /Mirror the latest buyer message language exactly/);
  assert.match(conversationsSource, /Never write a bilingual reply/);
  assert.match(conversationsSource, /estoy\|interesad\[oa\]s\?/);
  assert.match(conversationsSource, /const language = detectLanguage\(inbound\);/);
  assert.doesNotMatch(conversationsSource, /detectLanguage\(inbound \+ " " \+ \(buyerName/);
  const spanishWordsLiteral = conversationsSource.match(
    /const spanishWords\s*=\s*(\/[^\n]+\/i);/,
  )?.[1];
  assert.ok(spanishWordsLiteral);
  const spanishWords = vm.runInNewContext(spanishWordsLiteral);
  assert.equal(spanishWords.test("Estoy interesado"), true);
  assert.equal(spanishWords.test("claro que sí, ¿cómo podemos ayudarte?"), true);
  assert.equal(spanishWords.test("I am interested"), false);
  assert.match(conversationsSource, /Hello, this is Alpha Motorsports/);
  assert.match(conversationsSource, /What would you like to know/);
  assert.match(conversationsSource, /QUALIFICATION FUNNEL FOR ALPHA MANASSAS/);
  assert.match(conversationsSource, /Approved Down-Payment Configuration/);
  assert.match(conversationsSource, /conversation history is never a source/);
  assert.match(conversationsSource, /buildDownPaymentInstruction/);
  assert.doesNotMatch(conversationsSource, /\$1,000|\$2,000|\$3,000/);
  assert.match(conversationsSource, /this week or this month/);
  assert.match(conversationsSource, /in 15 days/);
  assert.match(conversationsSource, /en 15 dias/);
  assert.match(conversationsSource, /next month/);
  assert.match(conversationsSource, /el otro mes/);
  assert.match(conversationsSource, /valid ID and proof of income/);
  assert.match(conversationsSource, /qualified_exit/);
  assert.doesNotMatch(conversationsSource, /Fredericksburg/);
  assert.match(conversationsSource, /inventory_options/);
  assert.match(conversationsSource, /buyerAskedInventoryOptions/);
  assert.match(conversationsSource, /tenemos más vehículos disponibles/);
  assert.match(conversationsSource, /Do not ask for requirements yet/);
  assert.match(conversationsSource, /price_inquiry/);
  assert.match(conversationsSource, /buyerAskedPriceInquiry/);
  assert.match(conversationsSource, /Do not provide a number/);
  assert.match(conversationsSource, /isFirstDealerReply/);
  assert.match(conversationsSource, /withFirstReplyGreeting/);
  assert.match(conversationsSource, /First reply instruction/);
  assert.match(conversationsSource, /Start with a warm greeting as Alpha Motorsports/);
  assert.match(conversationsSource, /financing_intro/);
  assert.match(conversationsSource, /financing_declined/);
  assert.match(conversationsSource, /cash_visit_request_phone/);
  assert.match(conversationsSource, /buyerRequestedVisitOrTestDrive/);
  assert.match(conversationsSource, /historyShowsFinancingDeclined/);
  assert.match(conversationsSource, /urgent_vehicle_request_phone/);
  assert.match(conversationsSource, /hasPersistentUnansweredBuyerTurns/);
  assert.match(conversationsSource, /consecutiveBuyerMessages\.length >= 3/);
  assert.match(conversationsSource, /structured\.urgency === "high"/);
  assert.match(conversationsSource, /structured\.vehicleIntent === "strong"/);
  assert.match(conversationsSource, /weekday or the weekend|entre semana|fin de semana/);
  assert.match(conversationsSource, /Skip the normal funnel/);
  assert.match(conversationsSource, /best phone number/);
  assert.match(conversationsSource, /historyRequestedPhone/);
  assert.match(conversationsSource, /formatConversationHistoryForAi/);
  assert.match(conversationsSource, /const conversationHistoryForAi = \[\.\.\.existingChronological, \.\.\.newMessages\]/);
  assert.match(conversationsSource, /formatConversationHistoryForAi\(conversationHistoryForAi\.length \? conversationHistoryForAi : incomingMsgs\)/);
  assert.match(conversationsSource, /document_requirements/);
  assert.match(conversationsSource, /buyerAskedDocumentRequirements/);
  assert.match(conversationsSource, /proof of income/);
  assert.doesNotMatch(conversationsSource, /active bank account/);
  assert.match(conversationsSource, /Do not ask for a phone number in the same reply/);
  assert.match(conversationsSource, /identificación vigente y comprobante de ingresos/);
  assert.match(conversationsSource, /warranty_info/);
  assert.match(conversationsSource, /advisor_question/);
  assert.match(conversationsSource, /buyerAskedWarrantyInfo/);
  assert.match(conversationsSource, /buyerAskedAdvisorQuestion/);
  assert.match(conversationsSource, /Do not use the words "advisor" or "asesor"/);
  assert.match(conversationsSource, /Use "our team" \/ "nuestro equipo"/);
  assert.match(conversationsSource, /Do not provide a number/);
  assert.match(conversationsSource, /stageRequiresStorePhone/);
  assert.match(conversationsSource, /replyIncludesStorePhone/);
  assert.match(conversationsSource, /replyGivesRestrictedVehicleDetails/);
  assert.match(conversationsSource, /\$\\s\*\\d/);
  assert.match(conversationsSource, /Dealership phone: \$\{storePhone\}/);
  assert.match(conversationsSource, /detailed_question/);
  assert.match(conversationsSource, /confirm that detail/);
  assert.match(conversationsSource, /best phone number so we can help you/);
  assert.match(conversationsSource, /generateAiReplyWithFallback/);
  assert.match(conversationsSource, /buildSafeFallbackReply/);
  assert.match(conversationsSource, /duplicate_buyer_message/);
  assert.match(conversationsSource, /deliveryRetry: true/);
  assert.match(conversationsSource, /returning existing reply for Messenger delivery retry/);
  assert.match(conversationsSource, /!isReplyLanguageMirrored\(retryableReply, language\)/);
  assert.match(conversationsSource, /repaired stale reply before Messenger delivery retry/);
  assert.match(conversationsSource, /messageDetectedAt/);
  assert.match(conversationsSource, /backendReceivedAt/);
  assert.match(conversationsSource, /aiStartedAt/);
  assert.match(conversationsSource, /aiCompletedAt/);
  assert.match(conversationsSource, /totalResponseMs/);
  assert.match(conversationsSource, /Promise\.allSettled/);
  assert.match(conversationsSource, /Conversation intake secondary sync failed - response preserved/);
  assert.match(conversationsSource, /marketplace_listing_metrics/);
  assert.match(conversationsSource, /messages\.filter\(isDisplayMessage\)/);
  assert.match(conversationsSource, /hasBuyerMessage/);
  assert.match(conversationsSource, /hasNewBuyerMessage/);
  assert.match(conversationsSource, /findNewConversationMessages/);
  assert.match(conversationsSource, /existingChronological\.slice\(-overlap\)/);
  assert.match(conversationsSource, /incomingChronological\.slice\(0, overlap\)/);
  assert.doesNotMatch(conversationsSource, /const existingContents = new Set/);
  assert.match(conversationsSource, /shouldGenerateReply/);
  assert.match(conversationsSource, /latestParsed\?\.role === "user"/);
  assert.doesNotMatch(publisherFlowSource, /Send was NOT clicked/);
  assert.doesNotMatch(publisherFlowSource, /href="tel:\+17037634675"/);
  assert.match(conversationsSource, /\+1 703-763-4675/);
  assert.match(conversationsSource, /role:\s*"user"/);
  assert.match(conversationsSource, /syncMarketplaceListingMetrics/);
  assert.match(conversationsSource, /messagesReceived/);
  assert.match(conversationsSource, /unreadMessages/);
  assert.match(messengerClientSource, /messageDetectedAt/);
  assert.match(messengerClientSource, /idempotencyKey/);
  assert.match(messengerClientSource, /CONVERSATION_INTAKE_DEDUPE_MS = 120000/);
  assert.match(messengerClientSource, /duplicate_extension_intake/);
  assert.match(messengerClientSource, /availabilityQuickReplyAccepted/);
  assert.match(messengerClientSource, /conversationThreadDetected/);
  assert.match(messengerClientSource, /routeAllowed/);
  assert.match(messengerAiSource, /messageHash/);
  assert.match(messengerAiSource, /response\.data\?\.skipped/);
  assert.match(salesAiSource, /Vehicle not resolved/);
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
  assert.match(queueClientSource, /async CLOSE_MARKETPLACE_TABS/);
  assert.match(queueClientSource, /closeMarketplaceTabs/);
  assert.match(queueClientSource, /chrome\.tabs\.remove\(id\)/);
  assert.match(queueClientSource, /handler\(message,\s*_sender\)/);
  assert.match(publisherFlowSource, /closeMarketplaceTabSoon/);
  assert.match(publisherFlowSource, /type: "CLOSE_MARKETPLACE_TABS"/);
  assert.match(queueClientSource, /scheduled_at_wait/);
  assert.match(queueClientSource, /Math\.max\(finishedMs \+ INTER_JOB_DELAY_MS/);
  assert.match(queueClientSource, /const isAutomaticBatch = message\.source === "auto_publish_batch"/);
  assert.match(queueClientSource, /source: assignedJob\.source \|\| "assigned"/);
});

test("Marketplace vehicle category selector prefers the broad Vehicles option", () => {
  assert.match(publisherFlowSource, /"truck": "Car\/Truck"/);
  assert.match(publisherFlowSource, /"suv": "Car\/Truck"/);
  assert.match(publisherFlowSource, /"vehicles"/);
  assert.match(publisherFlowSource, /CAR_ALIASES\.some/);
});

test("publishing an automatic batch early compacts later batches without touching terminal jobs", () => {
  assert.match(queueCompactionSource, /completedBatch\.scheduledAt\.getTime\(\) <= now\.getTime\(\)/);
  assert.match(queueCompactionSource, /completedJobs\.some\(\(job\) => job\.status !== "Published"\)/);
  assert.match(queueCompactionSource, /inArray\(publishingBatchesTable\.status, \[\.\.\.ACTIVE_BATCH_STATUSES\]\)/);
  assert.match(queueCompactionSource, /gt\(publishingBatchesTable\.scheduledAt, now\)/);
  assert.match(queueCompactionSource, /tx\s*\.update\(publishingBatchesTable\)[\s\S]*set\(\{ scheduledAt: targetBatchAt \}\)/);
  assert.match(queueCompactionSource, /ACTIVE_PUBLISHING_JOB_STATUSES\.includes/);
  assert.match(queueCompactionSource, /tx\s*\.update\(publishingJobsTable\)[\s\S]*set\(\{ scheduledAt:/);
  assert.match(routeSource, /compactFutureAutoPublishQueue\(\{[\s\S]*completedBatchId: updated\.batchId/);
  assert.match(listingsRouteSource, /compactFutureAutoPublishQueue\(\{[\s\S]*completedBatchId: latestJob\.batchId/);
  assert.match(marketplaceListingsSource, /compactFutureAutoPublishQueue\(\{[\s\S]*completedBatchId: batchId/);
});

test("Alpha Pages scheduling and dashboard display use New York time", () => {
  assert.match(pagesWorkerSource, /META_PAGE_TIME_ZONE\?\.trim\(\) \|\| "America\/New_York"/);
  assert.match(pagesWorkspaceSource, /const PAGE_TIME_ZONE = "America\/New_York"/);
  assert.doesNotMatch(pagesWorkspaceSource, /timeZone: "America\/Bogota"/);
});

test("Alpha Pages exposes an administrator-only immediate publish action", () => {
  assert.match(pagesWorkerSource, /createImmediatePagesBatch/);
  assert.match(pagesWorkerSource, /Created by Pages Publish Now/);
  assert.match(pagesRouteSource, /router\.post\("\/pages\/publish-now"/);
  assert.match(pagesRouteSource, /Administrator access required/);
  assert.match(pagesRouteSource, /already has an active Pages publishing job/);
  assert.match(pagesWorkspaceSource, /Publish now/);
  assert.match(pagesWorkspaceSource, /\/api\/pages\/publish-now/);
  assert.match(pagesWorkspaceSource, /window\.confirm/);
});

test("Alpha Pages activity exposes each job step and publication link", () => {
  assert.match(pagesRouteSource, /jobsByBatch/);
  assert.match(pagesRouteSource, /currentStep: pagePublishingJobsTable\.currentStep/);
  assert.match(pagesRouteSource, /postUrl: pagePublishingJobsTable\.postUrl/);
  assert.match(pagesWorkspaceSource, /\/api\/pages\/batches\?dealerId=/);
  assert.match(pagesWorkspaceSource, /setInterval\(\(\) => \{ void load\(\{ announcePublished: true \}\); \}, 15_000\)/);
  assert.match(pagesWorkspaceSource, /Page publishing history/);
  assert.match(pagesWorkspaceSource, /Queued for Meta Page/);
  assert.match(pagesWorkspaceSource, /Open Alpha Page/);
  assert.match(pagesWorkspaceSource, /View post/);
});

test("an operator can clean up a deleted Alpha Page test post without requeueing it", () => {
  assert.match(pagesRouteSource, /router\.post\("\/pages\/jobs\/:jobId\/mark-post-removed"/);
  assert.match(pagesRouteSource, /Administrator access required/);
  assert.match(pagesRouteSource, /status: "Needs Review"/);
  assert.match(pagesRouteSource, /currentStep: "Post removed from Facebook Page"/);
  assert.match(pagesRouteSource, /metaPostId: null/);
  assert.match(pagesRouteSource, /postUrl: null/);
  assert.match(pagesRouteSource, /externalUrl: null/);
  assert.match(pagesRouteSource, /reconcilePagesBatchProgress/);
  assert.match(pagesWorkerSource, /inArray\(pagePublishingJobsTable\.status, \["Scheduled", "Queued", "Publishing", "Published", "Needs Review"\]\)/);
  assert.match(pagesWorkspaceSource, /markPostRemoved/);
  assert.match(pagesWorkspaceSource, /Mark as not published/);
  assert.match(pagesWorkspaceSource, /statusLabel\(job\.status, job\.currentStep\)/);
});

test("a removed Alpha Page test post can return to the next scheduled batch only by operator action", () => {
  assert.match(pagesRouteSource, /router\.post\("\/pages\/jobs\/:jobId\/return-to-queue"/);
  assert.match(pagesRouteSource, /Only a removed Pages post can return to the queue/);
  assert.match(pagesRouteSource, /status: "Ready"/);
  assert.match(pagesRouteSource, /currentStep: "Ready for next Pages batch"/);
  assert.match(pagesRouteSource, /status: "Draft"/);
  assert.match(pagesWorkspaceSource, /returnToQueue/);
  assert.match(pagesWorkspaceSource, /Return to queue/);
  assert.match(pagesWorkspaceSource, /This does not publish it now/);
});

test("Pages batch preflight moves invalid photo candidates to Needs Review and keeps scanning", () => {
  assert.match(pagesWorkerSource, /async function checkPagePhotoReadiness/);
  assert.match(pagesWorkerSource, /Automatically moved to Needs Review during Pages photo preflight/);
  assert.match(pagesWorkerSource, /for \(const candidate of candidates\)/);
  assert.match(pagesWorkerSource, /if \(readiness\.photoError\)/);
  assert.match(pagesWorkerSource, /await createPagesNeedsReviewBatch/);
  assert.match(pagesWorkerSource, /if \(readyCandidates\.length >= batchLimit\) break/);
  assert.match(pagesWorkerSource, /moved \$\{needsReview\} vehicle\(s\) to Needs Review/);
});

test("a Pages review batch is terminal and does not reserve later Page candidates", () => {
  assert.match(pagesWorkerSource, /failedCount > 0 \? "Needs Review" : "Completed"/);
  assert.match(pagesWorkerSource, /inArray\(pagePublishingJobsTable\.status, \["Scheduled", "Queued", "Publishing", "Published", "Needs Review"\]\)/);
  assert.match(pagesRouteSource, /const OPEN_BATCH_STATUSES = \["Scheduled", "Active"\]/);
});

test("Alpha Pages schedule controls stay legible inside narrow responsive columns", () => {
  assert.match(pagesWorkspaceSource, /Daily window \(ET\)/);
  assert.match(pagesWorkspaceSource, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
  assert.match(pagesWorkspaceSource, /min-w-0 w-full rounded-md border/);
  assert.match(pagesWorkspaceSource, /tabular-nums/);
});

test("Alpha Pages keeps an unsaved New York schedule draft during activity polling", () => {
  assert.match(pagesWorkspaceSource, /const settingsDraftRef = useRef\(false\)/);
  assert.match(pagesWorkspaceSource, /if \(!settingsDraftRef\.current\) setSettings\(settingsResponse\.settings \?\? DEFAULT_SETTINGS\)/);
  assert.match(pagesWorkspaceSource, /settingsDraftRef\.current = true/);
  assert.match(pagesWorkspaceSource, /settingsDraftRef\.current = false/);
  assert.match(pagesWorkspaceSource, /Unsaved plan changes/);
  assert.match(pagesWorkspaceSource, /Save plan changes/);
});

test("Alpha Pages announces a scheduled publication after live activity polling", () => {
  assert.match(pagesWorkspaceSource, /const previousJobStatusesRef = useRef<Map<number, string> \| null>\(null\)/);
  assert.match(pagesWorkspaceSource, /announcePublished = false/);
  assert.match(pagesWorkspaceSource, /load\(\{ announcePublished: true \}\)/);
  assert.match(pagesWorkspaceSource, /job\.status === "Published"/);
  assert.match(pagesWorkspaceSource, /was published to the Alpha Page/);
  assert.match(pagesWorkspaceSource, /role="status"/);
});
