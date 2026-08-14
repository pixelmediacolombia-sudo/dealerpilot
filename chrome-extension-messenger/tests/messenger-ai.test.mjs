import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/content/facebook/messengerAi.js", import.meta.url),
  "utf8",
);

class FakeElement {
  constructor({ tagName = "div", attributes = {}, text = "", children = [], onClick = null, rect = null } = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.innerText = text;
    this.textContent = text;
    this.value = "";
    this.children = children;
    this.events = [];
    this.onClick = onClick;
    this.rect = rect;
    this.isConnected = true;
    for (const child of children) child.parentElement = this;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.events.push("native-click");
    this.onClick?.();
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selectors.some((part) => child.matches(part))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  matches(selector) {
    if (selector === "[aria-label]") return this.attributes["aria-label"] !== undefined;
    if (selector.includes('[contenteditable="true"]')) return this.attributes.contenteditable === "true";
    if (selector.includes("textarea")) return this.tagName === "TEXTAREA";
    if (selector.includes('[role="heading"]')) return this.attributes.role === "heading";
    if (selector === "h1" || selector === "h2" || selector === "h3") return this.tagName === selector.toUpperCase();
    if (selector.includes('a[href*="/marketplace/item/"]')) {
      return this.tagName === "A" && /\/marketplace\/item\//.test(this.attributes.href || "");
    }
    if (selector.includes('[aria-label*="send"')) {
      return /send/i.test(this.attributes["aria-label"] || "");
    }
    if (selector.includes('[aria-label*="enviar"')) {
      return /enviar/i.test(this.attributes["aria-label"] || "");
    }
    if (selector.includes('[data-testid*="send"')) {
      return /send/i.test(this.attributes["data-testid"] || "");
    }
    return false;
  }
}

function createHarness({
  settings,
  messages,
  composer = true,
  composerText = "",
  intakeResponse,
  captures,
  liveCaptureFromRoot,
  sendSucceeds = false,
  debuggerSendSucceeds = false,
  composerWriteSucceeds = true,
  sendClearDelayMs = 0,
  includeDecoySendButton = false,
  dynamicSendControl = false,
  locationOverride = null,
  nowMs = null,
  sessionStorageRef = null,
  onIntake = null,
} = {}) {
  const calls = { messages: [], debug: [], intake: [], contentMessageListener: null };
  let currentNowMs = nowMs;
  class FakeDate extends Date {
    constructor(...args) {
      super(args.length ? args[0] : currentNowMs ?? Date.now());
    }

    static now() {
      return currentNowMs ?? Date.now();
    }
  }
  const composerElement = composer
    ? new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" },
        rect: { left: 100, top: 400, width: 360, height: 40 },
      })
    : null;
  const sendButton = new FakeElement({
    tagName: "button",
    attributes: { "aria-label": dynamicSendControl ? "Send a voice clip" : "Send" },
    text: dynamicSendControl ? "" : "Send",
    rect: { left: 470, top: 400, width: 40, height: 40 },
    onClick() {
      if (!sendSucceeds || !composerElement) return;
      const clearComposer = () => {
        composerElement.value = "";
        composerElement.innerText = "";
        composerElement.textContent = "";
      };
      if (sendClearDelayMs > 0) setTimeout(clearComposer, sendClearDelayMs);
      else clearComposer();
    },
  });
  const decoySendButton = new FakeElement({
    tagName: "button",
    attributes: { "aria-label": "Send" },
    text: "Send",
    rect: { left: 900, top: 100, width: 40, height: 40 },
  });
  if (composerElement) {
    composerElement.innerText = composerText;
    composerElement.textContent = composerText;
  }
  const heading = new FakeElement({ tagName: "h2", text: "Buyer A - 2021 Toyota RAV4" });
  const root = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      heading,
      ...(composerElement
        ? [composerElement, ...(includeDecoySendButton ? [decoySendButton] : []), sendButton]
        : []),
    ],
  });
  const profile = new FakeElement({ attributes: { "aria-label": "Manage Andres Ibanez notification settings" } });
  const document = {
    execCommand(command, _showUi, value) {
      if (command === "insertText" && composerElement) {
        composerElement.innerText = value;
        composerElement.textContent = value;
        if (dynamicSendControl) {
          sendButton.setAttribute("aria-label", "Send");
          sendButton.innerText = "Send";
          sendButton.textContent = "Send";
        }
      }
      if (command === "selectAll" && composerElement) {
        composerElement.innerText = "";
        composerElement.textContent = "";
      }
      return true;
    },
    querySelectorAll(selector) {
      if (selector === "[aria-label]") return [profile];
      return root.querySelectorAll(selector);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(listener) { calls.contentMessageListener = listener; } },
      sendMessage(message, callback) {
        calls.messages.push(message);
        if (message.type === "GET_SETTINGS") {
          callback({ ok: true, data: settings || { dryRun: true, autoReplyEnabled: false } });
          return;
        }
        if (message.type === "MESSENGER_CAPTURE_DEBUG") {
          calls.debug.push(message.debug);
          callback({ ok: true, data: { saved: true } });
          return;
        }
        if (message.type === "CONVERSATION_INTAKE") {
          calls.intake.push(message);
          onIntake?.(message);
          callback(intakeResponse || { ok: true, data: { suggestedReply: "Yes, it is available." } });
          return;
        }
        if (message.type === "CLOSE_MESSENGER_CONVERSATION") {
          callback({ ok: true, data: { followUp: { status: "closed", nextDueAt: null } } });
          return;
        }
        if (message.type === "DEBUGGER_COMPOSER_WRITE") {
          if (composerElement && composerWriteSucceeds) {
            composerElement.value = "";
            composerElement.innerText = message.text;
            composerElement.textContent = message.text;
          }
          callback({
            ok: true,
            data: {
              ok: true,
              method: "debugger_main_world_write",
              writtenText: composerWriteSucceeds ? message.text : "",
            },
          });
          return;
        }
        if (message.type === "DEBUGGER_COMPOSER_SUBMIT") {
          if ((sendSucceeds || debuggerSendSucceeds) && composerElement) {
            const clearComposer = () => {
              composerElement.value = "";
              composerElement.innerText = "";
              composerElement.textContent = "";
            };
            if (sendClearDelayMs > 0) setTimeout(clearComposer, sendClearDelayMs);
            else clearComposer();
          }
          callback({ ok: true, data: { ok: true, method: "debugger_main_world_submit" } });
          return;
        }
        callback({ ok: false, error: `Unexpected ${message.type}` });
      },
    },
  };
  const context = vm.createContext({
    __DEALERPILOT_MESSENGER_AI_TEST__: true,
    DealerPilotMessengerAutonomy: {
      extractThreadId(value, origin = "https://www.facebook.com") {
        const url = new URL(value, origin);
        return url.pathname.match(/^\/messages\/t\/([^/?#]+)\/?$/i)?.[1] || "";
      },
      isMessagesThreadRoute(pathname) {
        return /^\/messages\/t\/[^/?#]+\/?$/i.test(pathname || "") ||
          /^\/marketplace\/inbox\/?$/i.test(pathname || "");
      },
    },
    DealerPilotMessengerCapture: {
      capture() {
        return (captures?.[0]) || {
          root,
          scope: root,
          buyerName: "Buyer A",
          messages: messages || [{ speaker: "Buyer", text: "Is this available?" }],
          evidence: {
            threadRootDetected: true,
            messageScopeDetected: true,
            extractionMode: "semantic",
            threadIdentity: "facebook-thread-buyer-a",
            selectedHeaderText: "Buyer A - 2021 Toyota RAV4",
            latestMessageDirection: "buyer",
            composerDetected: !!composerElement,
          },
        };
      },
      captureAll() {
        return captures || [this.capture()];
      },
      captureFromRoot(rootArg) {
        if (liveCaptureFromRoot) return liveCaptureFromRoot(rootArg);
        return (captures?.[0]) || this.capture();
      },
    },
    chrome,
    document,
    location: locationOverride || {
      href: "https://www.facebook.com/messages/t/999999",
      origin: "https://www.facebook.com",
      pathname: "/messages/t/999999",
      hostname: "www.facebook.com",
    },
    sessionStorage: sessionStorageRef || {
      getItem() {
        return null;
      },
      setItem() {},
    },
    console: { warn() {}, log() {}, error() {} },
    Date: FakeDate,
    Event,
    InputEvent: class InputEvent extends Event {},
    KeyboardEvent: class KeyboardEvent extends Event {},
    MouseEvent: class MouseEvent extends Event {},
    setTimeout,
    setInterval() {},
    URL,
  });
  vm.runInContext(source, context, { filename: "messengerAi.js" });
  return {
    ai: context.DealerPilotMessengerAi,
    calls,
    composerElement,
    sendButton,
    decoySendButton,
    setNow(ms) {
      currentNowMs = ms;
    },
  };
}

test("autoReply never sends a backend reply that repeats an existing conversation message", async () => {
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [
      { speaker: "Hector", text: "Hola, cuál es el precio en cash?" },
      { speaker: "Dealer", text: "Hola buenas noches, alrededor de los $39.000." },
      { speaker: "Hector", text: "Y tiene techo panorámico?" },
    ],
    intakeResponse: { ok: true, data: { suggestedReply: "Hola, cuál es el precio en cash?" } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "reply_repeats_conversation");
  assert.equal(result.suggestedReply, "");
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
  assert.equal(calls.debug.at(-1).reason, "reply_repeats_conversation");
});

test("autoReply never sends a backend reply that echoes the buyer question verbatim", async () => {
  const question = "Cuál es el precio en cash?";
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Hector", text: question }],
    intakeResponse: { ok: true, data: { suggestedReply: `Hola, ${question}` } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "reply_repeats_conversation");
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).reason, "reply_repeats_conversation");
});

test("explicit conversation refresh bypasses the quiet window and keeps follow-up eligibility", async () => {
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Buyer A", text: "Is this available?" }],
    intakeResponse: { ok: true, data: { suggestedReply: "Hello, this is Alpha Motorsports. Yes, it is available." } },
  });

  const result = await ai.captureConversation({
    automatic: true,
    forceRefresh: true,
    followUpEligible: true,
  });

  assert.equal(result.reason, "auto_reply_disabled");
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].followUpEligible, true);
});

