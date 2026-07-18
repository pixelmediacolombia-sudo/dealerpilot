import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const publisherFlowSource = readFileSync(
  new URL("../src/content/facebook/publisherFlow.js", import.meta.url),
  "utf8",
);

function loadDetectionHarness({ hostname, pathname, rootSignals }) {
  const start = publisherFlowSource.indexOf("  function isMessengerUrl()");
  const end = publisherFlowSource.indexOf("  function detectPageState()", start);
  assert.ok(start >= 0 && end > start, "Messenger detection functions must remain extractable");

  class FakeElement {
    constructor({ role = "", signals = {}, tagName = "DIV", attributes = {}, area = 480000 } = {}) {
      this.role = role;
      this.signals = signals;
      this.tagName = tagName;
      this.attributes = { ...attributes };
      this.parentElement = null;
      this.innerText = signals.marketplaceText ? "Marketplace" : "";
      this.area = area;
    }

    getBoundingClientRect() {
      return { width: this.area / 600, height: 600 };
    }

    getAttribute(name) {
      if (name === "role") return this.role || null;
      return this.attributes[name] ?? null;
    }

    matches(selector) {
      if (selector === '[role="region"]') return this.role === "region";
      if (selector.includes('/marketplace/item/')) return this.signals.marketplaceLink === true;
      return false;
    }

    closest(selector) {
      return selector.includes(this.role) ? this : null;
    }

    querySelector(selector) {
      if (selector.includes('[role="log"]') && this.signals.messageLog) return new FakeElement();
      if (selector.includes('[contenteditable="true"]') && this.signals.composer) return this.composer;
      if (selector.includes('[role="heading"]') && this.signals.heading) return new FakeElement();
      if (selector.includes("h2") && this.signals.nativeHeading) return new FakeElement();
      if (selector.includes('/marketplace/item/') && this.signals.marketplaceLink) return new FakeElement();
      return null;
    }

    querySelectorAll(selector) {
      if ((selector.includes('[contenteditable="true"]') || selector.includes("textarea")) && this.signals.composer) {
        return [this.composer];
      }
      return [];
    }

    contains(candidate) {
      let current = candidate;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    }
  }

  const root = new FakeElement({ role: "region", signals: rootSignals });
  const composer = new FakeElement({
    attributes: {
      contenteditable: "true",
      "aria-placeholder": rootSignals.composerPlaceholder || "Aa",
      "data-lexical-editor": rootSignals.lexicalComposer === false ? null : "true",
    },
    area: 20000,
  });
  composer.parentElement = root;
  root.composer = composer;
  composer.closest = () => root;
  const documentElement = new FakeElement({ tagName: "HTML", area: 1000000 });
  root.parentElement = documentElement;
  const document = {
    documentElement,
    querySelectorAll(selector) {
      if (selector.includes("Conversation titled")) return [root];
      if (selector.includes('[contenteditable="true"]')) return rootSignals.composer ? [composer] : [];
      if (selector.includes('[role="dialog"]') && selector.includes('[role="main"]')) return [root];
      return [];
    },
  };
  const context = vm.createContext({
    Element: FakeElement,
    document,
    location: { hostname, pathname },
  });
  vm.runInContext(
    `${publisherFlowSource.slice(start, end)}\n` +
      "globalThis.__detection = { findMarketplaceThreadRoot, findMessengerRoot, getMessengerDetectionDebug, isMessengerUiVisible };",
    context,
    { filename: "publisherFlow-detection.js" },
  );
  return context.__detection;
}

function loadAvailabilityQuickReplyHarness(label) {
  const start = publisherFlowSource.indexOf("    function normalizeMarketplaceAvailabilityLabel");
  const end = publisherFlowSource.indexOf("    async function acceptMarketplaceAvailabilityQuickReply", start);
  assert.ok(start >= 0 && end > start, "Availability quick-reply functions must remain extractable");

  const button = {
    disabled: false,
    innerText: label,
    textContent: label,
    getAttribute: () => null,
  };
  const root = {
    querySelectorAll: () => [button],
  };
  const context = vm.createContext({
    cleanMessengerText: (text) => String(text || "").trim(),
    findMessengerRoot: () => root,
    visible: () => true,
  });
  vm.runInContext(
    `${publisherFlowSource.slice(start, end)}\n` +
      "globalThis.__availability = { findMarketplaceAvailabilityAcceptButton, createMarketplaceAvailabilityFallbackMessage };",
    context,
    { filename: "publisherFlow-availability.js" },
  );
  return { button, ...context.__availability };
}

