import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const INTERVAL_MINUTES = 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60_000;
const MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/vehicle";

const queueClientSource = readFileSync(
  new URL("../src/background/queueClient.js", import.meta.url),
  "utf8",
);
const autoPublishSource = readFileSync(
  new URL("../../artifacts/api-server/src/routes/autoPublish.ts", import.meta.url),
  "utf8",
);

function completePayload(overrides = {}) {
  return {
    vehicleId: overrides.vehicleId ?? 9001,
    fill: {
      year: 2021,
      make: "Toyota",
      model: "RAV4 XLE",
      mileage: 48_500,
      bodyStyle: "SUV",
      exteriorColor: "White",
      fuelType: "Gasoline",
      transmission: "Automatic",
      location: "Manassas, VA",
      description: "Clean title. Financing available. Message us to schedule a test drive.",
      price: 24_995,
      ...(overrides.fill ?? {}),
    },
    images: overrides.images ?? [
      "https://1987dealerpilot.com/qa/front.jpg",
      "https://1987dealerpilot.com/qa/rear.jpg",
      "https://1987dealerpilot.com/qa/interior.jpg",
    ],
  };
}

function scheduleJobs({ baseMs, definitions }) {
  return definitions.map((definition, index) => {
    const scheduledAt = new Date(baseMs + index * INTERVAL_MS).toISOString();
    return {
      id: definition.id,
      vehicleId: definition.vehicleId,
      vehicleLabel: definition.vehicleLabel,
      mode: "Controlled",
      source: "auto_publish_batch",
      approvedByUser: true,
      status: "Assigned",
      scheduledAt,
      assignedAt: scheduledAt,
      createdAt: scheduledAt,
    };
  });
}

function createQaHarness({ baseMs, jobs, payloads }) {
  const clock = { nowMs: baseMs };
  class ControlledDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.nowMs]));
    }
    static now() {
      return clock.nowMs;
    }
  }

  let nextTabId = 7000;
  const backendJobs = new Map(jobs.map((job) => [job.id, { ...job }]));
  const calls = {
    apiGet: [],
    apiPost: [],
    claims: [],
    completed: [],
    createdTabs: [],
    heartbeats: [],
  };
  const storage = {
    extensionId: "ext-auto-publishing-qa",
    fbLoggedIn: true,
    marketplaceConnected: true,
    storedVersion: "qa",
  };

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === undefined || keys === null) return { ...storage };
          if (typeof keys === "string") return { [keys]: storage[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          return Object.fromEntries(Object.keys(keys).map((key) => [key, storage[key] ?? keys[key]]));
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        },
      },
    },
    tabs: {
      async query() {
        return [];
      },
      async create(tab) {
        const created = { id: nextTabId++, ...tab };
        calls.createdTabs.push(created);
        return created;
      },
      async update(id, patch) {
        return { id, ...patch };
      },
      async remove() {},
      onRemoved: { addListener() {} },
    },
    windows: { async update() {} },
    runtime: {
      id: "chrome-runtime-auto-publishing-qa",
      getManifest() {
        return { version: "qa" };
      },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
    },
    alarms: {
      async get() {
        return { name: "pollAssigned" };
      },
      create() {},
      onAlarm: { addListener() {} },
    },
  };

  const DealerPilotApiClient = {
    async getBackendUrl() {
      return "https://1987dealerpilot.com";
    },
    async apiGet(path) {
      calls.apiGet.push(path);
      const payloadMatch = path.match(/^\/api\/publishing\/jobs\/(\d+)\/payload$/);
      if (payloadMatch) {
        const payload = payloads[Number(payloadMatch[1])];
        if (!payload) throw new Error(`Missing QA payload for job ${payloadMatch[1]}`);
        return payload;
      }
      const progressMatch = path.match(/^\/api\/publishing\/jobs\/(\d+)\/progress$/);
      if (progressMatch) return { status: backendJobs.get(Number(progressMatch[1]))?.status || "Unknown" };
      if (path.startsWith("/api/publishing/jobs/assigned")) {
        const due = [...backendJobs.values()].find((job) =>
          job.status === "Assigned" && new Date(job.scheduledAt).getTime() <= clock.nowMs,
        );
        return { job: due || null };
      }
      if (path === "/api/publishing/jobs") return { jobs: [...backendJobs.values()] };
      if (path === "/api/publishing/jobs/next") return { job: null };
      if (path === "/api/extension/marketplace-sold-actions") return { actions: [] };
      if (path === "/api/extension/connect-status") return { connectRequested: false };
      throw new Error(`Unexpected GET ${path}`);
    },
    async apiPost(path, body) {
      calls.apiPost.push({ path, body });
      const reviewMatch = path.match(/^\/api\/publishing\/jobs\/(\d+)\/needs-review$/);
      if (reviewMatch) backendJobs.get(Number(reviewMatch[1])).status = "Needs Review";
      return { ok: true };
    },
    async claimPublishingJob(jobId, extensionId) {
      const job = backendJobs.get(jobId);
      assert.ok(job, `Unknown QA job ${jobId}`);
      calls.claims.push({ jobId, extensionId, at: new ControlledDate().toISOString() });
      job.status = "Publishing";
      return { ...job };
    },
    async completePublishingJob(jobId, body) {
      const job = backendJobs.get(jobId);
      assert.ok(job, `Unknown QA job ${jobId}`);
      job.status = "Published";
      job.listingUrl = body.listingUrl || null;
      calls.completed.push({ jobId, ...body, at: new ControlledDate().toISOString() });
      return { ok: true, job: { ...job } };
    },
    async sendHeartbeat(body) {
      calls.heartbeats.push(body);
      return { ok: true };
    },
    async sendSessionReport() {
      return { ok: true };
    },
  };

  const context = vm.createContext({
    DealerPilotApiClient,
    chrome,
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => "uuid-auto-publishing-qa" },
    URL,
    Date: ControlledDate,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    `${queueClientSource}\nglobalThis.__DealerPilotQueueHandlers = handlers;`,
    context,
    { filename: "queueClient-auto-publishing-qa.js" },
  );

  return {
    handlers: context.__DealerPilotQueueHandlers,
    calls,
    storage,
    jobs: backendJobs,
    now() {
      return new ControlledDate().toISOString();
    },
    advanceTo(iso) {
      clock.nowMs = new Date(iso).getTime();
    },
  };
}