test("a rejected repeated reply is not mislabeled as duplicate_auto_send_hash", async () => {
  const question = "Can I see the carfax?";
  const { ai, calls, setNow } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Hector", text: question }],
    intakeResponse: { ok: true, data: { suggestedReply: question } },
    nowMs: 100000,
  });

  const waiting = await ai.captureConversation({ automatic: true });
  assert.equal(waiting.reason, "waiting_quiet_window");
  setNow(108000);
  const rejected = await ai.captureConversation({ automatic: true });
  assert.equal(rejected.reason, "reply_repeats_conversation");
  assert.equal(calls.intake.length, 1);

  const retried = await ai.captureConversation({ automatic: true });
  assert.equal(retried.reason, "reply_repeats_conversation");
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.debug.at(-1).reason, "reply_repeats_conversation");
});

test("autoReply still sends a fresh backend reply that does not repeat the conversation", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Hector", text: "Cuál es el precio en cash?" }],
    intakeResponse: { ok: true, data: { suggestedReply: "El precio es $39,000. ¿Te interesa financiar o cash?" } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.autoSent, true);
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("dryRun captures a valid buyer message without backend intake or composer writes", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: true, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.dryRun, true);
  assert.equal(calls.intake.length, 0);
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.debug.at(-1).stage, "dry_run_capture");
  assert.equal(calls.debug.at(-1).backendIntakeSent, false);
});

