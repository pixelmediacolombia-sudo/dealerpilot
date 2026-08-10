import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const listingRules = read("artifacts/api-server/src/listings/rules.ts");
const listingScoring = read("artifacts/api-server/src/listings/scoring.ts");
const publishing = read("artifacts/api-server/src/routes/publishing.ts");
const controlledMode = read("artifacts/api-server/src/publishing/controlledMode.ts");
const batchProgress = read("artifacts/api-server/src/publishing/batchProgress.ts");
const staleCleaner = read("artifacts/api-server/src/publishing/staleCleaner.ts");
const extensionRoute = read("artifacts/api-server/src/routes/extension.ts");
const conversations = read("artifacts/api-server/src/routes/conversations.ts");
const vehicles = read("artifacts/api-server/src/routes/vehicles.ts");
const extensionApiClient = read("chrome-extension/src/shared/apiClient.js");
const extensionQueueClient = read("chrome-extension/src/background/queueClient.js");
const extensionPublisherFlow = read("chrome-extension/src/content/facebook/publisherFlow.js");
const manifest = read("chrome-extension/manifest.json");
const dashboardRouter = read("artifacts/dashboard/src/app/router.tsx");

test("listings domain rules keep deterministic category, down-payment, and priority decisions", () => {
  assert.match(listingRules, /export function categorize\(vehicle: Vehicle\): VehicleCategory/);
  assert.match(listingRules, /LUXURY_MAKES\.has\(make\) \|\| price >= LUXURY_PRICE_FLOOR/);
  assert.match(listingRules, /truck\|pickup\|crew cab\|super duty\|cab/);
  assert.match(listingRules, /suv\|crossover\|cuv\|sport utility\|wagon\|van\|minivan/);
  assert.match(listingRules, /case "Sedan"[\s\S]*clamp\(round50\(price \* 0\.06\), 1000, 1500\)/);
  assert.match(listingRules, /case "SUV"[\s\S]*clamp\(round50\(price \* 0\.07\), 2000, 3500\)/);
  assert.match(listingRules, /case "Truck"[\s\S]*clamp\(round50\(price \* 0\.07\), 2500, 4000\)/);
  assert.match(listingRules, /case "Luxury"[\s\S]*clamp\(round50\(price \* 0\.08\), 3000, 6000\)/);
  assert.match(listingRules, /case "Ready to Publish"[\s\S]*score \+= 30/);
  assert.match(listingRules, /case "Sold\/Removed"[\s\S]*score -= 40/);
});

test("listing score protects title, bilingual description, price, down-payment, and photos", () => {
  assert.match(listingScoring, /titleQuality \* 0\.25/);
  assert.match(listingScoring, /descriptionQuality \* 0\.3/);
  assert.match(listingScoring, /priceStrategy \* 0\.2/);
  assert.match(listingScoring, /downPaymentStrategy \* 0\.15/);
  assert.match(listingScoring, /photoScore \* 0\.1/);
  assert.match(listingScoring, /overall >= 85[\s\S]*"Excellent"/);
  assert.match(listingScoring, /overall >= 70[\s\S]*"Good"/);
  assert.match(listingScoring, /Needs Improvement/);
});

test("publishing application guardrails keep Alpha Flow safe", () => {
  assert.match(controlledMode, /MARKETPLACE_CONTROLLED_MODE_ENABLED/);
  assert.match(controlledMode, /MARKETPLACE_PUBLISH_MODE === "full_auto"/);
  assert.match(controlledMode, /NOT_ELIGIBLE_STATUSES = new Set\(\["Published", "Sold\/Removed", "Sold", "Removed", "Archived"\]\)/);
  assert.match(controlledMode, /UNKNOWN_LOT/);
  assert.match(controlledMode, /GM_BLOCKED/);
  assert.match(controlledMode, /DUPLICATE_ACTIVE_JOB/);
  assert.match(controlledMode, /DUPLICATE_LISTING_CONFLICT/);
  assert.match(controlledMode, /EXTENSION_OFFLINE/);
  assert.match(controlledMode, /ACTIVE_PUBLISHING_JOB_STATUSES/);
  assert.match(controlledMode, /"Ready for Review"/);
  assert.match(controlledMode, /"Auto Publishing"/);
  assert.match(staleCleaner, /IN_FLIGHT_PUBLISHING_JOB_STATUSES/);
  assert.match(staleCleaner, /REVIEW_STALE_STATUSES = new Set<string>\(\["Auto Publishing"\]\)/);
  assert.match(staleCleaner, /status: "Needs Review"/);
});