async function markPublished(harness, job, suffix) {
  const listingUrl = `https://www.facebook.com/marketplace/item/qa-${suffix}/`;
  const result = await harness.handlers.COMPLETE_JOB({ jobId: job.id, listingUrl });
  await harness.handlers.CLEAR_ACTIVE_JOB();
  assert.equal(result.ok, true);
  return listingUrl;
}

function qaLog(caseId, at, event, details) {
  console.log(`[AUTO-PUBLISH-QA][${caseId}][${at}] ${event} ${details}`);
}

function marketplacePublishingTabs(calls) {
  return calls.createdTabs.filter((tab) => tab.url === MARKETPLACE_CREATE_URL);
}

function autoStartMessage(job) {
  return {
    jobId: job.id,
    createdAt: job.createdAt,
    mode: job.mode,
    source: job.source,
    scheduledAt: job.scheduledAt,
    approvedByUser: job.approvedByUser,
  };
}

test("QA case 1: two complete vehicles publish automatically at the configured interval", async () => {
  assert.match(autoPublishSource, /const spacingMs = \(dealerAutoPublishSettings\?\.minDelayMinutes \?\? 10\) \* 60_000/);
  assert.match(autoPublishSource, /const jobScheduledAt = new Date\(baseTime\.getTime\(\) \+ i \* spacingMs\)/);

  const baseMs = Date.parse("2026-07-19T14:00:00.000Z");
  const jobs = scheduleJobs({
    baseMs,
    definitions: [
      { id: 1101, vehicleId: 9101, vehicleLabel: "2021 Toyota RAV4 XLE" },
      { id: 1102, vehicleId: 9102, vehicleLabel: "2022 Honda CR-V EX" },
    ],
  });
  const harness = createQaHarness({
    baseMs,
    jobs,
    payloads: {
      1101: completePayload({ vehicleId: 9101 }),
      1102: completePayload({
        vehicleId: 9102,
        fill: { year: 2022, make: "Honda", model: "CR-V EX", mileage: 39_250, price: 27_500 },
      }),
    },
  });

  qaLog("case-1", harness.now(), "SCHEDULED", `job=1101 vehicle=RAV4 offset=0m`);
  qaLog("case-1", harness.now(), "SCHEDULED", `job=1102 vehicle=CR-V offset=${INTERVAL_MINUTES}m`);

  const firstStart = await harness.handlers.AUTO_START_ASSIGNED(autoStartMessage(jobs[0]));
  assert.equal(firstStart.ok, true);
  assert.equal(firstStart.jobId, 1101);
  qaLog("case-1", harness.now(), "PREFLIGHT_OK", "job=1101 required_fields=complete photos=3");
  qaLog("case-1", harness.now(), "MARKETPLACE_OPENED", `job=1101 tab=${firstStart.tabId}`);
  const firstUrl = await markPublished(harness, jobs[0], "1101");
  qaLog("case-1", harness.now(), "PUBLISHED", `job=1101 listing=${firstUrl}`);

  const earlySecondStart = await harness.handlers.AUTO_START_ASSIGNED(autoStartMessage(jobs[1]));
  assert.equal(earlySecondStart.skipped, true);
  assert.equal(earlySecondStart.reason, "scheduled_at_wait");
  assert.equal(harness.calls.claims.length, 1);
  qaLog("case-1", harness.now(), "WAITING", `job=1102 reason=scheduled_at_wait remaining=${earlySecondStart.cooldownRemainingS}s`);

  harness.advanceTo(jobs[1].scheduledAt);
  const secondStart = await harness.handlers.AUTO_START_ASSIGNED(autoStartMessage(jobs[1]));
  assert.equal(secondStart.ok, true);
  assert.equal(secondStart.jobId, 1102);
  qaLog("case-1", harness.now(), "PREFLIGHT_OK", "job=1102 required_fields=complete photos=3");
  qaLog("case-1", harness.now(), "MARKETPLACE_OPENED", `job=1102 tab=${secondStart.tabId}`);
  const secondUrl = await markPublished(harness, jobs[1], "1102");
  qaLog("case-1", harness.now(), "PUBLISHED", `job=1102 listing=${secondUrl}`);

  assert.equal(harness.jobs.get(1101).status, "Published");
  assert.equal(harness.jobs.get(1102).status, "Published");
  assert.equal(harness.calls.claims.length, 2);
  assert.equal(harness.calls.completed.length, 2);
  assert.equal(marketplacePublishingTabs(harness.calls).length, 2);
  const unexpectedReviewCalls = harness.calls.apiPost.filter(({ path }) => path.endsWith("/needs-review"));
  if (unexpectedReviewCalls.length) {
    qaLog("case-1", harness.now(), "UNEXPECTED_NEEDS_REVIEW", JSON.stringify(unexpectedReviewCalls));
  }
  assert.deepEqual(unexpectedReviewCalls, []);
  qaLog("case-1", harness.now(), "RESULT", "published=2 needs_review=0 premature_starts=0 PASS");
});

