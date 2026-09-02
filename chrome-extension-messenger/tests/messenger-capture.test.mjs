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
    this.naturalWidth = rect?.width ?? null;
    this.naturalHeight = rect?.height ?? null;
    this.currentSrc = attributes.src ?? null;
    this.outerHTML = this.tagName === "IMG" ? `<img src="${attributes.src || ""}" alt="${attributes.alt || ""}">` : `<${this.tagName}>`;
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
    if (selector.includes('[aria-label*="message"')) {
      return /message/i.test(this.attributes["aria-label"] || "");
    }
    if (selector.includes('[aria-label*="mensaje"')) {
      return /mensaje/i.test(this.attributes["aria-label"] || "");
    }
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
    if (selector === 'a[href]') return this.tagName === "A" && !!this.attributes.href;
    if (selector.includes('[role="link"]')) return this.attributes.role === "link";
    if (selector === "img[src]" || selector === "img[data-src]" || selector === "img[src], img[data-src]") {
      return this.tagName === "IMG";
    }
    if (selector.includes("audio") || selector.includes("voice")) {
      return this.tagName === "AUDIO";
    }
    return false;
  }
}

function runCapture(root, extraElements = [], pathname = "/marketplace/inbox") {
  const matchesQuery = (element, selector) =>
    selector.split(",").some((part) => element.matches(part.trim()));
  const document = {
    documentElement: new FakeElement(),
    querySelectorAll(selector) {
      const rootMatches = matchesQuery(root, selector) ? [root, ...root.querySelectorAll(selector)] : root.querySelectorAll(selector);
      const extraMatches = extraElements.flatMap((element) =>
        matchesQuery(element, selector) ? [element, ...element.querySelectorAll(selector)] : element.querySelectorAll(selector),
      );
      return [...rootMatches, ...extraMatches];
    },
  };
  const context = vm.createContext({
    document,
    location: {
      pathname,
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
    location: { pathname },
    sellerNameCandidates: ["Alpha Motorsport"],
  });
}

test("messages route keeps capturing when Facebook separates the header from the composer tree", () => {
  const buyerMessage = new FakeElement({
    attributes: { dir: "auto" },
    text: "Is the title clean?",
    rect: { left: 40, right: 260, top: 520, width: 220, height: 54 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [buyerMessage],
  });
  const composerRoot = new FakeElement({
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });
  const header = new FakeElement({
    tagName: "h2",
    text: "Danielle · 2016 Lexus NX",
    rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
  });

  const capture = runCapture(composerRoot, [header], "/messages/t/1695707675271107");

  assert.equal(capture.evidence.threadRootDetected, true);
  assert.equal(capture.buyerName, "Danielle");
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [
    { speaker: "Danielle", text: "Is the title clean?" },
  ]);
});

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

test("right-aligned Dealer bubble corrects an ambiguous semantic sender", () => {
  const dealerReply = "We will be happy to confirm that detail. Are you still interested?";
  const ambiguousOutgoingBubble = new FakeElement({
    attributes: {
      dir: "auto",
      "aria-label": `Message sent at 10:30 AM by John: ${dealerReply}`,
    },
    text: dealerReply,
    rect: { left: 250, right: 410, top: 520, width: 160, height: 60 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [ambiguousOutgoingBubble],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "John · 2021 Toyota Tacoma",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $25,000 - 2021 Toyota Tacoma" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);

  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.messages)),
    [{ speaker: "Dealer", text: dealerReply }],
  );
});

test("known Alpha prompts never re-enter history as buyer messages", () => {
  const dealerPrompt = "We will be happy to confirm that detail for the Tacoma. Are you still interested?";
  const ambiguousDescriptor = new FakeElement({
    attributes: { "aria-label": `Message sent at 10:30 AM by John: ${dealerPrompt}` },
    text: dealerPrompt,
    rect: { left: 30, right: 260, top: 520, width: 230, height: 60 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [ambiguousDescriptor],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({ tagName: "h2", text: "John · 2021 Toyota Tacoma" }),
      new FakeElement({ text: "Marketplace $25,000 - 2021 Toyota Tacoma" }),
      scope,
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" } }),
    ],
  });

  const capture = runCapture(root);

  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.messages)),
    [{ speaker: "Dealer", text: dealerPrompt }],
  );
});