test("dynamic facebook messages routes use the route id as stable conversation identity", async () => {
  const route = {
    href: "https://www.facebook.com/messages/t/1060211123108393",
    origin: "https://www.facebook.com",
    pathname: "/messages/t/1060211123108393",
    hostname: "www.facebook.com",
  };
  const root = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Erika · 2021 Toyota RAV4" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
    ],
  });
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    locationOverride: route,
    captures: [{
      root,
      scope: root,
      buyerName: "Erika",
      messages: [{ speaker: "Erika", text: "Hola, sigue disponible?" }],
      evidence: {
        threadRootDetected: true,
        messageScopeDetected: true,
        extractionMode: "semantic",
        selectedHeaderText: "Erika · 2021 Toyota RAV4",
        latestMessageDirection: "buyer",
        composerDetected: true,
      },
    }],
  });

  assert.equal(ai.isFacebookMessagesThreadRoute(route.pathname, route.hostname), true);
  await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.match(calls.intake[0].externalThreadRef, /facebook-messages-thread-1060211123108393/);
  assert.equal(calls.intake[0].sourceUrl, route.href);
});

test("only Facebook messages thread routes are authorized", () => {
  const { ai } = createHarness();

  assert.equal(ai.isFacebookMessagesThreadRoute("/messages/t/123", "www.facebook.com"), true);
  assert.equal(ai.isFacebookMessagesThreadRoute("/messages/t/456", "web.facebook.com"), true);
  assert.equal(ai.isFacebookMessagesThreadRoute("/messages/t/789", "facebook.com"), true);
  assert.equal(ai.isFacebookMessagesThreadRoute("/marketplace/inbox", "www.facebook.com"), true);
  assert.equal(ai.isFacebookMessagesThreadRoute("/marketplace/you/selling", "www.facebook.com"), false);
  assert.equal(ai.isFacebookMessagesThreadRoute("/messages/t/123", "www.messenger.com"), false);
  assert.equal(ai.isFacebookMessagesThreadRoute("/", "www.facebook.com"), false);
});

test("messages route rejects global Facebook chrome and selects the active buyer header", async () => {
  const route = {
    href: "https://www.facebook.com/messages/t/777",
    origin: "https://www.facebook.com",
    pathname: "/messages/t/777",
    hostname: "www.facebook.com",
  };
  const goodRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Erika · 2021 Toyota RAV4" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
    ],
  });
  const globalRoot = new FakeElement({
    attributes: { "aria-label": "Facebook" },
    children: [
      new FakeElement({ tagName: "h2", text: "· 10m" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
    ],
  });
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    locationOverride: route,
    captures: [
      {
        root: globalRoot,
        scope: globalRoot,
        buyerName: "Settings, help and more",
        messages: [{ speaker: "Buyer", text: "Hola, sigue disponible?" }],
        evidence: {
          threadRootDetected: true,
          messageScopeDetected: true,
          extractionMode: "semantic",
          selectedHeaderText: "· 10m",
          latestMessageDirection: "buyer",
          composerDetected: true,
        },
      },
      {
        root: goodRoot,
        scope: goodRoot,
        buyerName: "Erika",
        messages: [{ speaker: "Erika", text: "Hola, sigue disponible?" }],
        evidence: {
          threadRootDetected: true,
          messageScopeDetected: true,
          extractionMode: "semantic",
          selectedHeaderText: "Erika · 2021 Toyota RAV4",
          latestMessageDirection: "buyer",
          composerDetected: true,
        },
      },
    ],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.buyersDetected[0].selectedForProcessing, false);
  assert.equal(result.buyersDetected[1].selectedForProcessing, true);
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].buyerName, "Erika");
});

