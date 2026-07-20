import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/background/messengerClient.js", import.meta.url),
  "utf8",
);

function createHarness({ apiPost } = {}) {
  const storage = { extensionId: "msg-ext-test" };
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
      },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
    },
  };
  const DealerPilotMessengerApiClient = {
    async apiPost(path, body) {
      calls.apiPost.push({ path, body });
      if (apiPost) return apiPost(path, body);
      return { suggestedReply: `reply for ${body.externalThreadRef}` };
    },
  };
  const context = vm.createContext({
    chrome,
    DealerPilotMessengerApiClient,
    crypto: { randomUUID: () => "uuid" },
    Date,
    console: { warn() {}, log() {}, error() {} },
  });
  vm.runInContext(source, context, { filename: "messengerClient.js" });
  return { handlers: context.DealerPilotMessengerHandlers, calls, storage };
}

const intakePayload = {
  externalThreadRef: "marketplace-thread::buyer-a::rav4",
  sourceUrl: "https://www.facebook.com/marketplace/inbox",
  buyerName: "Buyer A",
  visibleMessages: ["Buyer: Is this available?"],
  currentMessage: "Is this available?",
  detectedMarketplaceListingUrl: "https://www.facebook.com/marketplace/item/1/",
  detectedVehicleTitle: "2021 Toyota RAV4",
  messageHash: "hash-a",
  idempotencyKey: "hash-a",
  routeAllowed: true,
  conversationThreadDetected: true,
  buyerMessageDetected: true,
  buyerNameDetected: true,
  sellerIsCurrentUser: true,
  marketplaceContextDetected: true,
};

test("background sends only the existing conversations intake contract", async () => {
  const { handlers, calls } = createHarness();
  const response = await handlers.CONVERSATION_INTAKE(intakePayload);

  assert.equal(response.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");
  assert.equal(calls.apiPost.length, 1);
  assert.equal(calls.apiPost[0].path, "/api/conversations/intake");
  assert.equal(calls.apiPost[0].body.extensionId, "msg-ext-test");
  assert.equal(calls.apiPost[0].body.availabilityQuickReplyAccepted, false);
});

test("background deduplicates identical intakes inside the extension", async () => {
  const { handlers, calls } = createHarness();
  const first = await handlers.CONVERSATION_INTAKE(intakePayload);
  const second = await handlers.CONVERSATION_INTAKE({ ...intakePayload });

  assert.equal(first.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");
  assert.equal(second.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");
  assert.equal(second.duplicateExtensionIntake, true);
  assert.equal(calls.apiPost.length, 1);
});

test("settings start in safe mode", async () => {
  const { handlers } = createHarness();
  const settings = await handlers.GET_SETTINGS();

  assert.equal(settings.dryRun, true);
  assert.equal(settings.autoReplyEnabled, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(settings.sellerProfileNames)),
    ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
  );
});

test("backend JSON errors are preserved for the popup debugger", async () => {
  const { handlers, storage } = createHarness({
    apiPost() {
      const err = new Error("POST /api/conversations/intake failed: 422");
      err.status = 422;
      err.data = { error: "buyer_message_missing", details: { field: "currentMessage" } };
      throw err;
    },
  });

  await assert.rejects(() => handlers.CONVERSATION_INTAKE({
    ...intakePayload,
    messageHash: "hash-json-error",
    idempotencyKey: "hash-json-error",
  }));

  assert.equal(storage.lastConversationIntake.error.status, 422);
  assert.deepEqual(
    JSON.parse(JSON.stringify(storage.lastConversationIntake.error.data)),
    { error: "buyer_message_missing", details: { field: "currentMessage" } },
  );
  assert.equal(storage.lastConversationIntake.error.raw.message, "POST /api/conversations/intake failed: 422");
});
