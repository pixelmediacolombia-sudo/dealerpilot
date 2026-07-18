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