test("messages route accepts unavailable Marketplace thread when active header has buyer and vehicle", async () => {
  const route = {
    href: "https://www.facebook.com/messages/t/1648358637295655",
    origin: "https://www.facebook.com",
    pathname: "/messages/t/1648358637295655",
    hostname: "www.facebook.com",
  };
  const root = new FakeElement({
    attributes: { "aria-label": "Conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Bang · 2015 Acura TLX" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
    ],
  });
  const longQuestion =
    "Yes, Is there a dealer warranty included? How many days/miles? Does it cover engine and transmission?";
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    locationOverride: route,
    captures: [{
      root,
      scope: root,
      buyerName: "Bang",
      messages: [{ speaker: "Bang", text: longQuestion }],
      evidence: {
        threadRootDetected: true,
        messageScopeDetected: true,
        extractionMode: "semantic",
        selectedHeaderText: "Bang · 2015 Acura TLX",
        latestMessageDirection: "buyer",
        composerDetected: true,
      },
    }],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].buyerName, "Bang");
  assert.equal(calls.intake[0].detectedVehicleTitle, "2015 Acura TLX");
  assert.equal(calls.intake[0].marketplaceContextDetected, true);
  assert.equal(calls.intake[0].currentMessage, longQuestion);
  assert.equal(result.reason, "auto_reply_disabled");
});

test("autoReply disabled requests a suggestion but never writes to Messenger", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].type, "CONVERSATION_INTAKE");
  assert.equal(calls.intake[0].currentMessage, "Is this available?");
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "auto_reply_disabled");
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("selected chat header vehicle beats unrelated listing card headings", async () => {
  const root = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "2025 Toyota Tacoma" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
      new FakeElement({ tagName: "button", attributes: { "aria-label": "Send" }, text: "Send" }),
    ],
  });
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    captures: [{
      root,
      scope: root,
      buyerName: "Ali",
      messages: [{ speaker: "Ali", text: "Is this available?" }],
      evidence: {
        threadRootDetected: true,
        messageScopeDetected: true,
        extractionMode: "semantic",
        selectedHeaderText: "Ali · 2021 Tesla MODEL Y",
        latestMessageDirection: "buyer",
        composerDetected: true,
        threadIdentity: "facebook-thread-ali-tesla-model-y",
      },
    }],
  });

  await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].buyerName, "Ali");
  assert.equal(calls.intake[0].detectedVehicleTitle, "2021 Tesla MODEL Y");
});

