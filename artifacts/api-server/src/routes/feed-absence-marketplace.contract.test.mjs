import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const importFeed = readFileSync(new URL("../inventory/importFeed.ts", import.meta.url), "utf8");
const commandCenter = readFileSync(new URL("./commandCenter.ts", import.meta.url), "utf8");
const publishing = readFileSync(new URL("./publishing.ts", import.meta.url), "utf8");
const feed = readFileSync(new URL("./feed.ts", import.meta.url), "utf8");
const extension = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
const queueClient = readFileSync(new URL("../../../../chrome-extension/src/background/queueClient.js", import.meta.url), "utf8");
const publisherFlow = readFileSync(new URL("../../../../chrome-extension/src/content/facebook/publisherFlow.js", import.meta.url), "utf8");

test("feed absence detection has the two-run grace period and emergency guardrails", () => {
  assert.match(importFeed, /feedIngestionsTable/);
  assert.match(importFeed, /aborted_empty/);
  assert.match(importFeed, /aborted_threshold/);
  assert.match(importFeed, /averageVehicleCount/);
  assert.match(importFeed, /parsed\.length < averageVehicleCount \* 0\.8/);
  assert.match(importFeed, /missingFeedCount = v\.missingFeedCount \+ 1/);
  assert.match(importFeed, /missingFeedCount < 2/);
  assert.match(importFeed, /soldDetectionSource: "feed_absence"/);
  assert.match(importFeed, /soldAt: now/);
  assert.match(importFeed, /prior\.soldAt \? null/);
});

test("server and operator surfaces expose the Marketplace To Remove workflow", () => {
  assert.match(publishing, /router\.get\("\/publishing\/to-remove"/);
  assert.match(publishing, /router\.post\("\/publishing\/listings\/:id\/mark-sold"/);
  assert.match(publishing, /recordMarketplaceSoldAction/);
  assert.match(feed, /router\.get\("\/inventory\/sold"/);
  assert.match(feed, /router\.get\("\/feed\/ingestions"/);
  assert.match(commandCenter, /kind: "marketplace_cleanup"/);
  assert.match(commandCenter, /kind: "feed_guardrail"/);
  assert.match(commandCenter, /toRemoveCount/);
});

test("Chrome reports the actual Mark as Sold result", () => {
  assert.match(extension, /marketplace-sold-actions\/:listingId\/report/);
  assert.match(extension, /recordMarketplaceSoldAction/);
  assert.match(queueClient, /REPORT_SOLD_ACTION/);
  assert.match(queueClient, /marketplace-sold-actions\/\$\{message\.listingId\}\/report/);
  assert.match(publisherFlow, /status: "failed"/);
  assert.match(publisherFlow, /status: "completed"/);
});
