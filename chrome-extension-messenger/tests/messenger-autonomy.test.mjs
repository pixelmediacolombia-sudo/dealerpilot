import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/content/facebook/messengerAutonomy.js", import.meta.url),
  "utf8",
);

function loadApi() {
  const context = vm.createContext({
    URL,
    console: { warn() {}, log() {}, error() {} },
    location: {
      origin: "https://www.facebook.com",
      pathname: "/messages/t/100",
      href: "https://www.facebook.com/messages/t/100",
    },
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    },
    clearInterval() {},
  });
  vm.runInContext(source, context, { filename: "messengerAutonomy.js" });
  return context.DealerPilotMessengerAutonomy;
}

class FakeAnchor {
  constructor(href, text, attributes = {}) {
    this.nodeType = 1;
    this.href = href;
    this.innerText = text;
    this.textContent = text;
    this.attributes = { href, ...attributes };
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  matches(selector) {
    return selector === 'a[href*="/messages/t/"]';
  }

  closest(selector) {
    return this.matches(selector) ? this : null;
  }
}

test("extractThreadId accepts every dynamic Facebook messages thread id", () => {
  const api = loadApi();
  assert.equal(
    api.extractThreadId("https://www.facebook.com/messages/t/1060211123108393"),
    "1060211123108393",
  );
  assert.equal(api.extractThreadId("/messages/t/9988776655/"), "9988776655");
  assert.equal(api.extractThreadId("/marketplace/inbox"), "");
  assert.equal(api.isMessagesThreadRoute("/messages/t/123456"), true);
});

test("thread discovery keeps DOM order and distinguishes incoming from outgoing previews", () => {
  const api = loadApi();
  const first = new FakeAnchor(
    "/messages/t/101",
    "Erika · 2021 Toyota RAV4 Hola, sigue disponible? · 1m",
    { "aria-label": "Unread message from Erika" },
  );
  const second = new FakeAnchor(
    "/messages/t/202",
    "Jamal · 2017 Porsche Cayenne You: I will contact you · 1m",
  );
  const document = {
    querySelectorAll() {
      return [first, second, first];
    },
  };

  const targets = api.collectThreadTargets(document, {
    origin: "https://www.facebook.com",
    sellerProfileNames: ["Andres Ibanez"],
  });

  assert.deepEqual(Array.from(targets, (target) => target.threadId), ["101", "202"]);
  assert.equal(targets[0].explicitUnread, true);
  assert.equal(targets[0].incomingPreview, true);
  assert.equal(targets[1].incomingPreview, false);
});

test("mutation records preserve first-arrival order even when Facebook edits text nodes", () => {
  const api = loadApi();
  const first = new FakeAnchor("/messages/t/101", "First");
  const second = new FakeAnchor("/messages/t/202", "Second");
  const records = [
    { target: { nodeType: 3, parentElement: first }, addedNodes: [] },
    { target: { nodeType: 3, parentElement: second }, addedNodes: [] },
  ];

  const anchors = api.anchorsFromMutationRecords(records);

  assert.deepEqual(Array.from(anchors, (anchor) => anchor.href), [
    "/messages/t/101",
    "/messages/t/202",
  ]);
});

test("FIFO finishes the first thread before the second and reruns an active thread at the back", async () => {
  const api = loadApi();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const queue = api.createFifoThreadQueue(async (item) => {
    order.push(`start:${item.threadId}`);
    if (item.threadId === "101" && order.length === 1) await firstGate;
    order.push(`end:${item.threadId}`);
  });

  assert.equal(queue.enqueue({ threadId: "101", signature: "a" }), "queued");
  assert.equal(queue.enqueue({ threadId: "202", signature: "b" }), "queued");
  assert.equal(queue.enqueue({ threadId: "101", signature: "c" }), "rerun");
  await Promise.resolve();
  assert.deepEqual(order, ["start:101"]);

  releaseFirst();
  await queue.whenIdle();

  assert.deepEqual(order, [
    "start:101",
    "end:101",
    "start:202",
    "end:202",
    "start:101",
    "end:101",
  ]);
  assert.deepEqual(Array.from(queue.getState().pendingThreadIds), []);
  assert.equal(queue.getState().processing, false);
});

test("a persisted active thread stays ahead of later queued threads after navigation reload", async () => {
  const api = loadApi();
  const locationRef = {
    origin: "https://www.facebook.com",
    pathname: "/messages/t/101",
    href: "https://www.facebook.com/messages/t/101",
  };
  const anchors = [
    new FakeAnchor("/messages/t/101", "Erika · 2021 Toyota RAV4"),
    new FakeAnchor("/messages/t/202", "Jamal · 2017 Porsche Cayenne"),
  ];
  const documentRef = {
    body: {},
    querySelectorAll() {
      return anchors;
    },
  };
  const sessionStorageRef = {
    value: JSON.stringify({
      activeThreadId: "101",
      pendingThreadIds: ["202"],
    }),
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
  const order = [];
  const controller = api.start({
    documentRef,
    locationRef,
    sessionStorageRef,
    sleepFn: async () => {},
    async navigate(target) {
      locationRef.pathname = `/messages/t/${target.threadId}`;
      locationRef.href = `https://www.facebook.com${locationRef.pathname}`;
    },
    async processThread({ expectedThreadId }) {
      order.push(expectedThreadId);
      return { autoSent: true };
    },
  });

  await controller.whenIdle();

  assert.deepEqual(order, ["101", "202"]);
});

test("buyer_message_missing is terminal so an idle active thread does not retry forever", async () => {
  const api = loadApi();
  const locationRef = {
    origin: "https://www.facebook.com",
    pathname: "/messages/t/101",
    href: "https://www.facebook.com/messages/t/101",
  };
  const documentRef = {
    body: {},
    querySelectorAll() {
      return [];
    },
  };
  const sessionStorageRef = {
    getItem() {
      return null;
    },
    setItem() {},
  };
  let attempts = 0;
  const controller = api.start({
    documentRef,
    locationRef,
    sessionStorageRef,
    sleepFn: async () => {},
    async processThread() {
      attempts += 1;
      return { skipped: true, reason: "buyer_message_missing" };
    },
  });

  await controller.whenIdle();

  assert.equal(attempts, 1);
  assert.equal(controller.getState().processing, false);
  assert.deepEqual(Array.from(controller.getState().pendingThreadIds), []);
});

test("active conversation mutations do not requeue the current thread without a sidebar change", async () => {
  let observerCallback;
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}

    disconnect() {}
  }
  const api = loadApi();
  const locationRef = {
    origin: "https://www.facebook.com",
    pathname: "/messages/t/101",
    href: "https://www.facebook.com/messages/t/101",
  };
  const documentRef = {
    body: {},
    querySelectorAll() {
      return [];
    },
  };
  const sessionStorageRef = {
    getItem() {
      return null;
    },
    setItem() {},
  };
  let attempts = 0;
  const controller = api.start({
    documentRef,
    locationRef,
    sessionStorageRef,
    MutationObserverCtor: FakeMutationObserver,
    sleepFn: async () => {},
    async processThread() {
      attempts += 1;
      return { skipped: true, reason: "buyer_message_missing" };
    },
  });

  await controller.whenIdle();
  observerCallback?.([
    {
      target: { nodeType: 1, closest() { return null; } },
      addedNodes: [
        {
          nodeType: 1,
          matches() { return false; },
          closest() { return null; },
          querySelectorAll() { return []; },
        },
      ],
    },
  ]);
  await controller.whenIdle();

  assert.equal(attempts, 1);
  assert.equal(controller.getState().processing, false);
});