test("autoReply enabled refuses to send when the composer is missing", async () => {
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    composer: false,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "composer_missing");
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("autoReply writes and sends through the composer with CDP", async () => {
  const { ai, calls, composerElement, sendButton, decoySendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    sendSucceeds: true,
    includeDecoySendButton: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.deepEqual(decoySendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("autoReply ignores the voice control and sends through the composer", async () => {
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    dynamicSendControl: true,
    debuggerSendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.equal(sendButton.getAttribute("aria-label"), "Send a voice clip");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("autoReply waits for delayed Facebook send confirmation before blocking", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    debuggerSendSucceeds: true,
    sendClearDelayMs: 700,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("automatic quiet window uses a stable buyer-message key when DOM history changes", async () => {
  const messages = [{ speaker: "Omar", text: "Good afternoon, is this still available?" }];
  const { ai, calls, composerElement, sendButton, setNow } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    sendSucceeds: true,
    nowMs: 100000,
  });
  const first = await ai.captureConversation({ automatic: true });

  assert.equal(first.reason, "waiting_quiet_window");
  assert.equal(calls.intake.length, 0);

  messages.unshift({ speaker: "Dealer", text: "Send a quick response" });
  messages.unshift({ speaker: "Omar", text: "Hi, I saw this on Marketplace earlier." });
  setNow(108000);
  const second = await ai.captureConversation({ automatic: true });

  assert.equal(calls.intake.length, 1);
  assert.equal(second.autoSent, true);
  assert.equal(second.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
});

test("autoReply reports delivery_unconfirmed when Facebook leaves the draft in the composer", async () => {
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    sendSucceeds: false,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "delivery_unconfirmed");
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, false);
  assert.equal(composerElement.textContent, "Yes, it is available.");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("autoReply never marks an empty composer as delivered when CDP writing failed", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    composerWriteSucceeds: false,
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "composer_write_unconfirmed");
  assert.equal(result.sendMethod, "debugger_composer_write");
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.messages.some((message) => message.type === "DEBUGGER_COMPOSER_SUBMIT"), false);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("autoReply confirms delivery from visible Dealer bubble when composer does not clear", async () => {
  const suggestedReply =
    "Solo necesitas tu ID y una cuenta bancaria activa; puede ser pasaporte o Tax ID. ¿Cuál es el mejor número de teléfono para ayudarte con la aplicación? También puedes llamarnos al +1 703-763-4675.";
  let captureCount = 0;
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Alejandro", text: "Buenas tardes que precio,millas y documentos." }],
    intakeResponse: { ok: true, data: { suggestedReply } },
    sendSucceeds: false,
    liveCaptureFromRoot(root) {
      captureCount += 1;
      const sent = captureCount > 1;
      return {
        root,
        scope: root,
        buyerName: "Alejandro",
        messages: sent
          ? [
              { speaker: "Alejandro", text: "Buenas tardes que precio,millas y documentos." },
              { speaker: "Dealer", text: suggestedReply.replace(/\s+/g, " ") },
            ]
          : [{ speaker: "Alejandro", text: "Buenas tardes que precio,millas y documentos." }],
        evidence: {
          threadRootDetected: true,
          messageScopeDetected: true,
          extractionMode: "semantic",
          selectedHeaderText: "Alejandro - 2023 Toyota Camry SE",
          latestMessageDirection: sent ? "dealer" : "buyer",
          composerDetected: !!composerElement,
        },
      };
    },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, suggestedReply);
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("autoReply retries sending when the composer already contains the exact AI suggestion", async () => {
  const suggestedReply = "I'd be happy to help with the 2021 TOYOTA RAV4.";
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    composerText: suggestedReply,
    intakeResponse: { ok: true, data: { suggestedReply } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.composerDraftReused, true);
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("autoReply replaces a stale DealerPilot draft when the repaired suggestion changes language", async () => {
  const staleEnglishReply =
    "I'd be happy to help with the 2021 TOYOTA RAV4. Are you interested in financing it?";
  const repairedSpanishReply =
    "Con gusto te ayudo con la 2021 TOYOTA RAV4. ¿Te interesa financiarla?";
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Buyer", text: "Estoy interesado" }],
    composerText: staleEnglishReply,
    intakeResponse: { ok: true, data: { suggestedReply: repairedSpanishReply, deliveryRetry: true } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.composerDraftReused, false);
  assert.equal(result.composerDraftReplaced, true);
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("Spanish roof question never sends an English backend reply", async () => {
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Hector", text: "Esa tiene techo panoramico?" }],
    intakeResponse: {
      ok: true,
      data: {
        suggestedReply:
          "An advisor can confirm the exact cash price for the vehicle — what's the best phone number to reach you?",
      },
    },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "suggested_reply_language_mismatch");
  assert.equal(result.suggestedReply, "");
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("terminal Spanish acknowledgement is not sent to AI and receives no automatic reply", async () => {
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Hector", text: "Ok, gracias" }],
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "terminal_acknowledgement");
  assert.equal(calls.intake.length, 0);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "blocked");
});

test("group system event message is not sent to AI and receives no automatic reply", async () => {
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Gerardo", text: "Gerardo Claure added Norma Guzman to the group." }],
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "group_system_event");
  assert.equal(calls.intake.length, 0);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "blocked");
});

test("Facebook rating card is blocked before conversation intake", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{
      speaker: "Buyer",
      text: "You can now rate each other People may rate one another based on their interactions or transactions. Rate Barış",
    }],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "facebook_rating_card");
  assert.equal(calls.intake.length, 0);
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.debug.at(-1).stage, "blocked");
});

test("autoReply replaces stale ratings draft with requirements answer and sends", async () => {
  const staleRatingsReply =
    "We don't handle ratings here; are you still interested in the 2021 TOYOTA RAV4?";
  const wrongBackendReply =
    "Perfecto. ¿Cuál es el mejor número de teléfono para ayudarte con el financiamiento?";
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Erika", text: "Q se necesita para aplicar?" }],
    composerText: staleRatingsReply,
    intakeResponse: { ok: true, data: { suggestedReply: wrongBackendReply } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].currentMessage, "Q se necesita para aplicar?");
  assert.equal(
    result.suggestedReply,
    "Solo necesitas tu ID y una cuenta bancaria activa; puede ser pasaporte o Tax ID. ¿Cuál es el mejor número de teléfono para ayudarte con la aplicación? También puedes llamarnos al +1 703-763-4675.",
  );
  assert.equal(result.autoSent, true);
  assert.equal(result.composerDraftReplaced, true);
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("autoReply sends a pending own phone draft instead of blocking composer_not_empty", async () => {
  const pendingPhoneDraft =
    "Sorry to hear that \u2014 what's the best phone number to reach you about the 2015 ACURA TLX so our finance team can help?";
  const refreshedPhoneReply =
    "Sorry to hear that. What's the best phone number to reach you about the 2015 ACURA TLX so our finance team can help?";
  const { ai, calls, composerElement, sendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Bang", text: "We're gone sorry" }],
    composerText: pendingPhoneDraft,
    intakeResponse: { ok: true, data: { suggestedReply: refreshedPhoneReply } },
    sendSucceeds: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.composerDraftReused, false);
  assert.equal(result.composerDraftReplaced, true);
  assert.equal(result.sendMethod, "debugger_main_world_submit");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
});

test("autoReply revalidates the same root before writing to Messenger", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Buyer A", text: "so how can we make this work" }],
    intakeResponse: { ok: true, data: { suggestedReply: "Great. What's the best phone number?" } },
    liveCaptureFromRoot(root) {
      return {
        root,
        scope: root,
        buyerName: "Buyer A",
        messages: [
          { speaker: "Buyer A", text: "so how can we make this work" },
          { speaker: "Dealer", text: "Great. What's the best phone number?" },
        ],
        evidence: {
          threadRootDetected: true,
          messageScopeDetected: true,
          extractionMode: "semantic",
          selectedHeaderText: "Buyer A - 2021 Toyota RAV4",
          latestMessageDirection: "dealer",
        },
      };
    },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "new_dealer_message_in_history");
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("conversation closing acknowledgement stops automation before backend intake", async () => {
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Luis", text: "No me interesa, gracias" }],
  });

  const result = await ai.captureConversation({ automatic: true });

  assert.equal(result.reason, "conversation_closed");
  assert.equal(calls.intake.length, 0);
});

test("autoReply blocks when an operator replies manually while backend intake is pending", async () => {
  const messages = [{ speaker: "Luis", text: "Dónde está ubicado?" }];
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    intakeResponse: {
      ok: true,
      data: {
        suggestedReply:
          "Estamos ubicados en 9120 Euclid Ave, Manassas, VA 20110. ¿Te gustaría venir a verlo o te interesa financiarlo?",
      },
    },
    sendSucceeds: true,
    onIntake() {
      messages.push({
        speaker: "Dealer",
        text: "Estamos ubicados en 9120 Euclid Ave, Manassas, VA 20110. ¿Sigues interesado en el vehículo?",
      });
    },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "manual_reply_after_buyer");
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.messages.some((message) => message.type === "DEBUGGER_COMPOSER_SUBMIT"), false);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("autoReply requeues instead of sending when Facebook changes thread before send", async () => {
  const locationRef = {
    href: "https://www.facebook.com/messages/t/999999",
    origin: "https://www.facebook.com",
    pathname: "/messages/t/999999",
    hostname: "www.facebook.com",
  };
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Luis", text: "Is this still available?" }],
    sendSucceeds: true,
    locationOverride: locationRef,
    onIntake() {
      locationRef.href = "https://www.facebook.com/messages/t/123123";
      locationRef.pathname = "/messages/t/123123";
    },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "thread_changed_before_send");
  assert.equal(composerElement.textContent, "");
  assert.equal(calls.messages.some((message) => message.type === "DEBUGGER_COMPOSER_SUBMIT"), false);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("autoReply refuses to overwrite an operator draft in the composer", async () => {
  const { ai, calls, composerElement } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    composerText: "Manual note already typed",
    intakeResponse: { ok: true, data: { suggestedReply: "Great. What's the best phone number?" } },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "composer_not_empty");
  assert.equal(composerElement.textContent, "Manual note already typed");
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
});

test("latest Dealer message is blocked as buyer_message_missing", async () => {
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages: [{ speaker: "Dealer", text: "Yes, it is available." }],
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "buyer_message_missing");
  assert.equal(calls.intake.length, 0);
  assert.equal(calls.debug.at(-1).stage, "blocked");
});

test("multiple open buyer chats process one winner and keep the rest as diagnostics", async () => {
  const captureA = {
    root: new FakeElement({
      attributes: { "aria-label": "Marketplace conversation A" },
      children: [
        new FakeElement({ tagName: "h2", text: "Buyer A - 2021 Toyota RAV4" }),
        new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
        new FakeElement({ tagName: "button", attributes: { "aria-label": "Send" }, text: "Send" }),
      ],
    }),
    scope: null,
    buyerName: "Buyer A",
    messages: [{ speaker: "Buyer", text: "Is this available?" }],
    evidence: {
      threadRootDetected: true,
      messageScopeDetected: true,
      extractionMode: "semantic",
      threadIdentity: "thread-a",
      selectedHeaderText: "Buyer A - 2021 Toyota RAV4",
      latestMessageDirection: "buyer",
      composerDetected: true,
    },
  };
  captureA.scope = captureA.root;
  const captureB = {
    root: new FakeElement({
      attributes: { "aria-label": "Marketplace conversation B" },
      children: [
        new FakeElement({ tagName: "h2", text: "Buyer B - 2022 Honda Civic" }),
        new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
        new FakeElement({ tagName: "button", attributes: { "aria-label": "Send" }, text: "Send" }),
      ],
    }),
    scope: null,
    buyerName: "Buyer B",
    messages: [{ speaker: "Buyer", text: "What is the best number?" }],
    evidence: {
      threadRootDetected: true,
      messageScopeDetected: true,
      extractionMode: "semantic",
      threadIdentity: "thread-b",
      selectedHeaderText: "Buyer B - 2022 Honda Civic",
      latestMessageDirection: "buyer",
      composerDetected: true,
    },
  };
  captureB.scope = captureB.root;

  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    captures: [captureA, captureB],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.conversationCount, 2);
  assert.deepEqual(result.buyersDetected.map((buyer) => buyer.buyerName), ["Buyer A", "Buyer B"]);
  assert.deepEqual(result.buyersDetected.map((buyer) => buyer.selectedForProcessing), [true, false]);
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].currentMessage, "Is this available?");
});