function loadAvailabilitySnapshotHarness() {
  const start = publisherFlowSource.indexOf("    function scrapeConversationSnapshot()");
  const end = publisherFlowSource.indexOf("    function findConversationScrollContainer", start);
  assert.ok(start >= 0 && end > start, "Messenger snapshot function must remain extractable");

  const fallbackMessage = { speaker: "Juan", text: "Is it still available?" };
  const context = vm.createContext({
    findMarketplaceThreadRoot: () => ({}),
    getThreadHeadingText: () => "Juan · 2012 Mazda Mazda3",
    extractBuyerNameFromThreadHeader: () => "Juan",
    findMessengerMessageScope: () => null,
    createMarketplaceAvailabilityFallbackMessage: () => fallbackMessage,
    collectMatchedThreadSelectors: () => [],
  });
  vm.runInContext(
    `${publisherFlowSource.slice(start, end)}\n` +
      "globalThis.__snapshot = { scrapeConversationSnapshot };",
    context,
    { filename: "publisherFlow-availability-snapshot.js" },
  );
  return context.__snapshot.scrapeConversationSnapshot();
}

test("Marketplace inbox detects the active seller thread when Facebook renders no item anchor", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/marketplace/inbox",
    rootSignals: {
      messageLog: true,
      composer: true,
      heading: true,
      marketplaceLink: false,
    },
  });

  assert.ok(detection.findMarketplaceThreadRoot());
  assert.ok(detection.findMessengerRoot());
  assert.equal(detection.isMessengerUiVisible(), true);
  assert.deepEqual(
    {
      rootDetected: detection.getMessengerDetectionDebug().rootDetected,
      composerDetected: detection.getMessengerDetectionDebug().composerDetected,
      headingDetected: detection.getMessengerDetectionDebug().headingDetected,
      marketplaceEvidence: detection.getMessengerDetectionDebug().marketplaceEvidence,
    },
    {
      rootDetected: true,
      composerDetected: true,
      headingDetected: true,
      marketplaceEvidence: false,
    },
  );
});

test("Marketplace inbox detects Facebook's native h2 thread heading", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/marketplace/inbox",
    rootSignals: {
      messageLog: true,
      composer: true,
      heading: false,
      nativeHeading: true,
      marketplaceLink: false,
    },
  });

  assert.ok(detection.findMarketplaceThreadRoot());
  assert.ok(detection.findMessengerRoot());
  assert.equal(detection.isMessengerUiVisible(), true);
});

test("Marketplace inbox detects an active chat when Facebook omits role=log and semantic headings", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/marketplace/inbox",
    rootSignals: {
      messageLog: false,
      composer: true,
      heading: false,
      nativeHeading: false,
      marketplaceLink: false,
    },
  });

  assert.ok(detection.findMarketplaceThreadRoot());
  assert.ok(detection.findMessengerRoot());
  assert.equal(detection.isMessengerUiVisible(), true);
});

test("Marketplace floating chat is detected on another Facebook route", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/professional_dashboard/",
    rootSignals: {
      messageLog: false,
      composer: true,
      heading: false,
      marketplaceLink: false,
      marketplaceText: true,
    },
  });

  assert.ok(detection.findMarketplaceThreadRoot());
  assert.ok(detection.findMessengerRoot());
  assert.equal(detection.isMessengerUiVisible(), true);
});

test("generic floating chat on another Facebook route stays excluded", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/professional_dashboard/",
    rootSignals: {
      messageLog: true,
      composer: true,
      heading: true,
      marketplaceLink: false,
      marketplaceText: false,
    },
  });

  assert.equal(detection.findMarketplaceThreadRoot(), null);
  assert.equal(detection.isMessengerUiVisible(), false);
});

test("Marketplace inbox list without an active composer stays excluded", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/marketplace/inbox",
    rootSignals: {
      messageLog: false,
      composer: false,
      heading: false,
      nativeHeading: true,
      marketplaceLink: false,
    },
  });

  assert.equal(detection.findMarketplaceThreadRoot(), null);
  assert.equal(detection.isMessengerUiVisible(), false);
});

test("generic Messenger UI without Marketplace evidence stays excluded from Sales AI", () => {
  const detection = loadDetectionHarness({
    hostname: "www.facebook.com",
    pathname: "/messages/t/123",
    rootSignals: {
      messageLog: true,
      composer: true,
      heading: true,
      marketplaceLink: false,
    },
  });

  assert.equal(detection.findMarketplaceThreadRoot(), null);
  assert.equal(detection.isMessengerUiVisible(), false);
});