test("QA case 2: incomplete vehicle moves to Needs Review and the later complete vehicle still publishes", async () => {
  const baseMs = Date.parse("2026-07-19T16:00:00.000Z");
  const jobs = scheduleJobs({
    baseMs,
    definitions: [
      { id: 1201, vehicleId: 9201, vehicleLabel: "2020 Ford Escape incomplete" },
      { id: 1202, vehicleId: 9202, vehicleLabel: "2023 Nissan Rogue SV" },
    ],
  });
  const harness = createQaHarness({
    baseMs,
    jobs,
    payloads: {
      1201: completePayload({
        vehicleId: 9201,
        fill: { year: 2020, make: "Ford", model: "", location: "" },
        images: [],
      }),
      1202: completePayload({
        vehicleId: 9202,
        fill: { year: 2023, make: "Nissan", model: "Rogue SV", mileage: 21_100, price: 29_900 },
      }),
    },
  });

  qaLog("case-2", harness.now(), "SCHEDULED", "job=1201 vehicle=Escape offset=0m expected=incomplete");
  qaLog("case-2", harness.now(), "SCHEDULED", `job=1202 vehicle=Rogue offset=${INTERVAL_MINUTES}m expected=complete`);

  const incompleteResult = await harness.handlers.AUTO_START_ASSIGNED(autoStartMessage(jobs[0]));
  assert.equal(incompleteResult.job, null);
  const reviewCall = harness.calls.apiPost.find(({ path }) => path === "/api/publishing/jobs/1201/needs-review");
  assert.ok(reviewCall);
  assert.match(reviewCall.body.reason, /model/);
  assert.match(reviewCall.body.reason, /location/);
  assert.match(reviewCall.body.reason, /photos/);
  assert.equal(harness.jobs.get(1201).status, "Needs Review");
  assert.equal(harness.calls.claims.some(({ jobId }) => jobId === 1201), false);
  assert.equal(marketplacePublishingTabs(harness.calls).length, 0);
  qaLog("case-2", harness.now(), "NEEDS_REVIEW", `job=1201 reason="${reviewCall.body.reason}"`);
  qaLog("case-2", harness.now(), "FACEBOOK_NOT_OPENED", "job=1201 preflight_blocked_before_claim=true");

  harness.advanceTo(jobs[1].scheduledAt);
  const completeResult = await harness.handlers.POLL_ASSIGNED_JOB();
  assert.equal(completeResult.ok, true);
  assert.equal(completeResult.jobId, 1202);
  qaLog("case-2", harness.now(), "QUEUE_CONTINUED", "job=1202 selected_after_incomplete_job");
  qaLog("case-2", harness.now(), "PREFLIGHT_OK", "job=1202 required_fields=complete photos=3");
  qaLog("case-2", harness.now(), "MARKETPLACE_OPENED", `job=1202 tab=${completeResult.tabId}`);
  const completeUrl = await markPublished(harness, jobs[1], "1202");
  qaLog("case-2", harness.now(), "PUBLISHED", `job=1202 listing=${completeUrl}`);

  assert.equal(harness.jobs.get(1201).status, "Needs Review");
  assert.equal(harness.jobs.get(1202).status, "Published");
  assert.deepEqual(harness.calls.claims.map(({ jobId }) => jobId), [1202]);
  assert.deepEqual(harness.calls.completed.map(({ jobId }) => jobId), [1202]);
  assert.equal(marketplacePublishingTabs(harness.calls).length, 1);
  qaLog("case-2", harness.now(), "RESULT", "published=1 needs_review=1 blocked_tabs=1 queue_continued=true PASS");
});