test("a new incoming message mutation reruns the active thread once", async () => {
  let observerCallback;
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}
    disconnect() {}
  }
  const api = loadApi();
  const locationRef = {
    origin: "https://www.facebook.com",
    pathname: "/messages/t/101",
    href: "https://www.facebook.com/messages/t/101",
  };
  const documentRef = {
    body: { querySelectorAll() { return []; } },
    querySelectorAll() { return []; },
  };
  let attempts = 0;
  const controller = api.start({
    documentRef,
    locationRef,
    sessionStorageRef: { getItem() { return null; }, setItem() {} },
    MutationObserverCtor: FakeMutationObserver,
    sellerProfileNames: ["Andres Ibanez"],
    sleepFn: async () => {},
    async processThread() {
      attempts += 1;
      return { autoSent: true };
    },
  });
  await controller.whenIdle();

  const incoming = {
    nodeType: 1,
    getAttribute(name) {
      return name === "aria-label"
        ? "Enter, Message sent 1:38 PM by Barış: Is the vehicle a hybrid"
        : null;
    },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest() { return null; },
  };
  observerCallback?.([{ target: incoming, addedNodes: [incoming] }]);
  await controller.whenIdle();
  observerCallback?.([{ target: incoming, addedNodes: [incoming] }]);
  await controller.whenIdle();

  assert.equal(attempts, 2);
  assert.equal(controller.getState().processing, false);
});