test("Messenger capture falls back to the validated active thread when role=log is absent", () => {
  assert.match(
    publisherFlowSource,
    /function findMessengerMessageScope\(root\)[\s\S]*if \(!semanticMessages\.length\) return root;/,
  );
  assert.match(
    publisherFlowSource,
    /const messageScope = findMessengerMessageScope\(main\);[\s\S]*messageScope\.querySelectorAll\('\[aria-label\]'\)/,
  );
});

test("Messenger capture reads unlabeled rounded chat bubbles inside the active thread", () => {
  assert.match(publisherFlowSource, /function findPlainMessengerBubble/);
  assert.match(publisherFlowSource, /function parsePlainMessengerMessages/);
  assert.match(publisherFlowSource, /backgroundColor/);
  assert.match(publisherFlowSource, /rightGap \+ 16 < leftGap/);
  assert.match(publisherFlowSource, /messages\.push\(\.\.\.parsePlainMessengerMessages/);
});

test("Marketplace availability quick reply is accepted once before the financing question", () => {
  const english = loadAvailabilityQuickReplyHarness("Yes, are you interested?");
  assert.equal(english.findMarketplaceAvailabilityAcceptButton(), english.button);
  const englishFallback = english.createMarketplaceAvailabilityFallbackMessage("Juan");
  assert.equal(englishFallback.speaker, "Juan");
  assert.equal(englishFallback.text, "Is it still available?");

  const truncated = loadAvailabilityQuickReplyHarness("Yes, are you inter...");
  assert.equal(truncated.findMarketplaceAvailabilityAcceptButton(), truncated.button);
  assert.equal(
    truncated.createMarketplaceAvailabilityFallbackMessage("Juan").text,
    "Is it still available?",
  );

  const spanish = loadAvailabilityQuickReplyHarness("Sí, está disponible");
  const spanishFallback = spanish.createMarketplaceAvailabilityFallbackMessage("Juan");
  assert.equal(spanishFallback.text, "¿Sigue disponible?");

  const snapshot = loadAvailabilitySnapshotHarness();
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].speaker, "Juan");
  assert.equal(snapshot.messages[0].text, "Is it still available?");
  assert.equal(snapshot.evidence.availabilityQuickReplyVisible, true);

  assert.match(publisherFlowSource, /MESSENGER_CLAIM_AVAILABILITY_ACTION/);
  assert.match(publisherFlowSource, /availabilityQuickReplyAccepted/);
  assert.match(publisherFlowSource, /if \(messages\.length >= 1\)/);
});

test("Messenger auto-send excludes generic and quick-response buttons", () => {
  const start = publisherFlowSource.indexOf("    function findMessengerSendButton()");
  const end = publisherFlowSource.indexOf("    function readMessengerComposerText", start);
  assert.ok(start >= 0 && end > start, "Messenger send-button resolver must remain extractable");
  const resolverSource = publisherFlowSource.slice(start, end);
  assert.doesNotMatch(resolverSource, /'\[role="button"\]'/);
  assert.doesNotMatch(resolverSource, /'button'/);
  assert.match(resolverSource, /\[aria-label\*=\"send\" i\]/);
});

test("Messenger intake sends canonical Buyer and Dealer role labels", () => {
  assert.match(
    publisherFlowSource,
    /m\.speaker === "Dealer" \? "Dealer" : "Buyer"/,
  );
});

test("Messenger automatic replies wait for a quiet buyer window and guard their own reply", () => {
  assert.match(publisherFlowSource, /MESSENGER_REPLY_QUIET_MS = 7000/);
  assert.match(publisherFlowSource, /MESSENGER_CAPTURE_INTERVAL_MS = 2000/);
  assert.match(publisherFlowSource, /captureHash !== pendingMessengerBuyerHash/);
  assert.match(publisherFlowSource, /now - pendingMessengerBuyerSince < MESSENGER_REPLY_QUIET_MS/);
  assert.match(publisherFlowSource, /Waiting for the buyer to finish typing/);
  assert.match(publisherFlowSource, /latestText === lastMessengerAutoReplyText/);
  assert.match(publisherFlowSource, /captureHash === lastMessengerAutoSendHash/);
});

test("Messenger capture reports the Sales AI pipeline stage for extension diagnostics", () => {
  assert.match(publisherFlowSource, /type: "MESSENGER_CAPTURE_DEBUG"/);
  assert.match(publisherFlowSource, /reportMessengerCaptureDebug\("blocked"/);
  assert.match(publisherFlowSource, /reportMessengerCaptureDebug\("intake_sending"/);
  assert.match(publisherFlowSource, /reportMessengerCaptureDebug\("intake_ok"/);
  assert.match(publisherFlowSource, /aiReplyReceived: !!lastReply/);
});
