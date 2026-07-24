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
  includeDecoySendButton = false,
  locationOverride = null,
} = {}) {
  const calls = { messages: [], debug: [], intake: [] };
  const composerElement = composer
    ? new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Message" },
        rect: { left: 100, top: 400, width: 360, height: 40 },
      })
    : null;
  const sendButton = new FakeElement({
    tagName: "button",
    attributes: { "aria-label": "Send" },
    text: "Send",
    rect: { left: 470, top: 400, width: 40, height: 40 },
    onClick() {
      if (!sendSucceeds || !composerElement) return;
      composerElement.value = "";
      composerElement.innerText = "";
      composerElement.textContent = "";
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
      if (command === "insertText" && composerElement) composerElement.textContent = value;
      if (command === "selectAll" && composerElement) composerElement.textContent = "";
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
          callback(intakeResponse || { ok: true, data: { suggestedReply: "Yes, it is available." } });
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
        return /^\/messages\/t\/[^/?#]+\/?$/i.test(pathname || "");
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
      href: "https://www.facebook.com/marketplace/inbox",
      origin: "https://www.facebook.com",
      pathname: "/marketplace/inbox",
      hostname: "www.facebook.com",
    },
    console: { warn() {}, log() {}, error() {} },
    Date,
    Event,
    InputEvent: class InputEvent extends Event {},
    KeyboardEvent: class KeyboardEvent extends Event {},
    MouseEvent: class MouseEvent extends Event {},
    setTimeout,
    setInterval() {},
    URL,
  });
  vm.runInContext(source, context, { filename: "messengerAi.js" });
  return { ai: context.DealerPilotMessengerAi, calls, composerElement, sendButton, decoySendButton };
}

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

  assert.equal(ai.isMarketplaceMessengerRoute(route.pathname, route.hostname), true);
  await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.match(calls.intake[0].externalThreadRef, /facebook-messages-thread-1060211123108393/);
  assert.equal(calls.intake[0].sourceUrl, route.href);
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

test("autoReply clicks the send control nearest the winning chat and confirms the composer cleared", async () => {
  const { ai, calls, composerElement, sendButton, decoySendButton } = createHarness({
    settings: { dryRun: false, autoReplyEnabled: true, sellerProfileNames: ["Andres Ibanez"] },
    sendSucceeds: true,
    includeDecoySendButton: true,
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, true);
  assert.equal(result.sendMethod, "button_click");
  assert.equal(result.deliveryConfirmed, true);
  assert.equal(composerElement.textContent, "");
  assert.deepEqual(sendButton.events, ["native-click"]);
  assert.deepEqual(decoySendButton.events, []);
  assert.equal(calls.debug.at(-1).stage, "intake_ok");
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
  assert.equal(result.sendMethod, "button_click");
  assert.equal(result.deliveryConfirmed, false);
  assert.equal(composerElement.textContent, "Yes, it is available.");
  assert.deepEqual(sendButton.events, ["native-click"]);
  assert.equal(calls.debug.at(-1).stage, "auto_send_blocked");
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
          latestMessageDirection: "dealer",
        },
      };
    },
  });
  const result = await ai.captureConversation({ automatic: false });

  assert.equal(calls.intake.length, 1);
  assert.equal(result.autoSent, false);
  assert.equal(result.reason, "latest_message_not_buyer");
  assert.equal(composerElement.textContent, "");
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
