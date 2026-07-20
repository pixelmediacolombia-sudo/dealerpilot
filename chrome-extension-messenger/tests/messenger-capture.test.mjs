import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/content/facebook/messengerCapture.js", import.meta.url),
  "utf8",
);

class FakeElement {
  constructor({ tagName = "div", attributes = {}, text = "", rect, children = [] } = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.innerText = text;
    this.textContent = text;
    this.children = children;
    this.parentElement = null;
    this.rect = rect || { left: 0, right: 100, top: 0, width: 100, height: 20 };
    for (const child of children) child.parentElement = this;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
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
    if (selector.includes('[role="dialog"]')) return this.attributes.role === "dialog";
    if (selector.includes('[role="main"]')) return this.attributes.role === "main";
    if (selector.includes('[role="log"]')) return this.attributes.role === "log";
    if (selector.includes('[role="heading"]')) return this.attributes.role === "heading";
    if (selector.includes("[aria-level]")) return this.attributes["aria-level"] !== undefined;
    if (selector === "h1" || selector === "h2" || selector === "h3") return this.tagName === selector.toUpperCase();
    if (selector.includes('[contenteditable="true"]')) return this.attributes.contenteditable === "true";
    if (selector.includes("textarea")) return this.tagName === "TEXTAREA";
    if (selector.includes('div[dir="auto"]')) return this.tagName === "DIV" && this.attributes.dir === "auto";
    if (selector.includes('span[dir="auto"]')) return this.tagName === "SPAN" && this.attributes.dir === "auto";
    if (selector.includes("[data-lexical-text]")) return this.attributes["data-lexical-text"] !== undefined;
    if (selector.includes('a[href*="/marketplace/item/"]')) {
      return this.tagName === "A" && /\/marketplace\/item\//.test(this.attributes.href || "");
    }
    return false;
  }
}

function runCapture(root, extraElements = []) {
  const document = {
    documentElement: new FakeElement(),
    querySelectorAll(selector) {
      const rootMatches = root.matches(selector) ? [root, ...root.querySelectorAll(selector)] : root.querySelectorAll(selector);
      const extraMatches = extraElements.flatMap((element) =>
        element.matches(selector) ? [element, ...element.querySelectorAll(selector)] : element.querySelectorAll(selector),
      );
      return [...rootMatches, ...extraMatches];
    },
  };
  const context = vm.createContext({
    document,
    location: {
      pathname: "/marketplace/inbox",
    },
    Element: FakeElement,
    window: {
      getComputedStyle() {
        return { overflowY: "auto" };
      },
    },
  });
  vm.runInContext(source, context, { filename: "messengerCapture.js" });
  return context.DealerPilotMessengerCapture.capture({
    document,
    location: { pathname: "/marketplace/inbox" },
    sellerNameCandidates: ["Alpha Motorsport"],
  });
}

test("floating Marketplace chat extracts buyer header and incoming visual bubble", () => {
  const incomingText = new FakeElement({
    attributes: { dir: "auto" },
    text: "Hola. ¿Sigue disponible?",
    rect: { left: 40, right: 230, top: 520, width: 190, height: 60 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [incomingText],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Peter · 2021 Toyota RAV4",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $23,999 - 2021 Toyota RAV4" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);

  assert.equal(capture.buyerName, "Peter");
  assert.equal(capture.evidence.threadRootDetected, true);
  assert.equal(capture.evidence.messageScopeDetected, true);
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.messages)),
    [{ speaker: "Peter", text: "Hola. ¿Sigue disponible?" }],
  );
});

test("floating Marketplace chat cleans Write to buyer header and falls back to inbox preview", () => {
  const quickReply = new FakeElement({
    attributes: { dir: "auto" },
    text: "Sorry, it's not available",
    rect: { left: 260, right: 410, top: 520, width: 150, height: 44 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [quickReply],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Write to Peter",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $23,999 - 2021 Toyota RAV4" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });
  const inboxPreview = new FakeElement({
    attributes: { dir: "auto" },
    text: "Peter · 2024 Chevrolet equinox ev are you still interested?",
    rect: { left: 320, right: 740, top: 420, width: 420, height: 64 },
  });

  const capture = runCapture(root, [inboxPreview]);

  assert.equal(capture.buyerName, "Peter");
  assert.equal(capture.evidence.inboxPreviewFallback, true);
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.messages)),
    [{ speaker: "Peter", text: "are you still interested?" }],
  );
});