test("buyer repeating the same question is processed again instead of duplicate_auto_send_hash", async () => {
  const question = "I am interested in this truck and would want to buy under my business.";
  const messages = [{ speaker: "Nabeel", text: question }];
  const { ai, calls, setNow } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    sendSucceeds: true,
    nowMs: 100000,
  });

  const first = await ai.captureConversation({ automatic: true });
  assert.equal(first.reason, "waiting_quiet_window");
  setNow(108000);
  const sent = await ai.captureConversation({ automatic: true });
  assert.equal(sent.autoSent, true);
  assert.equal(sent.deliveryConfirmed, true);
  assert.equal(calls.intake.length, 1);

  messages.push({ speaker: "Nabeel", text: question });
  const second = await ai.captureConversation({ automatic: true });
  assert.equal(second.reason, "waiting_quiet_window");
  assert.equal(calls.debug.at(-1).stage, "waiting_quiet_window");
  setNow(116000);
  const resent = await ai.captureConversation({ automatic: true });
  assert.equal(calls.intake.length, 2);
  assert.equal(resent.autoSent, true);
  assert.equal(resent.deliveryConfirmed, true);
});

test("the same buyer question is processed up to ten occurrences and the eleventh is blocked", async () => {
  const question = "Please answer, I want to know where I can test drive it.";
  const messages = [{ speaker: "Virginia", text: question }];
  const { ai, calls, setNow } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    sendSucceeds: true,
    nowMs: 100000,
  });

  for (let occurrence = 1; occurrence <= 10; occurrence += 1) {
    const waiting = await ai.captureConversation({ automatic: true });
    assert.equal(waiting.reason, "waiting_quiet_window");
    setNow(100000 + occurrence * 8000);
    const sent = await ai.captureConversation({ automatic: true });
    assert.equal(sent.autoSent, true);
    if (occurrence < 10) messages.push({ speaker: "Virginia", text: question });
  }

  messages.push({ speaker: "Virginia", text: question });
  const blocked = await ai.captureConversation({ automatic: true });

  assert.equal(calls.intake.length, 10);
  assert.equal(blocked.skipped, true);
  assert.equal(blocked.reason, "repeated_question_limit_exceeded");
  assert.equal(calls.debug.at(-1).stage, "blocked");
});