test("floating Marketplace chat ignores Facebook rating cards and keeps requirements question latest", () => {
  const ratingCard = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 10:26 AM by Erika: You can now rate each other People may rate one another based on their interactions or transactions. Rate Erika",
    },
    text: "You can now rate each other People may rate one another based on their interactions or transactions. Rate Erika",
    rect: { left: 40, right: 400, top: 500, width: 360, height: 80 },
  });
  const requirementsBubble = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 10:27 AM by Erika: Q se necesita para aplicar?",
    },
    text: "Q se necesita para aplicar?",
    rect: { left: 40, right: 250, top: 600, width: 210, height: 44 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [ratingCard, requirementsBubble],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Erika Â· 2021 Toyota RAV4",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $2,500 - 2021 Toyota RAV4" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.deepEqual(messages.map((message) => message.text), ["Q se necesita para aplicar?"]);
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
});

test("floating Marketplace chat drops group system events and keeps the real buyer message", () => {
  const groupEvent = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 10:26 AM by Gerardo: Gerardo Claure added Norma Guzman to the group.",
    },
    text: "Gerardo Claure added Norma Guzman to the group.",
    rect: { left: 40, right: 400, top: 500, width: 360, height: 40 },
  });
  const buyerBubble = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 10:27 AM by Gerardo: Hola. ¿Sigue estando disponible?",
    },
    text: "Hola. ¿Sigue estando disponible?",
    rect: { left: 40, right: 250, top: 560, width: 210, height: 44 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [groupEvent, buyerBubble],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Gerardo Â· 2021 Toyota RAV4",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $2,500 - 2021 Toyota RAV4" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.deepEqual(messages.map((message) => message.text), ["Hola. ¿Sigue estando disponible?"]);
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
});

