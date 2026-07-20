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
    location: { pathname: "/marketplace/inbox" },
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

test("open chat visible buyer messages win over stale inbox preview", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Hola. Sigue disponible?",
        rect: { left: 40, right: 220, top: 540, width: 180, height: 58 },
      }),
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Todavia esta disponible para verlo hoy?",
        rect: { left: 40, right: 250, top: 610, width: 210, height: 58 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Juan | 2021 Toyota RAV4",
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
  const stalePreview = new FakeElement({
    attributes: { dir: "auto" },
    text: "Juan | 2021 Toyota RAV4 are you still interested?",
    rect: { left: 320, right: 740, top: 420, width: 420, height: 64 },
  });

  const capture = runCapture(root, [stalePreview]);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.buyerName, "Juan");
  assert.equal(capture.evidence.inboxPreviewFallback, false);
  assert.equal(messages.at(-1).text, "Todavia esta disponible para verlo hoy?");
  assert.deepEqual(messages.map((message) => message.text), [
    "Hola. Sigue disponible?",
    "Todavia esta disponible para verlo hoy?",
  ]);
});

test("AI reply text is not accepted as buyer name or buyer message", () => {
  const aiReply = "Yes - the car is still available. Are you interested in our easy financing options?";
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [
      new FakeElement({
        attributes: { dir: "auto" },
        text: aiReply,
        rect: { left: 40, right: 330, top: 520, width: 290, height: 60 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: aiReply,
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

  assert.equal(capture.buyerName, "");
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), []);
});

test("capture prefers full floating chat panel over tiny composer ancestor", () => {
  const incomingText = new FakeElement({
    attributes: { dir: "auto" },
    text: "Todavia esta disponible para verlo hoy?",
    rect: { left: 980, right: 1210, top: 700, width: 230, height: 60 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 940, right: 1320, top: 520, width: 380, height: 290 },
    children: [incomingText],
  });
  const composer = new FakeElement({
    attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
    rect: { left: 980, right: 1260, top: 850, width: 280, height: 44 },
  });
  const tinyComposerAncestor = new FakeElement({
    text: "Marketplace",
    rect: { left: 960, right: 1280, top: 830, width: 320, height: 80 },
    children: [composer],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 920, right: 1340, top: 360, width: 420, height: 600 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Juan | 2021 Toyota RAV4",
        rect: { left: 930, right: 1320, top: 380, width: 390, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $23,999 - 2021 Toyota RAV4" }),
      scope,
      tinyComposerAncestor,
    ],
  });

  const capture = runCapture(root);

  assert.equal(capture.root, root);
  assert.equal(capture.buyerName, "Juan");
  assert.equal(capture.evidence.selectedHeaderText, "Juan | 2021 Toyota RAV4");
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.messages)),
    [{ speaker: "Juan", text: "Todavia esta disponible para verlo hoy?" }],
  );
});
