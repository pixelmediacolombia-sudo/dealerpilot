import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/background/messengerClient.js", import.meta.url),
  "utf8",
);

function createHarness({ storage, windowId, apiCalls }) {
  const listeners = {};
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: storage[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          return { ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    windows: {
      async getCurrent() {
        return { id: windowId };
      },
      async getAll() {
        return [{ id: 11 }, { id: 22 }];
      },
    },
    tabs: {
      async query() {
        return [];
      },
    },
    runtime: {
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } },
      onMessage: { addListener() {} },
    },
    alarms: {
      create() {},
      onAlarm: { addListener(listener) { listeners.alarm = listener; } },
    },
  };
  const DealerPilotMessengerApiClient = {
    async apiPost(path, body) {
      apiCalls.push({ path, body });
      return { suggestedReply: "ok" };
    },
  };
  const context = vm.createContext({
    chrome,
    DealerPilotMessengerApiClient,
    crypto: { randomUUID: () => "shared-extension" },
    Date,
    console: { warn() {}, log() {}, error() {} },
  });
  vm.runInContext(source, context, { filename: "messengerClient.js" });
  return context.DealerPilotMessengerHandlers;
}

const intake = {
  externalThreadRef: "marketplace-thread::window-test",
  sourceUrl: "https://www.facebook.com/marketplace/inbox",
  buyerName: "Window Buyer",
  visibleMessages: ["Buyer: Is this available?"],
  currentMessage: "Is this available?",
  detectedMarketplaceListingUrl: "https://www.facebook.com/marketplace/item/1/",
  detectedVehicleTitle: "2021 Toyota RAV4",
  autoReplyEnabled: true,
  routeAllowed: true,
  conversationThreadDetected: true,
  buyerMessageDetected: true,
  buyerNameDetected: true,
  sellerIsCurrentUser: true,
  marketplaceContextDetected: true,
};

test("same extension keeps Alpha and another dealer isolated by browser window", async () => {
  const storage = { extensionId: "shared-extension" };
  const apiCalls = [];
  const alpha = createHarness({ storage, windowId: 11, apiCalls });
  const secondDealer = createHarness({ storage, windowId: 22, apiCalls });

  await alpha.SAVE_SETTINGS({ dealerId: 1, sessionId: "alpha" });
  await secondDealer.SAVE_SETTINGS({ dealerId: 2, sessionId: "new-dealer", autoReplyEnabled: false });

  assert.equal((await alpha.GET_SETTINGS()).dealerId, 1);
  assert.equal((await alpha.GET_SETTINGS()).sessionId, "alpha");
  assert.equal((await secondDealer.GET_SETTINGS()).dealerId, 2);
  assert.equal((await secondDealer.GET_SETTINGS()).sessionId, "new-dealer");

  await alpha.CONVERSATION_INTAKE({ ...intake, messageHash: "alpha" }, { tab: { windowId: 11 } });
  await secondDealer.CONVERSATION_INTAKE({ ...intake, messageHash: "second" }, { tab: { windowId: 22 } });

  assert.deepEqual(
    apiCalls
      .filter(({ path }) => path === "/api/conversations/intake")
      .map(({ body }) => ({ dealerId: body.dealerId, sessionId: body.sessionId, autoReplyEnabled: body.autoReplyEnabled })),
    [
      { dealerId: 1, sessionId: "alpha", autoReplyEnabled: true },
      { dealerId: 2, sessionId: "new-dealer", autoReplyEnabled: false },
    ],
  );
  assert.ok(storage["messengerSettingsWindow:11"]);
  assert.ok(storage["messengerSettingsWindow:22"]);
});
