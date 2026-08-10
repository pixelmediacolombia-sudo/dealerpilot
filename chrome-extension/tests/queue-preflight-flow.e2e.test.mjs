import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function createHarness(payload, options = {}) {
  let assignedJobReturned = false;
  const calls = {
    apiGet: [],
    apiPost: [],
    claims: [],
    createdTabs: [],
    heartbeats: [],
    alarmCreates: [],
    removedTabs: [],
    updatedTabs: [],
  };
  const storage = {
    extensionId: "ext-e2e",
    fbLoggedIn: true,
    storedVersion: "e2e",
    ...(options.initialStorage ?? {}),
  };

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === undefined || keys === null) return { ...storage };
          if (typeof keys === "string") return { [keys]: storage[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          return Object.fromEntries(Object.keys(keys).map((key) => [key, storage[key] ?? keys[key]]));
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
        },
      },
    },
    tabs: {
      async query() {
        return options.facebookTabs ?? [];
      },
      async create(tab) {
        calls.createdTabs.push(tab);
        return { id: 1001, ...tab };
      },
      async remove(id) {
        calls.removedTabs.push(id);
      },
      async update(id, patch) {
        calls.updatedTabs.push({ id, patch });
        return { id, ...patch };
      },
      onRemoved: { addListener(listener) { this.listener = listener; } },
    },
    windows: {
      async update() {},
    },
    runtime: {
      id: "chrome-runtime-e2e",
      getManifest() {
        return { version: "e2e" };
      },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { this.listener = listener; } },
    },
    alarms: {
      async get() {
        return options.pollAlarmExists === false ? null : { name: "pollAssigned" };
      },
      create(name, config) {
        calls.alarmCreates.push({ name, config });
      },
      onAlarm: { addListener() {} },
    },
  };

  const DealerPilotApiClient = {
    async getBackendUrl() {
      return "https://1987dealerpilot.com";
    },
    async apiGet(path) {
      calls.apiGet.push(path);
      if (path.endsWith("/payload")) return payload;
      if (path.startsWith("/api/publishing/jobs/assigned")) {
        if (!assignedJobReturned && options.assignedJob) {
          assignedJobReturned = true;
          return { job: options.assignedJob };
        }
        return { job: null };
      }
      if (path === "/api/publishing/jobs") return { jobs: options.jobs ?? [] };
      if (path === "/api/publishing/jobs/next") return { job: null };
      if (path === "/api/extension/connect-status") return { connectRequested: false };
      throw new Error(`Unexpected GET ${path}`);
    },
    async apiPost(path, body) {
      calls.apiPost.push({ path, body });
      return { ok: true };
    },
    async claimPublishingJob(jobId, extensionId) {
      calls.claims.push({ jobId, extensionId });
      return {
        id: jobId,
        vehicleId: 501,
        mode: "Controlled",
        source: "publish_now",
        vehicleLabel: "2020 Test Car",
      };
    },
    async sendHeartbeat(body) {
      calls.heartbeats.push(body);
      return { ok: true };
    },
    async sendSessionReport() {
      return { ok: true };
    },
  };

  const source =
    readFileSync(new URL("../src/background/queueClient.js", import.meta.url), "utf8") +
    "\nglobalThis.__DealerPilotQueueHandlers = handlers;";
  const context = vm.createContext({
    DealerPilotApiClient,
    chrome,
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => "uuid-e2e" },
    URL,
    Date,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context, { filename: "queueClient.js" });

  return {
    handlers: context.__DealerPilotQueueHandlers,
    calls,
    storage,
  };
}

