import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/background/messengerClient.js", import.meta.url),
  "utf8",
);

function createHarness({ apiPost, initialStorage = {} } = {}) {
  const storage = { extensionId: "msg-ext-test", ...initialStorage };
  const calls = { apiPost: [], debugger: [] };
  let runtimeComposerText = "";
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
    debugger: {
      async attach(target, version) {
        calls.debugger.push({ operation: "attach", target, version });
      },
      async sendCommand(target, method, params) {
        calls.debugger.push({ operation: "command", target, method, params });
        if (method === "Input.insertText") runtimeComposerText = params.text;
        if (method === "Runtime.evaluate") {
          if (params.expression.includes("found: Boolean(editor)")) {
            return { result: { value: { found: true, text: runtimeComposerText } } };
          }
          return {
            result: {
              value: {
                ok: true,
                aria: "Write to Buyer A · 2021 Toyota RAV4",
                text: runtimeComposerText,
              },
            },
          };
        }
        return {};
      },
      async detach(target) {
        calls.debugger.push({ operation: "detach", target });
      },
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
    setTimeout,
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
  const { handlers, calls, storage } = createHarness();
  const response = await handlers.CONVERSATION_INTAKE(intakePayload);

  assert.equal(response.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");
  assert.equal(calls.apiPost.length, 1);
  assert.equal(calls.apiPost[0].path, "/api/conversations/intake");
  assert.equal(calls.apiPost[0].body.extensionId, "msg-ext-test");
  assert.equal(calls.apiPost[0].body.availabilityQuickReplyAccepted, false);
  assert.equal(storage.lastConversationIntake.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");
  assert.equal(storage.lastConversationIntake.suggestedReplyPreview, "reply for marketplace-thread::buyer-a::rav4");
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

test("background keeps the latest 20 Messenger diagnostics", async () => {
  const { handlers, storage } = createHarness();
  for (let index = 0; index < 22; index += 1) {
    await handlers.MESSENGER_CAPTURE_DEBUG({
      debug: { stage: `stage-${index}`, at: `2026-07-30T20:00:${String(index).padStart(2, "0")}.000Z` },
    }, { tab: { id: 42 } });
  }

  assert.equal(storage.messengerCaptureDebugHistory.length, 20);
  assert.equal(storage.messengerCaptureDebugHistory[0].stage, "stage-21");
  assert.equal(storage.messengerCaptureDebugHistory.at(-1).stage, "stage-2");
  const debugState = await handlers.GET_DEBUG_STATE();
  assert.equal(debugState.messengerCaptureDebugHistory.length, 20);
});

test("background clears the manual fallback suggestion after confirmed auto-send", async () => {
  const { handlers, storage } = createHarness();
  await handlers.CONVERSATION_INTAKE(intakePayload);

  assert.equal(storage.lastConversationIntake.suggestedReply, "reply for marketplace-thread::buyer-a::rav4");

  await handlers.MESSENGER_CAPTURE_DEBUG({
    debug: {
      stage: "intake_ok",
      at: "2026-08-01T14:00:00.000Z",
      autoSent: true,
      deliveryConfirmed: true,
    },
  }, { tab: { id: 42 } });

  assert.equal(storage.lastConversationIntake.suggestedReply, null);
  assert.equal(storage.lastConversationIntake.suggestedReplyPreview, "");
  assert.equal(storage.lastConversationIntake.suggestedReplyClearReason, "auto_sent");
});

test("background writes and submits the Messenger composer through separate CDP phases", async () => {
  const { handlers, calls } = createHarness();
  const writeResponse = await handlers.DEBUGGER_COMPOSER_WRITE({
    x: 120,
    y: 420,
    text: "Yes, it is available.",
  }, { tab: { id: 42 } });
  const submitResponse = await handlers.DEBUGGER_COMPOSER_SUBMIT({
    x: 120,
    y: 420,
  }, { tab: { id: 42 } });

  assert.equal(writeResponse.ok, true);
  assert.equal(writeResponse.method, "debugger_main_world_write");
  assert.equal(writeResponse.writtenText, "Yes, it is available.");
  assert.equal(submitResponse.ok, true);
  assert.equal(submitResponse.method, "debugger_main_world_submit");
  assert.equal(calls.debugger[0].operation, "attach");
  assert.ok(calls.debugger.some((call) =>
    call.method === "Input.insertText" && call.params.text === "Yes, it is available."));
  assert.ok(calls.debugger.some((call) =>
    call.method === "Runtime.evaluate" && call.params.expression.includes("data-lexical-editor")));
  assert.ok(calls.debugger.some((call) =>
    call.method === "Input.dispatchKeyEvent" && call.params.key === "Enter" && call.params.type === "rawKeyDown"));
  assert.equal(calls.debugger.at(-1).operation, "detach");
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

test("two installations keep dealer and browser session identity in the intake contract", async () => {
  const calls = [];
  const makeApiPost = (name) => async (path, body) => {
    calls.push({ name, path, body });
    return { suggestedReply: `${name} reply` };
  };
  const first = createHarness({
    initialStorage: { extensionId: "msg-ext-dealer-1" },
    apiPost: makeApiPost("dealer-1"),
  });
  const second = createHarness({
    initialStorage: { extensionId: "msg-ext-lucky-mazda" },
    apiPost: makeApiPost("lucky-mazda"),
  });

  await first.handlers.SAVE_SETTINGS({ dealerId: 1, sessionId: "dealer-1" });
  await second.handlers.SAVE_SETTINGS({ dealerId: 2, sessionId: "lucky-mazda" });
  await first.handlers.CONVERSATION_INTAKE({ ...intakePayload, messageHash: "session-a", idempotencyKey: "session-a" });
  await second.handlers.CONVERSATION_INTAKE({ ...intakePayload, messageHash: "session-b", idempotencyKey: "session-b" });

  assert.deepEqual(
    calls.map(({ name, body }) => ({ name, dealerId: body.dealerId, sessionId: body.sessionId })),
    [
      { name: "dealer-1", dealerId: 1, sessionId: "dealer-1" },
      { name: "lucky-mazda", dealerId: 2, sessionId: "lucky-mazda" },
    ],
  );
});

test("background claims follow-ups and retains the durable countdown state for the debugger", async () => {
  const { handlers, calls, storage } = createHarness({
    apiPost(path) {
      assert.equal(path, "/api/conversations/follow-ups/claim");
      return {
        job: { id: 91, externalThreadRef: "marketplace-thread::facebook-messages-thread-991" },
        followUp: {
          cycleNumber: 2,
          followUpsSent: 1,
          maxFollowUps: 3,
          status: "Active",
          nextDueAt: "2026-08-14T17:00:00.000Z",
        },
      };
    },
  });

  const claimed = await handlers.CLAIM_DUE_MESSENGER_FOLLOW_UP();

  assert.equal(claimed.job.id, 91);
  assert.equal(calls.apiPost[0].body.extensionId, "msg-ext-test");
  assert.equal(storage.lastMessengerFollowUp.jobId, 91);
  assert.equal(storage.lastMessengerFollowUp.followUpsSent, 1);
  assert.equal(storage.lastMessengerFollowUp.maxFollowUps, 3);
});
