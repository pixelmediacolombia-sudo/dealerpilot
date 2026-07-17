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
    constructor({ role = "", signals = {} } = {}) {
      this.role = role;
      this.signals = signals;
    }

    getBoundingClientRect() {
      return { width: 800, height: 600 };
    }

    matches(selector) {
      return selector === '[role="region"]' && this.role === "region";
    }

    closest(selector) {
      return selector.includes(this.role) ? this : null;
    }

    querySelector(selector) {
      if (selector.includes('[role="log"]') && this.signals.messageLog) return new FakeElement();
      if (selector.includes('[contenteditable="true"]') && this.signals.composer) return new FakeElement();
      if (selector.includes('[role="heading"]') && this.signals.heading) return new FakeElement();
      if (selector.includes('/marketplace/item/') && this.signals.marketplaceLink) return new FakeElement();
      return null;
    }
  }

  const root = new FakeElement({ role: "region", signals: rootSignals });
  const composer = new FakeElement();
  composer.closest = () => root;
  const document = {
    querySelectorAll(selector) {
      if (selector.includes("Conversation titled")) return [root];
      if (selector.includes('[contenteditable="true"]')) return rootSignals.composer ? [composer] : [];
      if (selector === '[role="dialog"], [role="main"]') return [root];
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
      "globalThis.__detection = { findMarketplaceThreadRoot, findMessengerRoot, isMessengerUiVisible };",
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