test("floating Marketplace chat keeps long buyer warranty question as latest message", () => {
  const previousBuyer = new FakeElement({
    attributes: { dir: "auto" },
    text: "Hello, is this still available?",
    rect: { left: 40, right: 250, top: 420, width: 210, height: 44 },
  });
  const dealerReply = new FakeElement({
    attributes: { dir: "auto" },
    text: "Yes, it is still available. Are you interested in financing the 2015 ACURA TLX?",
    rect: { left: 230, right: 410, top: 500, width: 180, height: 70 },
  });
  const longQuestion = new FakeElement({
    attributes: { dir: "auto" },
    text: "Yes, Is there a dealer warranty included? * How many days/miles? * Does it cover engine and transmission? * What's the deductible? * Can you take it to a mechanic in Richmond for warranty repairs? * Is it a third-party extended warranty or the dealership's own warranty?",
    rect: { left: 40, right: 380, top: 600, width: 340, height: 150 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 620 },
    children: [previousBuyer, dealerReply, longQuestion],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 850 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Bang · 2015 Acura TLX",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $11,000 - 2015 Acura TLX" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        text: "An advisor can confirm the exact warranty and coverage details for the 2015 Acura TLX -- what's the best phone number to reach you?",
        rect: { left: 940, right: 1260, top: 820, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.buyerName, "Bang");
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
  assert.equal(messages.at(-1).speaker, "Bang");
  assert.match(messages.at(-1).text, /dealer warranty included/);
  assert.match(messages.at(-1).text, /third-party extended warranty/);
  assert.equal(messages.some((message) => /advisor can confirm/i.test(message.text)), false);
});

test("floating Marketplace chat keeps outgoing advisor reply as latest after buyer question", () => {
  const longQuestion = new FakeElement({
    attributes: { dir: "auto" },
    text: "Yes, Is there a dealer warranty included? * How many days/miles? * Does it cover engine and transmission?",
    rect: { left: 40, right: 380, top: 420, width: 340, height: 110 },
  });
  const dealerReply = new FakeElement({
    attributes: { dir: "auto" },
    text: "An advisor can confirm warranty and coverage details for the 2015 Acura TLX -- what's the best phone number to reach you?",
    rect: { left: 230, right: 410, top: 620, width: 180, height: 90 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 620 },
    children: [longQuestion, dealerReply],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 850 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Bang · 2015 Acura TLX",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $11,000 - 2015 Acura TLX" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        text: "Our advisor can confirm warranty and coverage for the 2015 Acura TLX; may I have the best phone number?",
        rect: { left: 940, right: 1260, top: 820, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.evidence.latestMessageDirection, "dealer");
  assert.equal(messages.at(-1).speaker, "Dealer");
  assert.match(messages.at(-1).text, /advisor can confirm warranty/);
  assert.equal(messages.some((message) => /^Our advisor can confirm/.test(message.text)), false);
});

test("floating Marketplace chat treats semantic DealerPilot financing reply as outgoing", () => {
  const buyerMessage = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 1:45 PM by Bang: I was up there earlier and they said it wasn't ready",
    },
    text: "I was up there earlier and they said it wasn't ready",
    rect: { left: 40, right: 380, top: 420, width: 340, height: 70 },
  });
  const dealerReply = new FakeElement({
    attributes: {
      "aria-label": "Message sent: I'd be happy to help with the 2015 ACURA TLX. Are you interested in financing it?",
    },
    text: "I'd be happy to help with the 2015 ACURA TLX. Are you interested in financing it?",
    rect: { left: 230, right: 410, top: 560, width: 180, height: 70 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 620 },
    children: [buyerMessage, dealerReply],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 850 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Bang · 2015 Acura TLX",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $11,000 - 2015 Acura TLX" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 820, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.evidence.latestMessageDirection, "dealer");
  assert.equal(messages.at(-1).speaker, "Dealer");
  assert.match(messages.at(-1).text, /I'd be happy to help/);
});

test("floating Marketplace chat treats generic message-sent descriptors as outgoing", () => {
  const buyerMessage = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 10:26 AM by Erika: Q se necesita para aplicar",
    },
    text: "Q se necesita para aplicar",
    rect: { left: 40, right: 300, top: 420, width: 260, height: 50 },
  });
  const manualDealerReply = new FakeElement({
    attributes: {
      "aria-label": "Message sent: cuales tienes?",
    },
    text: "cuales tienes?",
    rect: { left: 300, right: 410, top: 700, width: 110, height: 42 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 620 },
    children: [buyerMessage, manualDealerReply],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 850 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Erika · 2021 Toyota RAV4",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $2,500 - 2021 Toyota RAV4" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 820, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.evidence.latestMessageDirection, "dealer");
  assert.equal(messages.at(-1).speaker, "Dealer");
  assert.equal(messages.at(-1).text, "cuales tienes?");
});

test("floating Marketplace chat merges visual outgoing replies when semantic messages omit them", () => {
  const semanticBuyerMessage = new FakeElement({
    attributes: {
      "aria-label": "Message sent at 10:26 AM by Erika: Q se necesita para aplicar",
    },
    text: "Q se necesita para aplicar",
    rect: { left: 40, right: 300, top: 420, width: 260, height: 50 },
  });
  const manualDealerReply = new FakeElement({
    attributes: { dir: "auto" },
    text: "cuales tienes?",
    rect: { left: 300, right: 410, top: 700, width: 110, height: 42 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 620 },
    children: [semanticBuyerMessage, manualDealerReply],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 850 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Erika · 2021 Toyota RAV4",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $2,500 - 2021 Toyota RAV4" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 820, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.evidence.latestMessageDirection, "dealer");
  assert.equal(messages.at(-1).speaker, "Dealer");
  assert.equal(messages.at(-1).text, "cuales tienes?");
  assert.deepEqual(messages.map((message) => message.text), [
    "Q se necesita para aplicar",
    "cuales tienes?",
  ]);
});

test("outgoing human link remains Dealer and prevents an old buyer message from becoming latest", () => {
  const oldBuyerMessage = new FakeElement({
    attributes: { dir: "auto" },
    text: "I am interested in this truck and would want to buy under my business.",
    rect: { left: 40, right: 300, top: 420, width: 260, height: 54 },
  });
  const humanLink = new FakeElement({
    tagName: "a",
    attributes: { href: "https://extranet.dealercentric.com/CreditPlus" },
    text: "Get your pre approval today",
    rect: { left: 220, right: 410, top: 600, width: 190, height: 44 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 620 },
    children: [oldBuyerMessage, humanLink],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 850 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Nabeel · 2022 Ford F150 Lightning",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      new FakeElement({ text: "Marketplace $2,500 - 2022 Ford F150 Lightning" }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.evidence.latestMessageDirection, "dealer");
  assert.equal(messages.at(-1).speaker, "Dealer");
  assert.equal(messages.at(-1).text, "Get your pre approval today");
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

test("floating Marketplace chat keeps multiple buyer messages and uses the latest last", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Hola. Â¿Sigue disponible?",
        rect: { left: 260, right: 410, top: 480, width: 150, height: 44 },
      }),
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Me interesa, Â¿cuÃ¡l es el mejor nÃºmero?",
        rect: { left: 250, right: 410, top: 540, width: 160, height: 58 },
      }),
      new FakeElement({
        attributes: { dir: "auto" },
        text: "Â¿TodavÃ­a estÃ¡ disponible para verlo hoy?",
        rect: { left: 240, right: 410, top: 610, width: 170, height: 58 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Peter Â· 2021 Toyota RAV4",
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

  assert.equal(messages.at(-1).text, "Â¿TodavÃ­a estÃ¡ disponible para verlo hoy?");
  assert.deepEqual(messages.map((message) => message.text), [
    "Hola. Â¿Sigue disponible?",
    "Me interesa, Â¿cuÃ¡l es el mejor nÃºmero?",
    "Â¿TodavÃ­a estÃ¡ disponible para verlo hoy?",
  ]);
});

test("message rows that are only the buyer name label are dropped from history", () => {
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [
      new FakeElement({
        attributes: { "aria-label": "Message by Hector: Hector" },
        text: "Hector",
        rect: { left: 40, right: 250, top: 500, width: 210, height: 30 },
      }),
      new FakeElement({
        attributes: { "aria-label": "Message by Hector: Cuál es el precio en cash?" },
        text: "Cuál es el precio en cash?",
        rect: { left: 40, right: 250, top: 600, width: 210, height: 44 },
      }),
    ],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Hector · 2022 Ford F150 Lightning",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.deepEqual(messages, [{ speaker: "Hector", text: "Cuál es el precio en cash?" }]);
  assert.equal(capture.evidence.latestMessageDirection, "buyer");
});

test("captureFromRoot records buyer image messages from visible <img> bubbles", () => {
  const imageBubble = new FakeElement({
    tagName: "img",
    attributes: {
      src: "https://scontent.fnqz1-1.fna.fbcdn.net/v/t1.6435-9/photo.jpg",
      alt: "Foto del VIN",
    },
    rect: { left: 60, right: 260, top: 560, width: 200, height: 150 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [imageBubble],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Hector · 2022 Ford F150 Lightning",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const messages = JSON.parse(JSON.stringify(capture.messages));

  assert.equal(capture.evidence.imageCandidateCount, 1);
  assert.equal(capture.evidence.imageMessageCount, 1);
  assert.equal(capture.evidence.latestIsImage, true);
  assert.deepEqual(messages, [{ speaker: "Hector", text: "[Imagen: Foto del VIN]" }]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.imageMessages.map((message) => message.image))),
    [{
      src: "https://scontent.fnqz1-1.fna.fbcdn.net/v/t1.6435-9/photo.jpg",
      dataSrc: "",
      alt: "Foto del VIN",
      width: 200,
      height: 150,
    }],
  );
});

test("collectImageCandidates flags emoji and profile images so they are excluded", () => {
  const emoji = new FakeElement({
    tagName: "img",
    attributes: { src: "emoji.png", alt: "👍", role: "img" },
    rect: { left: 70, right: 90, top: 400, width: 20, height: 20 },
  });
  const profile = new FakeElement({
    tagName: "img",
    attributes: { src: "profile.jpg", alt: "Hector" },
    rect: { left: 10, right: 50, top: 200, width: 40, height: 40 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [emoji, profile],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({
        tagName: "h2",
        text: "Hector · 2022 Ford F150 Lightning",
        rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 },
      }),
      scope,
      new FakeElement({
        attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" },
        rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 },
      }),
    ],
  });

  const capture = runCapture(root);
  const candidates = JSON.parse(JSON.stringify(capture.evidence.imageCandidates));

  assert.equal(capture.evidence.imageMessageCount, 0);
  assert.equal(candidates[0].emojiLike, true);
  assert.equal(candidates[1].profileLike, true);
});

test("captureFromRoot records buyer voice messages and preserves the media source", () => {
  const audioBubble = new FakeElement({
    tagName: "audio",
    attributes: { src: "blob:https://www.facebook.com/voice-note-1" },
    rect: { left: 70, right: 280, top: 560, width: 210, height: 42 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [audioBubble],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({ tagName: "h2", text: "Hector · 2022 Ford F150 Lightning", rect: { left: 900, right: 1320, top: 130, width: 420, height: 30 } }),
      scope,
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" }, rect: { left: 940, right: 1260, top: 850, width: 320, height: 44 } }),
    ],
  });

  const capture = runCapture(root);

  assert.equal(capture.evidence.audioCandidateCount, 1);
  assert.equal(capture.evidence.audioMessageCount, 1);
  assert.equal(capture.evidence.latestIsAudio, true);
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [{ speaker: "Hector", text: "[Audio]" }]);
  assert.equal(capture.audioMessages[0].audio.src, "blob:https://www.facebook.com/voice-note-1");
});

test("standalone Message sent timestamps never become the final message", () => {
  const timestamp = new FakeElement({
    attributes: { "aria-label": "Message sent Fri 5:40 PM" },
    text: "Message sent Fri 5:40 PM",
    rect: { left: 400, right: 520, top: 500, width: 120, height: 24 },
  });
  const timestampOnly = new FakeElement({
    text: "Thu 8:54 AM",
    rect: { left: 400, right: 500, top: 530, width: 100, height: 24 },
  });
  const buyerBubble = new FakeElement({
    attributes: { dir: "auto" },
    text: "Hola. Â¿Sigue estando disponible?",
    rect: { left: 40, right: 260, top: 560, width: 220, height: 44 },
  });
  const scope = new FakeElement({
    attributes: { role: "log" },
    rect: { left: 0, right: 420, top: 180, width: 420, height: 520 },
    children: [timestamp, timestampOnly, buyerBubble],
  });
  const root = new FakeElement({
    attributes: { role: "dialog", "aria-label": "Marketplace conversation" },
    rect: { left: 900, right: 1320, top: 120, width: 420, height: 780 },
    children: [
      new FakeElement({ tagName: "h2", text: "Franklin Â· 2009 Toyota RAV4" }),
      scope,
      new FakeElement({ attributes: { contenteditable: "true", role: "textbox", "aria-label": "Aa" } }),
    ],
  });

  const capture = runCapture(root);

  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [{ speaker: "Franklin", text: "Hola. Â¿Sigue estando disponible?" }]);
  assert.equal(capture.messages.at(-1).text, "Hola. Â¿Sigue estando disponible?");
});
