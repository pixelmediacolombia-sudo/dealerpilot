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
    if (selector.includes('[aria-label*="message"')) return /message/i.test(this.attributes["aria-label"] || "");
    if (selector.includes('[aria-label*="mensaje"')) return /mensaje/i.test(this.attributes["aria-label"] || "");
    if (selector.includes('[data-testid*="message"')) return /message/i.test(this.attributes["data-testid"] || "");
    if (selector.includes('[data-testid*="messenger"')) return /messenger/i.test(this.attributes["data-testid"] || "");
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

function runCapture(root, extraElements = [], pathname = "/marketplace/inbox") {
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
    location: { pathname },
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
    location: { pathname },
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
        text: "Barış · Buyer",
        rect: { left: 400, right: 520, top: 450, width: 120, height: 24 },
      }),
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

test("messages route accepts Marketplace thread when buyer name contains digits", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 620, top: 260, width: 620, height: 560 },
    children: [
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Roberto Dj 503 \u00b7 Buyer",
        rect: { left: 40, right: 235, top: 500, width: 195, height: 24 },
      }),
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Buenos días. ¿Sigue disponible?",
        rect: { left: 40, right: 290, top: 520, width: 250, height: 48 },
      }),
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Sí, claro",
        rect: { left: 40, right: 145, top: 760, width: 105, height: 40 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 420, right: 1085, top: 180, width: 665, height: 800 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Roberto Dj 503 · 2020 Toyota SIENNA",
        rect: { left: 460, right: 980, top: 200, width: 520, height: 32 },
      }),
      new FakeElement({ text: "Marketplace $21,999 - 2020 Toyota SIENNA" }),
      new FakeElement({
        tagName: "a",
        attributes: { href: "/marketplace/item/1437407108214504/" },
        text: "View listing",
      }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 520, right: 1000, top: 910, width: 480, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root, [], "/messages/t/1526036699324530");

  assert.equal(capture.evidence.threadRootDetected, true);
  assert.equal(capture.buyerName, "Roberto Dj 503");
  assert.equal(capture.evidence.selectedHeaderText, "Roberto Dj 503 · 2020 Toyota SIENNA");
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [
    { speaker: "Roberto Dj 503", text: "Buenos días. ¿Sigue disponible?" },
    { speaker: "Roberto Dj 503", text: "Sí, claro" },
  ]);
  assert.equal(capture.messages.some((message) => message.text === "Roberto Dj 503 \u00b7 Buyer"), false);
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

test("outgoing AI reply stays in history so later buyer turns keep context", () => {
  const aiReply = "Yes - the 2017 Porsche Cayenne is still available. Are you interested in our easy financing options?";
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [
      new FakeElement({
        attributes: { "aria-label": `Message sent 5:20 AM by You: ${aiReply}` },
        text: "5:20 AM by You",
        rect: { left: 180, right: 410, top: 420, width: 230, height: 60 },
      }),
      new FakeElement({
        attributes: { "aria-label": "Message sent 5:24 AM by Jamal: yes" },
        text: "5:24 AM by Jamal",
        rect: { left: 30, right: 130, top: 500, width: 100, height: 36 },
      }),
      new FakeElement({
        attributes: { "aria-label": "Message sent 5:25 AM by Jamal: have a trade also" },
        text: "5:25 AM by Jamal",
        rect: { left: 30, right: 190, top: 545, width: 160, height: 36 },
      }),
      new FakeElement({
        attributes: { "aria-label": "Message sent 6:00 AM by Jamal: so how can we make this work" },
        text: "6:00 AM by Jamal",
        rect: { left: 30, right: 250, top: 610, width: 220, height: 36 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Jamal | 2017 Porsche Cayenne",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $15,000 - 2017 Porsche Cayenne" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);

  assert.equal(capture.buyerName, "Jamal");
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [
    { speaker: "Dealer", text: aiReply },
    { speaker: "Jamal", text: "yes" },
    { speaker: "Jamal", text: "have a trade also" },
    { speaker: "Jamal", text: "so how can we make this work" },
  ]);
});

test("semantic descriptors strip Facebook timestamp metadata from buyer message", () => {
  const message = new FakeElement({
    attributes: { "aria-label": "Message sent 12 PM by Juan: Hola. Sigue disponible?" },
    text: "12 PM by Juan",
    rect: { left: 40, right: 260, top: 520, width: 220, height: 60 },
  });
  const metadataOnly = new FakeElement({
    attributes: { "aria-label": "12 PM by Juan" },
    text: "12 PM by Juan",
    rect: { left: 40, right: 260, top: 590, width: 220, height: 40 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [message, metadataOnly],
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

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.buyerName, "Juan");
  assert.deepEqual(messages, [{ speaker: "Juan", text: "Hola. Sigue disponible?" }]);
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

test("messages thread selects buyer vehicle panel without a Marketplace link", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 376, right: 1505, top: 233, width: 1129, height: 420 },
    children: [
      new FakeElement({
        attributes: { "aria-label": "Message sent 2:20 PM by Barış: Hii" },
        text: "2:20 PM by Barış",
        rect: { left: 594, right: 650, top: 500, width: 56, height: 42 },
      }),
      new FakeElement({
        attributes: { "aria-label": "Message sent 2:21 PM by Barış: Is this vehicle a hybrid" },
        text: "2:21 PM by Barış",
        rect: { left: 594, right: 810, top: 610, width: 216, height: 42 },
      }),
    ],
  });
  const activePanel = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Conversation" },
    rect: { left: 376, right: 1505, top: 71, width: 1129, height: 642 },
    children: [
      new FakeElement({ tagName: "h2", text: "Barış · 2023 Kia SPORTAGE" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 740, right: 1420, top: 665, width: 680, height: 44 },
      }),
    ],
  });
  const globalRoot = new FakeElement({
    attributes: { role: "main", "aria-label": "Messenger" },
    text: "Marketplace",
    rect: { left: 0, right: 1521, top: 56, width: 1521, height: 674 },
    children: [
      new FakeElement({ tagName: "h2", text: "· 11m" }),
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 740, right: 1420, top: 665, width: 680, height: 44 },
      }),
    ],
  });

  const capture = runCapture(activePanel, [globalRoot], "/messages/t/1036903578892236");

  assert.equal(capture.root, activePanel);
  assert.equal(capture.buyerName, "Barış");
  assert.equal(capture.evidence.selectedHeaderText, "Barış · 2023 Kia SPORTAGE");
  assert.equal(capture.evidence.selectedRootRect.left, 376);
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [
    { speaker: "Barış", text: "Hii" },
    { speaker: "Barış", text: "Is this vehicle a hybrid" },
  ]);
});

