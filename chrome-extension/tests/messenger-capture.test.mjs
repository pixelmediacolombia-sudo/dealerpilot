import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const captureSource = readFileSync(
  new URL("../src/content/facebook/messengerCapture.js", import.meta.url),
  "utf8",
);

function loadCaptureDom({ semantic = false, includeSecondThread = false } = {}) {
  class FakeElement {
    constructor({ tagName = "div", role = "", attributes = {}, text = "", rect, children = [] } = {}) {
      this.tagName = tagName.toUpperCase();
      this.role = role;
      this.attributes = { ...attributes };
      this.innerText = text;
      this.textContent = text;
      this.children = children;
      this.parentElement = null;
      this.rect = rect || { left: 0, right: 520, top: 0, width: 520, height: 700 };
      for (const child of children) child.parentElement = this;
    }

    getBoundingClientRect() { return this.rect; }
    getAttribute(name) { return name === "role" ? this.role || null : this.attributes[name] ?? null; }
    contains(node) {
      return node === this || this.children.some((child) => child.contains(node));
    }
    matches(selector) {
      if (selector === '[role="dialog"]') return this.role === "dialog";
      if (selector === '[role="region"]') return this.role === "region";
      if (selector === '[role="main"]') return this.role === "main";
      if (selector === '[role="log"]') return this.role === "log";
      if (selector === '[contenteditable="true"]') return this.attributes.contenteditable === "true";
      if (selector === 'textarea') return this.tagName === "TEXTAREA";
      if (selector === 'div[dir="auto"]') return this.tagName === "DIV" && this.attributes.dir === "auto";
      if (selector === 'span[dir="auto"]') return this.tagName === "SPAN" && this.attributes.dir === "auto";
      if (selector === '[data-lexical-text]') return this.attributes["data-lexical-text"] !== undefined;
      if (selector === '[aria-label]') return this.attributes["aria-label"] !== undefined;
      if (selector.includes('[aria-label*="message"')) {
        return (!selector.includes('[aria-live="polite"]') || this.attributes["aria-live"] === "polite") && /message/i.test(this.attributes["aria-label"] || "");
      }
      if (selector.includes('[aria-label*="mensaje"')) {
        return (!selector.includes('[aria-live="polite"]') || this.attributes["aria-live"] === "polite") && /mensaje/i.test(this.attributes["aria-label"] || "");
      }
      if (selector.includes('[aria-live="polite"]')) return this.attributes["aria-live"] === "polite";
      if (selector.includes('[data-testid*="message"')) return /message/i.test(this.attributes["data-testid"] || "");
      if (selector.includes('[data-testid*="messenger"')) return /messenger/i.test(this.attributes["data-testid"] || "");
      if (selector.includes('[data-pagelet*="conversation"')) return /conversation/i.test(this.attributes["data-pagelet"] || "");
      if (selector.includes('[data-testid*="conversation"')) return /conversation/i.test(this.attributes["data-testid"] || "");
      if (selector === "div" || selector === "section" || selector === "main") return ["DIV", "SECTION", "MAIN"].includes(this.tagName);
      if (selector === "span") return this.tagName === "SPAN";
      if (selector === "textarea") return this.tagName === "TEXTAREA";
      return false;
    }
    querySelectorAll(selector) {
      const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
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
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }

  const composer = new FakeElement({
    attributes: { contenteditable: "true", "aria-placeholder": "Aa", "data-lexical-editor": "true" },
    rect: { left: 20, right: 500, top: 650, width: 480, height: 40 },
  });
  const buyerBubble = new FakeElement({
    text: "Is this still available?",
    rect: { left: 20, right: 240, top: 150, width: 220, height: 50 },
    children: [new FakeElement({ attributes: { dir: "auto" }, text: "Is this still available?", rect: { left: 30, right: 230, top: 160, width: 200, height: 24 } })],
  });
  const dealerBubble = new FakeElement({
    text: "Yes, it is available.",
    rect: { left: 280, right: 500, top: 240, width: 220, height: 50 },
    children: [new FakeElement({ attributes: { dir: "auto" }, text: "Yes, it is available.", rect: { left: 290, right: 490, top: 250, width: 200, height: 24 } })],
  });
  const semanticBuyer = new FakeElement({
    attributes: { "aria-label": "Message sent at 10:00 AM by Buyer: Is this still available?" },
    text: "Is this still available?",
    rect: { left: 20, right: 240, top: 150, width: 220, height: 50 },
  });
  const semanticDealer = new FakeElement({
    attributes: { "aria-label": "Message sent at 10:01 AM by You: Yes, it is available." },
    text: "Yes, it is available.",
    rect: { left: 280, right: 500, top: 240, width: 220, height: 50 },
  });
  const children = [composer, ...(semantic ? [semanticBuyer, semanticDealer] : [buyerBubble, dealerBubble])];
  const root = new FakeElement({
    role: "dialog",
    attributes: { "aria-label": "Marketplace conversation" },
    rect: { left: 0, right: 520, top: 0, width: 520, height: 700 },
    children,
  });
  const otherRoot = includeSecondThread
    ? new FakeElement({
      role: "dialog",
      attributes: { "aria-label": "Marketplace conversation" },
      rect: { left: 600, right: 1120, top: 0, width: 520, height: 700 },
      children: [
        new FakeElement({ attributes: { contenteditable: "true" }, rect: { left: 620, right: 1100, top: 650, width: 480, height: 40 } }),
        new FakeElement({ attributes: { dir: "auto" }, text: "A different buyer", rect: { left: 620, right: 820, top: 150, width: 200, height: 24 } }),
      ],
    })
    : null;
  const document = {
    documentElement: new FakeElement({ tagName: "html" }),
    querySelectorAll(selector) {
      return [root, ...(otherRoot ? [otherRoot] : [])].filter((candidate) => candidate.matches(selector.split(",")[0].trim()));
    },
  };
  const context = vm.createContext({
    Element: FakeElement,
    document,
    location: { pathname: "/marketplace/inbox" },
    window: { getComputedStyle: () => ({ overflowY: "visible" }) },
  });
  vm.runInContext(`${captureSource}\nglobalThis.__capture = DealerPilotMessengerCapture;`, context, { filename: "messengerCapture.js" });
  return { capture: context.__capture, document, root, otherRoot };
}

test("captures unlabeled Marketplace popover bubbles without role=log", () => {
  const { capture, document } = loadCaptureDom();
  const result = capture.capture({
    document,
    location: { pathname: "/marketplace/inbox" },
    sellerNameCandidates: ["Andres Ibanez"],
  });
  assert.equal(result.evidence.threadRootDetected, true);
  assert.equal(result.evidence.messageScopeDetected, true);
  assert.equal(result.evidence.extractionMode, "visual_bubbles");
  assert.deepEqual(JSON.parse(JSON.stringify(result.messages)), [
    { speaker: "Buyer", text: "Is this still available?" },
    { speaker: "Dealer", text: "Yes, it is available." },
  ]);
});

test("prefers semantic sender descriptors and canonicalizes seller as Dealer", () => {
  const { capture, document, root } = loadCaptureDom({ semantic: true });
  assert.equal(root.querySelectorAll('[aria-label*="message" i]').length, 2);
  const result = capture.capture({
    document,
    location: { pathname: "/marketplace/inbox" },
    sellerNameCandidates: ["Andres Ibanez"],
  });
  assert.equal(result.scope, root);
  assert.equal(result.scope.querySelectorAll('[aria-label*="message" i]').length, 2);
  assert.equal(result.evidence.extractionMode, "semantic");
  assert.deepEqual(JSON.parse(JSON.stringify(result.messages)), [
    { speaker: "Buyer", text: "Is this still available?" },
    { speaker: "Dealer", text: "Yes, it is available." },
  ]);
});

test("requires an active composer so an inbox list cannot become a conversation", () => {
  const { capture } = loadCaptureDom();
  const document = { querySelectorAll: () => [] };
  const result = capture.capture({ document, location: { pathname: "/marketplace/inbox" } });
  assert.equal(result.root, null);
  assert.equal(result.messages.length, 0);
  assert.equal(result.evidence.extractionMode, "none");
});

test("capture state is scoped to each thread root", () => {
  const { capture, root, otherRoot } = loadCaptureDom({ includeSecondThread: true });
  const first = capture.readVisualMessages(root, "Buyer A");
  const second = capture.readVisualMessages(otherRoot, "Buyer B");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), [
    { speaker: "Buyer A", text: "Is this still available?" },
    { speaker: "Dealer", text: "Yes, it is available." },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), [{ speaker: "Buyer B", text: "A different buyer" }]);
});