test("a repeated buyer question may receive the same reply again when the old reply predates it", async () => {
  const question = "Please answer, I want to know where I can test drive it.";
  const suggestedReply =
    "I can help right away. What's the best phone number to reach you? You can also call us at +1 703-763-4675.";
  const messages = [
    { speaker: "Virginia", text: question },
    { speaker: "Dealer", text: suggestedReply },
    { speaker: "Virginia", text: question },
  ];
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    intakeResponse: { ok: true, data: { suggestedReply, deliveryRetry: true } },
    sendSucceeds: true,
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.notEqual(result.reason, "reply_already_delivered");
  assert.equal(result.deliveryConfirmed, true);
});

test("quiet-window state survives a Messenger page reload before intake", async () => {
  const sessionStore = {};
  const sessionStorageRef = {
    getItem(key) {
      return sessionStore[key] || null;
    },
    setItem(key, value) {
      sessionStore[key] = value;
    },
  };
  const messages = [{ speaker: "Nio", text: "Hello, is this still available?" }];
  const firstHarness = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    nowMs: 100000,
    sessionStorageRef,
  });

  const first = await firstHarness.ai.captureConversation({ automatic: true });

  assert.equal(first.reason, "waiting_quiet_window");
  assert.equal(firstHarness.calls.intake.length, 0);

  const secondHarness = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    messages,
    nowMs: 108000,
    sessionStorageRef,
  });

  const second = await secondHarness.ai.captureConversation({ automatic: true });

  assert.equal(second.reason, "auto_reply_disabled");
  assert.equal(secondHarness.calls.intake.length, 1);
  assert.equal(secondHarness.calls.intake[0].currentMessage, "Hello, is this still available?");
  assert.equal(secondHarness.calls.debug.at(-1).stage, "auto_send_blocked");
});

test("duplicate DOM roots for the same buyer message are reported and processed once", async () => {
  const makeCapture = () => {
    const root = new FakeElement({
      attributes: { "aria-label": "Marketplace conversation" },
      children: [
        new FakeElement({ tagName: "h2", text: "Omar · 2018 Honda ODYSSEY" }),
        new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
      ],
    });
    return {
      root,
      scope: root,
      buyerName: "Omar",
      messages: [{ speaker: "Omar", text: "Clean title?" }],
      evidence: {
        threadRootDetected: true,
        messageScopeDetected: true,
        extractionMode: "semantic",
        selectedHeaderText: "Omar · 2018 Honda ODYSSEY",
        latestMessageDirection: "buyer",
        composerDetected: true,
      },
    };
  };
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    captures: [makeCapture(), makeCapture(), makeCapture()],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(result.conversationCount, 1);
  assert.equal(result.buyersDetected.length, 1);
  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].currentMessage, "Clean title?");
});