test("messages thread keeps latest outgoing bubble when Facebook log scope is clipped", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 376, right: 1505, top: 233, width: 1129, height: 420, bottom: 653 },
    children: [
      new FakeElement({
        attributes: { "aria-label": "Message sent at 8:24 AM by Roberto Dj: Si, claro" },
        text: "Si, claro",
        rect: { left: 580, right: 690, top: 390, width: 110, height: 42 },
      }),
      new FakeElement({
        attributes: { "aria-label": "Message sent: hola roberto a que numero podemos contactarnos contigo" },
        text: "hola roberto a que numero podemos contactarnos contigo",
        rect: { left: 1190, right: 1490, top: 620, width: 300, height: 42 },
      }),
    ],
  });
  const latestOutgoingOutsideLog = new FakeElement({
    attributes: { dir: "auto" },
    text: "Buena pregunta. Con gusto podemos confirmar ese detalle del 2020 TOYOTA SIENNA. Te interesa financiarlo?",
    rect: { left: 1148, right: 1500, top: 728, width: 352, height: 70 },
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Conversation" },
    rect: { left: 376, right: 1505, top: 72, width: 1129, height: 760, bottom: 832 },
    children: [
      new FakeElement({ tagName: "h2", text: "Roberto Dj Â· 2020 Toyota SIENNA" }),
      new FakeElement({ text: "Marketplace $21,999 - 2020 Toyota SIENNA" }),
      scope,
      latestOutgoingOutsideLog,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 700, right: 1450, top: 840, width: 750, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root, [], "/messages/t/1526036699324530");

  assert.equal(capture.buyerName, "Roberto Dj");
  assert.equal(capture.evidence.latestMessageDirection, "dealer");
  assert.equal(capture.messages.at(-1).speaker, "Dealer");
  assert.match(capture.messages.at(-1).text, /Buena pregunta/);
});

test("visual buyer bubble survives incomplete semantic Message sent metadata", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 376, right: 1505, top: 233, width: 1129, height: 420 },
    children: [
      new FakeElement({
        attributes: { "aria-label": "Message sent 2:20 PM by You: Yes, are you interested?" },
        text: "Message sent",
        rect: { left: 1200, right: 1450, top: 500, width: 250, height: 44 },
      }),
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Is this vehicle a hybrid",
        rect: { left: 400, right: 616, top: 610, width: 216, height: 42 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Conversation" },
    rect: { left: 376, right: 1505, top: 71, width: 1129, height: 642 },
    children: [
      new FakeElement({ tagName: "h2", text: "Barış · 2023 Kia SPORTAGE" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 740, right: 1420, top: 665, width: 680, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root, [], "/messages/t/1036903578892236");

  assert.equal(capture.buyerName, "Barış");
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.equal(capture.messages.at(-1).speaker, "Barış");
  assert.equal(capture.messages.at(-1).text, "Is this vehicle a hybrid");
  assert.equal(capture.messages.some((message) => message.text === "Barış · Buyer"), false);
});
