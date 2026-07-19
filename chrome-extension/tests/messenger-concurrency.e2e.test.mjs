import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function createConversationIntakeHarness() {
  const storage = { extensionId: "ext-concurrency-e2e" };
  const calls = { apiPost: [] };
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
      async query() { return []; },
      async create() { return { id: 1 }; },
      async update(id, patch) { return { id, ...patch }; },
      async remove() {},
      onRemoved: { addListener() {} },
    },
    windows: { async update() {} },
    runtime: {
      id: "chrome-runtime-concurrency-e2e",
      getManifest() { return { version: "e2e" }; },
      onMessage: { addListener() {} },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    alarms: {
      async get() { return { name: "pollAssigned" }; },
      create() {},
      onAlarm: { addListener() {} },
    },
  };

  const DealerPilotApiClient = {
    async getBackendUrl() {
      return "https://1987dealerpilot.com";
    },
    async apiGet(path) {
      if (path === "/api/extension/connect-status") return { connectRequested: false };
      if (path.startsWith("/api/publishing/jobs/assigned")) return { job: null };
      if (path === "/api/publishing/jobs") return { jobs: [] };
      if (path === "/api/publishing/jobs/next") return { job: null };
      throw new Error(`Unexpected GET ${path}`);
    },
    async apiPost(path, body) {
      calls.apiPost.push({ path, body });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: true,
        data: { suggestedReply: `reply for ${body.externalThreadRef}` },
      };
    },
    async sendHeartbeat() { return { ok: true }; },
    async sendSessionReport() { return { ok: true }; },
  };

  const source =
    readFileSync(new URL("../src/background/queueClient.js", import.meta.url), "utf8") +
    "\nglobalThis.__DealerPilotQueueHandlers = handlers;";
  const context = vm.createContext({
    DealerPilotApiClient,
    chrome,
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => "uuid-concurrency-e2e" },
    URL,
    Date,
    setTimeout,
    clearTimeout,
    setImmediate,
  });
  vm.runInContext(source, context, { filename: "queueClient-concurrency.e2e.js" });
  return { handlers: context.__DealerPilotQueueHandlers, calls, storage };
}

function intakePayload(overrides = {}) {
  return {
    externalThreadRef: "marketplace-thread::buyer-a::rav4",
    sourceUrl: "https://www.facebook.com/marketplace/item/869519832548001/",
    buyerName: "Buyer A",
    visibleMessages: [{ speaker: "Buyer", text: "Is it available?" }],
    currentMessage: "Is it available?",
    detectedMarketplaceListingUrl: "https://www.facebook.com/marketplace/item/869519832548001/",
    detectedVehicleTitle: "2021 Toyota RAV4",
    messageHash: "hash-buyer-a-1",
    idempotencyKey: "hash-buyer-a-1",
    routeAllowed: true,
    conversationThreadDetected: true,
    buyerMessageDetected: true,
    buyerNameDetected: true,
    sellerIsCurrentUser: true,
    marketplaceContextDetected: true,
    ...overrides,
  };
}

test("two simultaneous Marketplace conversations stay isolated end to end", async () => {
  const { handlers, calls } = createConversationIntakeHarness();
  const first = intakePayload({
    externalThreadRef: "marketplace-thread::buyer-a::rav4",
    buyerName: "Buyer A",
    currentMessage: "Can you send the financing options?",
    messageHash: "hash-buyer-a-2",
    idempotencyKey: "hash-buyer-a-2",
  });
  const second = intakePayload({
    externalThreadRef: "marketplace-thread::buyer-b::rav4",
    buyerName: "Buyer B",
    currentMessage: "What is the mileage?",
    messageHash: "hash-buyer-b-1",
    idempotencyKey: "hash-buyer-b-1",
  });

  const [firstResult, secondResult] = await Promise.all([
    handlers.CONVERSATION_INTAKE(first),
    handlers.CONVERSATION_INTAKE(second),
  ]);

  assert.equal(calls.apiPost.length, 2, "distinct threads must produce two backend intake calls");
  assert.equal(firstResult.data.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");
  assert.equal(secondResult.data.suggestedReply, "reply for marketplace-thread::buyer-b::rav4");
  assert.deepEqual(
    calls.apiPost.map(({ body }) => [body.externalThreadRef, body.buyerName, body.currentMessage]),
    [
      [first.externalThreadRef, first.buyerName, first.currentMessage],
      [second.externalThreadRef, second.buyerName, second.currentMessage],
    ],
  );
});

test("only an identical capture is deduplicated; separate buyers are not blocked", async () => {
  const { handlers, calls } = createConversationIntakeHarness();
  const payload = intakePayload();
  const [sent, skipped] = await Promise.all([
    handlers.CONVERSATION_INTAKE(payload),
    handlers.CONVERSATION_INTAKE({ ...payload }),
  ]);

  assert.equal(calls.apiPost.length, 1, "the same capture must be sent once while in flight");
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, "duplicate_extension_intake");
  assert.equal(sent.ok, true);

  const afterCompletion = await handlers.CONVERSATION_INTAKE({ ...payload });
  assert.equal(afterCompletion.skipped, true);
  assert.equal(afterCompletion.reason, "duplicate_extension_intake");
  assert.equal(calls.apiPost.length, 1);
});

test("seller identity is a hard gate and hidden tabs do not become buyer contexts", () => {
  const publisherFlowSource = readFileSync(
    new URL("../src/content/facebook/publisherFlow.js", import.meta.url),
    "utf8",
  );
  assert.match(publisherFlowSource, /sellerIsCurrentUser:\s*evidence\.sellerContextTrusted === true/);
  assert.match(publisherFlowSource, /seller_surface_rejected/);
  assert.match(publisherFlowSource, /seller_context_untrusted/);
  assert.doesNotMatch(publisherFlowSource, /document\.visibilityState !== "visible"/);
  assert.match(publisherFlowSource, /backend idempotency is the final guard/);
});

test("diagnostics from two seller tabs retain independent thread identities", async () => {
  const { handlers, storage } = createConversationIntakeHarness();
  await Promise.all([
    handlers.MESSENGER_CAPTURE_DEBUG(
      { debug: { threadIdentity: "thread-a", buyerName: "Buyer A" } },
      { tab: { id: 41, url: "https://www.facebook.com/marketplace/inbox" } },
    ),
    handlers.MESSENGER_CAPTURE_DEBUG(
      { debug: { threadIdentity: "thread-b", buyerName: "Buyer B" } },
      { tab: { id: 42, url: "https://www.facebook.com/marketplace/inbox" } },
    ),
  ]);
  assert.equal(storage.lastMessengerCaptureDebugByTab["41"].tabId, 41);
  assert.equal(storage.lastMessengerCaptureDebugByTab["41"].threadIdentity, "thread-a");
  assert.equal(storage.lastMessengerCaptureDebugByTab["42"].tabId, 42);
  assert.equal(storage.lastMessengerCaptureDebugByTab["42"].threadIdentity, "thread-b");
});