test("missing Chrome polling alarm is recreated when the service worker loads", async () => {
  const { calls } = createHarness({}, { pollAlarmExists: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.alarmCreates.length, 1);
  assert.equal(calls.alarmCreates[0].name, "pollAssigned");
  assert.equal(calls.alarmCreates[0].config.periodInMinutes, 0.25);
});

test("incomplete assigned vehicle moves to Needs Review and polls the next job without opening Facebook", async () => {
  const payload = {
    fill: {
      year: 2020,
      make: "Toyota",
      model: "",
      mileage: 75000,
      bodyStyle: "SUV",
      exteriorColor: "White",
      fuelType: "Gasoline",
      transmission: "Automatic",
      location: "Manassas, VA",
      description: "Clean unit ready for financing.",
      price: 1000,
    },
    images: ["https://1987dealerpilot.com/photo.jpg"],
  };
  const { handlers, calls, storage } = createHarness(payload);

  const result = await handlers.AUTO_START_ASSIGNED({
    jobId: 101,
    createdAt: new Date().toISOString(),
    mode: "Controlled",
    source: "assigned",
    approvedByUser: true,
  });

  assert.equal(result.job, null);
  assert.deepEqual(calls.claims, []);
  assert.equal(storage.activeJob, undefined);
  assert.equal(calls.createdTabs.length, 0);
  assert.equal(calls.updatedTabs.length, 0);
  assert.ok(calls.apiGet.includes("/api/publishing/jobs/101/payload"));
  assert.ok(calls.apiGet.some((path) => path.startsWith("/api/publishing/jobs/assigned")));
  assert.ok(calls.apiGet.includes("/api/publishing/jobs/next"));

  const reviewPost = calls.apiPost.find((call) => call.path === "/api/publishing/jobs/101/needs-review");
  assert.ok(reviewPost, "job should be moved to Needs Review");
  assert.match(reviewPost.body.reason, /Missing required Marketplace data: model/);

  const audit = storage.auditLog ?? [];
  assert.equal(audit.some((entry) => entry.event === "MARKETPLACE_TAB_OPENED"), false);
  assert.equal(audit.some((entry) => entry.event === "AUTO_START_SKIPPED_INCOMPLETE"), true);
});

test("a retried job receives fresh queue ownership before Marketplace opens again", async () => {
  const payload = {
    fill: {
      year: 2020,
      make: "Mazda",
      model: "CX-30",
      mileage: 75000,
      bodyStyle: "SUV",
      exteriorColor: "White",
      fuelType: "Gasoline",
      transmission: "Automatic",
      location: "Manassas, VA",
      description: "Clean unit ready for financing.",
      price: 1000,
    },
    images: ["https://1987dealerpilot.com/photo.jpg"],
  };
  const { handlers, storage } = createHarness(payload, {
    initialStorage: {
      pendingRetry: { jobId: 401, retryCount: 1, at: new Date().toISOString() },
    },
  });

  await handlers.AUTO_START_ASSIGNED({
    jobId: 401,
    createdAt: new Date().toISOString(),
    mode: "Controlled",
    source: "auto_publish_batch",
    approvedByUser: true,
  });

  assert.equal(storage.activeJob.id, 401);
  assert.equal(storage.activeJob._retryCount, 1);
  assert.equal(storage.pendingRetry, undefined);
});

test("claimed active jobs can be restored when activeJob storage is lost", async () => {
  const payload = { fill: {}, images: [] };
  const { handlers, storage } = createHarness(payload, {
    jobs: [
      {
        id: 301,
        vehicleId: 601,
        status: "Publishing",
        claimedByExtension: "ext-e2e",
        vehicleLabel: "2024 RESTORE TEST",
      },
      {
        id: 302,
        vehicleId: 602,
        status: "Needs Review",
        claimedByExtension: "ext-e2e",
        vehicleLabel: "2024 TERMINAL TEST",
      },
    ],
  });

  const result = await handlers.RESTORE_ACTIVE_JOB();

  assert.equal(result.job.id, 301);
  assert.equal(storage.activeJob.id, 301);
  assert.equal(storage.lastClaimedJob.restoredAt != null, true);
});

test("assigned queue poll uses the Chrome runtime id while claiming with storage id", async () => {
  const payload = {
    fill: {
      year: 2020,
      make: "Toyota",
      model: "Camry",
      mileage: 75000,
      bodyStyle: "SUV",
      exteriorColor: "White",
      fuelType: "Gasoline",
      transmission: "Automatic",
      location: "Manassas, VA",
      description: "Clean unit ready for financing.",
      price: 1000,
    },
    images: ["https://1987dealerpilot.com/photo.jpg"],
  };
  const { handlers, calls } = createHarness(payload, {
    assignedJob: {
      id: 202,
      assignedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      mode: "Controlled",
    },
  });

  await handlers.POLL_ASSIGNED_JOB();

  assert.equal(calls.heartbeats.length, 1);
  assert.equal(calls.heartbeats[0].backendUrl, "https://1987dealerpilot.com");
  assert.equal(calls.heartbeats[0].chromeExtensionId, "chrome-runtime-e2e");
  assert.ok(
    calls.apiGet.includes("/api/publishing/jobs/assigned?extensionId=chrome-runtime-e2e"),
    "assigned poll should use chrome.runtime.id so it matches backend heartbeat assignment",
  );
  assert.deepEqual(calls.claims, [{ jobId: 202, extensionId: "ext-e2e" }]);
});

test("queue polling no longer opens seller inbox monitor tabs", async () => {
  const payload = { fill: {}, images: [] };
  const { handlers, calls, storage } = createHarness(payload, {
    initialStorage: {
      fbLoggedIn: true,
      marketplaceConnected: true,
    },
    facebookTabs: [{
      id: 42,
      url: "https://www.facebook.com/marketplace/inbox/?target_tab=selling",
    }],
  });

  const result = await handlers.POLL_ASSIGNED_JOB();

  assert.equal(result.job, null);
  assert.equal(calls.createdTabs.length, 0);
  assert.equal((storage.auditLog || []).some((entry) => entry.event === "SALES_AI_MONITOR_TAB_OPENED"), false);
});

test("page detection remains true when another Facebook tab reports a non-Marketplace page", async () => {
  const payload = { fill: {}, images: [] };
  const { handlers, storage } = createHarness(payload);

  await handlers.PAGE_STATE_REPORT(
    {
      state: {
        fbLoggedIn: true,
        marketplaceConnected: true,
        marketplaceDetected: true,
        marketplacePath: "/marketplace/inbox",
        marketplaceUrl: "https://www.facebook.com/marketplace/inbox",
        marketplaceDetectedAt: new Date().toISOString(),
      },
    },
    { tab: { id: 41, url: "https://www.facebook.com/marketplace/inbox" } },
  );
  await handlers.PAGE_STATE_REPORT(
    {
      state: {
        fbLoggedIn: true,
        marketplaceConnected: false,
        marketplaceDetected: false,
      },
    },
    { tab: { id: 42, url: "https://www.facebook.com/" } },
  );

  assert.equal(storage.marketplaceDetected, true);
  assert.equal(storage.marketplaceConnected, true);
  assert.equal(storage.marketplacePath, "/marketplace/inbox");

  await handlers.PAGE_STATE_REPORT(
    {
      state: {
        fbLoggedIn: true,
        marketplaceConnected: false,
        marketplaceDetected: false,
      },
    },
    { tab: { id: 41, url: "https://www.facebook.com/" } },
  );

  assert.equal(storage.marketplaceDetected, false);
});

test("publish completion closes current and related Marketplace tabs", async () => {
  const payload = { fill: {}, images: [] };
  const { handlers, calls } = createHarness(payload, {
    facebookTabs: [
      { id: 77, url: "https://www.facebook.com/marketplace/you/selling" },
      { id: 78, url: "https://www.facebook.com/marketplace/create/vehicle" },
      { id: 79, url: "https://www.facebook.com/messages" },
      { id: 80, url: "https://www.facebook.com/marketplace/inbox" },
    ],
  });

  const result = await handlers.CLOSE_MARKETPLACE_TABS(
    { reason: "publish_flow_finished" },
    { tab: { id: 76, url: "https://www.facebook.com/marketplace/item/123" } },
  );

  assert.equal(result.closed, true);
  assert.deepEqual(calls.removedTabs.sort((a, b) => a - b), [76, 77, 78]);
});