test("publishing queue and completion contracts are idempotent and extension-owned", () => {
  assert.match(publishing, /const ClaimBody = z\.object\(\{ extensionId: z\.string\(\)\.min\(1\) \}\)/);
  assert.match(publishing, /router\.post\("\/publishing\/jobs\/:id\/claim"/);
  assert.match(publishing, /isNull\(publishingJobsTable\.claimedByExtension\)/);
  assert.match(publishing, /status: "Publishing"/);
  assert.match(publishing, /const CompleteBody = z\.object\(\{/);
  assert.match(publishing, /listingUrl: z\.string\(\)\.url\(\)\.optional\(\)/);
  assert.match(publishing, /claimedByExtension && job\.claimedByExtension !== extensionId/);
  assert.match(publishing, /job\.status === "Published"[\s\S]*idempotent 200/);
  assert.match(publishing, /listingUrl missing[\s\S]*Needs Review/);
  assert.match(publishing, /status: "Published"[\s\S]*completedAt: now/);
});

test("inventory routes preserve sync, creation, state transition, and stats contracts", () => {
  assert.match(vehicles, /router\.get\("\/vehicles\/stats"/);
  assert.match(vehicles, /KNOWN_LOTS = new Set\(\["Manassas"\]\)/);
  assert.match(vehicles, /readyToPublish: by\("Ready to Publish"\)/);
  assert.match(vehicles, /priceChanged: by\("Price Changed"\)/);
  assert.match(vehicles, /router\.get\("\/vehicles"/);
  assert.match(vehicles, /router\.patch\("\/vehicles\/:id\/status"/);
  assert.match(vehicles, /vehicleChangesTable/);
});

test("sales-ai intake protects lead handoff and conversation continuity", () => {
  assert.match(conversations, /router\.post\("\/conversations\/intake"/);
  assert.match(conversations, /externalThreadRef required/);
  assert.match(conversations, /\.where\(eq\(conversationsTable\.externalThreadRef, externalThreadRef\)\)/);
  assert.match(conversations, /\.values\(\{[\s\S]*externalThreadRef,/);
  assert.match(conversations, /status: extractedPhone \? "BDC Assigned" : "New"/);
  assert.match(conversations, /router\.patch\("\/conversations\/:id\/auto-reply"/);
  assert.match(conversations, /router\.post\("\/sales-ai\/test-message"/);
  assert.match(conversations, /historyAskedAboutFinancing/);
  assert.match(conversations, /buyerAcceptedFinancingStep/);
  assert.match(conversations, /historyAskedAboutFinancing\(history\) && buyerAcceptedFinancingStep\(latest\)[\s\S]*return "request_phone"/);
});

test("backend-extension sacred endpoints are centralized and shape-compatible", () => {
  assert.match(extensionApiClient, /claimPublishingJob\(jobId, extensionId\)[\s\S]*\/api\/publishing\/jobs\/\$\{jobId\}\/claim/);
  assert.match(extensionApiClient, /completePublishingJob\(jobId, body\)[\s\S]*\/api\/publishing\/jobs\/\$\{jobId\}\/complete/);
  assert.match(extensionApiClient, /sendHeartbeat\(body\)[\s\S]*\/api\/extension\/heartbeat/);
  assert.match(extensionApiClient, /sendSessionReport\(body\)[\s\S]*\/api\/extension\/session-report/);
  assert.match(extensionQueueClient, /DealerPilotApiClient\.claimPublishingJob\(message\.jobId, extensionId\)/);
  assert.match(extensionQueueClient, /DealerPilotApiClient\.completePublishingJob\(message\.jobId, body\)/);
  assert.match(extensionQueueClient, /DealerPilotApiClient\.sendHeartbeat\(\{/);
  assert.match(extensionQueueClient, /DealerPilotApiClient\.sendSessionReport\(\{/);
  assert.match(extensionRoute, /const HeartbeatBody = z\.object\(\{/);
  assert.match(extensionRoute, /const SessionReportBody = z\.object\(\{/);
  assert.match(extensionRoute, /router\.post\("\/extension\/session-report"[\s\S]*status: "online"/);
  assert.match(extensionRoute, /router\.post\("\/extension\/session-report"[\s\S]*lastHeartbeatAt: new Date\(\)/);
  assert.match(extensionRoute, /router\.post\("\/extension\/session-report"[\s\S]*await saveChromeExtensionId\(row\.id, extensionId\)/);
});

test("extension heartbeat falls back to open Facebook tabs for Marketplace connection", () => {
  assert.match(extensionQueueClient, /async function detectFacebookTabState\(\)/);
  assert.match(extensionQueueClient, /chrome\.tabs\.query\(\{/);
  assert.match(extensionQueueClient, /"https:\/\/www\.facebook\.com\/\*"/);
  assert.match(extensionQueueClient, /const marketplaceDetected = path\.includes\("\/marketplace"\)/);
  assert.match(extensionQueueClient, /const detected = await detectFacebookTabState\(\)/);
  assert.match(extensionQueueClient, /fbLoggedIn: resolvedFbLoggedIn/);
  assert.match(extensionQueueClient, /marketplaceConnected: resolvedMarketplaceConnected/);
});

test("Alpha Flow E2E contract is still dashboard to backend to extension to completion", () => {
  assert.match(dashboardRouter, /path="\/publishing"/);
  assert.match(dashboardRouter, /path="\/listings"/);
  assert.match(publishing, /router\.post\("\/publishing\/jobs\/publish-now"/);
  assert.match(publishing, /source: "publish_now"/);
  assert.match(publishing, /status: "Assigned"/);
  assert.match(extensionQueueClient, /GET_NEXT_JOB/);
  assert.match(extensionQueueClient, /AUTO_START_ASSIGNED/);
  assert.match(extensionQueueClient, /CLAIM_JOB[\s\S]*DealerPilotApiClient\.claimPublishingJob/);
  assert.match(extensionPublisherFlow, /type: "GET_JOB_PAYLOAD"/);
  assert.match(extensionPublisherFlow, /type: "COMPLETE_JOB"/);
  assert.match(extensionPublisherFlow, /type: "POLL_NOW"/);
});

test("extension manifest loads modular classic scripts in dependency order", () => {
  assert.match(manifest, /src\/content\/facebook\/selectors\.js[\s\S]*publisherFlow\.js[\s\S]*content\/content\.js/);
  assert.match(read("chrome-extension/background.js"), /src\/shared\/logger\.js[\s\S]*src\/shared\/apiClient\.js[\s\S]*src\/background\/queueClient\.js/);
  assert.match(read("chrome-extension/popup/popup.html"), /modules\/settings\.js[\s\S]*modules\/diagnostics\.js[\s\S]*modules\/uiActions\.js[\s\S]*popup\.js/);
});

test("dashboard no longer references moved technical page folders for core features", () => {
  for (const legacyPath of [
    "artifacts/dashboard/src/pages/Listings/index.tsx",
    "artifacts/dashboard/src/pages/MarketplaceIntelligence/index.tsx",
    "artifacts/dashboard/src/pages/SalesHub/index.tsx",
    "artifacts/dashboard/src/pages/Inventory/index.tsx",
    "artifacts/dashboard/src/pages/Publishing/index.tsx",
    "artifacts/dashboard/src/pages/AIPhotoStudio/index.tsx",
    "artifacts/dashboard/src/pages/ConnectionCenter/index.tsx",
  ]) {
    assert.equal(existsSync(new URL(`../${legacyPath}`, import.meta.url)), false, `${legacyPath} should be moved`);
  }
  assert.doesNotMatch(dashboardRouter, /@\/pages\/(Listings|MarketplaceIntelligence|SalesHub|Inventory|Publishing|AIPhotoStudio|ConnectionCenter)/);
});

test("batch progress application service preserves done and failed states", () => {
  assert.match(batchProgress, /const terminal = completed \+ failed \+ skipped \+ needsReview/);
  assert.match(batchProgress, /const isDone = totalVehicles > 0 && terminal >= totalVehicles/);
  assert.match(batchProgress, /status: isDone \? \(failed > 0 \? "Failed" : "Completed"\) : "Active"/);
});