test("valid buyer chat beats later UI noise candidate", async () => {
  const goodRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Juan - 2021 Toyota RAV4" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
      new FakeElement({ tagName: "button", attributes: { "aria-label": "Send" }, text: "Send" }),
    ],
  });
  const noiseRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Choose an emoji" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" } }),
    ],
  });
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    captures: [
      {
        root: goodRoot,
        scope: goodRoot,
        buyerName: "Juan",
        messages: [{ speaker: "Juan", text: "Hola. Sigue disponible?" }],
        evidence: {
          threadRootDetected: true,
          messageScopeDetected: true,
          extractionMode: "semantic",
          selectedHeaderText: "Juan - 2021 Toyota RAV4",
          latestMessageDirection: "buyer",
          composerDetected: true,
          threadIdentity: "thread-juan",
        },
      },
      {
        root: noiseRoot,
        scope: noiseRoot,
        buyerName: "Choose an emoji",
        messages: [{ speaker: "Buyer", text: "Aa" }],
        evidence: {
          threadRootDetected: true,
          messageScopeDetected: false,
          extractionMode: "visual_bubbles",
          selectedHeaderText: "Choose an emoji",
          latestMessageDirection: "buyer",
          composerDetected: true,
        },
      },
    ],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].buyerName, "Juan");
  assert.equal(calls.intake[0].currentMessage, "Hola. Sigue disponible?");
  assert.deepEqual(result.buyersDetected.map((buyer) => buyer.selectedForProcessing), [true, false]);
  assert.equal(calls.debug.at(-1).buyerName, "Juan");
});

test("Message sent metadata cannot beat the real buyer message", async () => {
  const metadataRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Marcela - 2023 Toyota Camry SE" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
      new FakeElement({ tagName: "button", attributes: { "aria-label": "Send" }, text: "Send" }),
    ],
  });
  const buyerRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Marcela - 2023 Toyota Camry SE" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
      new FakeElement({ tagName: "button", attributes: { "aria-label": "Send" }, text: "Send" }),
    ],
  });
  const baseEvidence = {
    threadRootDetected: true,
    messageScopeDetected: true,
    extractionMode: "visual_bubbles",
    selectedHeaderText: "Marcela - 2023 Toyota Camry SE",
    latestMessageDirection: "buyer",
    composerDetected: true,
    threadIdentity: "thread-marcela",
  };
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    captures: [
      {
        root: metadataRoot,
        scope: metadataRoot,
        buyerName: "Marcela",
        messages: [{ speaker: "Marcela", text: "Message sent" }],
        evidence: baseEvidence,
      },
      {
        root: buyerRoot,
        scope: buyerRoot,
        buyerName: "Marcela",
        messages: [{ speaker: "Marcela", text: "Hola. Sigue disponible?" }],
        evidence: baseEvidence,
      },
    ],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].currentMessage, "Hola. Sigue disponible?");
  assert.deepEqual(result.buyersDetected.map((buyer) => buyer.selectedForProcessing), [false, true]);
});

test("Facebook Are you interested quick reply loses to a real buyer message", async () => {
  const quickReplyRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Gabriel - 2022 Toyota TUNDRA" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
    ],
  });
  const buyerRoot = new FakeElement({
    attributes: { "aria-label": "Marketplace conversation" },
    children: [
      new FakeElement({ tagName: "h2", text: "Gabriel - 2022 Toyota TUNDRA" }),
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" } }),
    ],
  });
  const baseEvidence = {
    threadRootDetected: true,
    messageScopeDetected: true,
    extractionMode: "semantic",
    selectedHeaderText: "Gabriel - 2022 Toyota TUNDRA",
    latestMessageDirection: "buyer",
    composerDetected: true,
    threadIdentity: "thread-gabriel",
  };
  const { ai, calls } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: false, sellerProfileNames: ["Andres Ibanez"] },
    captures: [
      {
        root: quickReplyRoot,
        scope: quickReplyRoot,
        buyerName: "Gabriel",
        messages: [{ speaker: "Gabriel", text: "Yes, are you interested?" }],
        evidence: baseEvidence,
      },
      {
        root: buyerRoot,
        scope: buyerRoot,
        buyerName: "Gabriel",
        messages: [{ speaker: "Gabriel", text: "Hola. ¿Sigue disponible?" }],
        evidence: baseEvidence,
      },
    ],
  });

  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(calls.intake[0].currentMessage, "Hola. ¿Sigue disponible?");
  assert.deepEqual(result.buyersDetected.map((buyer) => buyer.selectedForProcessing), [false, true]);
});
