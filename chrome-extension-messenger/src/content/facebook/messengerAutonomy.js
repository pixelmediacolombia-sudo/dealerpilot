(function () {
  const THREAD_LINK_SELECTOR = 'a[href*="/messages/t/"]';
  const ACTIVE_MESSAGE_SELECTOR = [
    '[role="log"]',
    '[aria-live="polite"][aria-label*="message" i]',
    '[aria-live="polite"][aria-label*="mensaje" i]',
    '[data-pagelet*="conversation" i]',
    '[data-testid*="conversation" i]',
  ].join(", ");
  const PERSIST_KEY = "dealerpilotMessengerAutonomyQueueV1";
  const THREAD_SETTLE_MS = 900;
  const PROCESS_RETRY_MS = 1200;
  const PROCESS_MAX_ATTEMPTS = 9;

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractThreadId(value, origin = globalThis.location?.origin || "https://www.facebook.com") {
    try {
      const url = new URL(String(value || ""), origin);
      const match = url.pathname.match(/^\/messages\/t\/([^/?#]+)\/?$/i);
      return match?.[1] ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function isMessagesThreadRoute(pathname = globalThis.location?.pathname || "") {
    return /^\/messages\/t\/[^/?#]+\/?$/i.test(String(pathname || ""));
  }

  function normalizePreviewSignature(value) {
    return cleanText(value)
      .replace(/\s*[·•|]\s*(?:\d+\s*(?:s|m|h|d|w)|yesterday|ayer)$/i, "")
      .toLowerCase();
  }

  function descriptorText(element) {
    if (!element) return "";
    const own = [
      element.innerText,
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid"),
    ];
    const labelled = Array.from(element.querySelectorAll?.("[aria-label], [title], [data-testid]") || [])
      .flatMap((child) => [
        child.getAttribute?.("aria-label"),
        child.getAttribute?.("title"),
        child.getAttribute?.("data-testid"),
      ]);
    return cleanText([...own, ...labelled].filter(Boolean).join(" "));
  }

  function hasUnreadIndicator(anchor) {
    const descriptor = descriptorText(anchor);
    return /\b(?:unread(?: message)?|new message|mensaje sin leer|mensaje nuevo|no le[ií]do)\b/i.test(descriptor) ||
      !!anchor?.querySelector?.(
        '[aria-label*="unread" i], [aria-label*="sin leer" i], [data-testid*="unread" i], [title*="unread" i]',
      );
  }

  function isOutgoingPreview(text, sellerProfileNames = []) {
    const value = cleanText(text);
    if (/(?:^|\s)(?:you|t[uú]|usted)\s*:/i.test(value)) return true;
    return sellerProfileNames.some((name) => {
      const escaped = cleanText(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return escaped && new RegExp(`(?:^|\\s)${escaped}\\s*:`, "i").test(value);
    });
  }

  function describeThreadAnchor(anchor, options = {}) {
    const origin = options.origin || globalThis.location?.origin || "https://www.facebook.com";
    const rawHref = anchor?.href || anchor?.getAttribute?.("href") || "";
    const threadId = extractThreadId(rawHref, origin);
    if (!threadId) return null;
    const previewText = cleanText(
      anchor?.innerText || anchor?.textContent || anchor?.getAttribute?.("aria-label") || "",
    );
    return {
      threadId,
      url: new URL(rawHref, origin).href,
      previewText,
      signature: normalizePreviewSignature(previewText),
      explicitUnread: hasUnreadIndicator(anchor),
      incomingPreview: !isOutgoingPreview(previewText, options.sellerProfileNames || []),
    };
  }

  function collectThreadTargets(documentRef, options = {}) {
    const seen = new Set();
    const targets = [];
    for (const anchor of Array.from(documentRef?.querySelectorAll?.(THREAD_LINK_SELECTOR) || [])) {
      const target = describeThreadAnchor(anchor, options);
      if (!target || seen.has(target.threadId)) continue;
      seen.add(target.threadId);
      targets.push(target);
    }
    return targets;
  }

  function createFifoThreadQueue(onProcess, onStateChange = () => {}) {
    const items = [];
    const queuedIds = new Set();
    const rerunById = new Map();
    const idleResolvers = [];
    let active = null;
    let running = false;
    let sequence = 0;

    function snapshot() {
      return {
        activeThreadId: active?.threadId || null,
        pendingThreadIds: items.map((item) => item.threadId),
        rerunThreadIds: Array.from(rerunById.keys()),
        processing: running,
      };
    }

    function changed() {
      onStateChange(snapshot());
    }

    function resolveIdle() {
      if (running || active || items.length || rerunById.size) return;
      while (idleResolvers.length) idleResolvers.shift()?.();
    }

    async function drain() {
      if (running) return;
      running = true;
      changed();
      try {
        while (items.length) {
          const item = items.shift();
          queuedIds.delete(item.threadId);
          active = item;
          changed();
          try {
            await onProcess(item);
          } finally {
            active = null;
            const rerun = rerunById.get(item.threadId);
            rerunById.delete(item.threadId);
            if (rerun) {
              rerun.sequence = ++sequence;
              items.push(rerun);
              queuedIds.add(rerun.threadId);
            }
            changed();
          }
        }
      } finally {
        running = false;
        changed();
        resolveIdle();
      }
    }

    function enqueue(target) {
      if (!target?.threadId) return "invalid";
      const item = { ...target, sequence: target.sequence || ++sequence };
      if (active?.threadId === item.threadId) {
        rerunById.set(item.threadId, item);
        changed();
        return "rerun";
      }
      if (queuedIds.has(item.threadId)) {
        const queued = items.find((candidate) => candidate.threadId === item.threadId);
        if (queued) Object.assign(queued, item, { sequence: queued.sequence });
        changed();
        return "updated";
      }
      items.push(item);
      queuedIds.add(item.threadId);
      changed();
      void drain();
      return "queued";
    }

    return Object.freeze({
      enqueue,
      getState: snapshot,
      whenIdle() {
        if (!running && !active && !items.length && !rerunById.size) return Promise.resolve();
        return new Promise((resolve) => idleResolvers.push(resolve));
      },
    });
  }

  function anchorsFromMutationRecords(records = []) {
    const anchors = [];
    const seen = new Set();
    const add = (node) => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      if (!element) return;
      const candidates = [
        element.matches?.(THREAD_LINK_SELECTOR) ? element : null,
        element.closest?.(THREAD_LINK_SELECTOR),
        ...Array.from(element.querySelectorAll?.(THREAD_LINK_SELECTOR) || []),
      ].filter(Boolean);
      for (const anchor of candidates) {
        if (seen.has(anchor)) continue;
        seen.add(anchor);
        anchors.push(anchor);
      }
    };
    for (const record of records) {
      add(record.target);
      for (const node of Array.from(record.addedNodes || [])) add(node);
    }
    return anchors;
  }

  function start(options = {}) {
    if (globalThis.__dealerPilotMessengerAutonomyController) {
      return globalThis.__dealerPilotMessengerAutonomyController;
    }
    const documentRef = options.documentRef || document;
    const locationRef = options.locationRef || location;
    const session = options.sessionStorageRef || globalThis.sessionStorage;
    const processThread = options.processThread;
    const sleepFn = options.sleepFn || sleep;
    const MutationObserverCtor = options.MutationObserverCtor || globalThis.MutationObserver;
    const previewById = new Map();
    const handledSignatureById = new Map();
    let queueState = {};
    let lastDiscoveredThreadId = null;

    function persist(state = queueState) {
      queueState = state;
      try {
        session?.setItem?.(PERSIST_KEY, JSON.stringify(state));
      } catch {
        // Session persistence is best-effort; the live queue remains authoritative.
      }
    }

    async function waitForThread(threadId, timeoutMs = 6000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const current = extractThreadId(locationRef.href || locationRef.pathname, locationRef.origin);
        if (current === threadId) return true;
        await sleepFn(150);
      }
      return false;
    }

    async function switchToThread(target) {
      const currentId = extractThreadId(locationRef.href || locationRef.pathname, locationRef.origin);
      if (currentId === target.threadId) return true;
      if (typeof options.navigate === "function") {
        await options.navigate(target);
        return waitForThread(target.threadId);
      }
      const anchor = Array.from(documentRef.querySelectorAll?.(THREAD_LINK_SELECTOR) || [])
        .find((candidate) =>
          extractThreadId(
            candidate.href || candidate.getAttribute?.("href"),
            locationRef.origin,
          ) === target.threadId,
        );
      anchor?.click?.();
      if (await waitForThread(target.threadId)) return true;
      persist(queue.getState());
      locationRef.assign?.(target.url);
      return false;
    }

    async function processQueuedThread(target) {
      lastDiscoveredThreadId = target.threadId;
      if (!await switchToThread(target)) {
        return { skipped: true, reason: "thread_navigation_pending" };
      }
      await sleepFn(THREAD_SETTLE_MS);
      let result = null;
      for (let attempt = 0; attempt < PROCESS_MAX_ATTEMPTS; attempt += 1) {
        result = await processThread({ automatic: true, expectedThreadId: target.threadId });
        const retryable = [
          "waiting_quiet_window",
          "capture_in_flight",
          "conversation_snapshot_missing",
          "conversation_thread_missing",
          "buyer_message_missing",
          "buyer_name_missing",
          "active_thread_header_missing",
        ].includes(result?.reason);
        if (!retryable) break;
        await sleepFn(PROCESS_RETRY_MS);
      }
      handledSignatureById.set(target.threadId, target.signature || "");
      return result;
    }

    const queue = createFifoThreadQueue(processQueuedThread, persist);

    function observeTarget(target, reason) {
      if (!target) return;
      const previous = previewById.get(target.threadId);
      previewById.set(target.threadId, target.signature);
      const changed = previous !== undefined && previous !== target.signature;
      const alreadyHandled = handledSignatureById.get(target.threadId) === target.signature;
      if (!alreadyHandled && target.incomingPreview && (target.explicitUnread || changed)) {
        queue.enqueue({ ...target, reason, observedAt: Date.now() });
      }
    }

    function scan(reason = "scan") {
      const targets = collectThreadTargets(documentRef, {
        origin: locationRef.origin,
        sellerProfileNames: options.sellerProfileNames || [],
      });
      for (const target of targets) observeTarget(target, reason);
      return targets;
    }

    function queueCurrentThread(reason) {
      const threadId = extractThreadId(locationRef.href || locationRef.pathname, locationRef.origin);
      if (!threadId) return;
      queue.enqueue({
        threadId,
        url: new URL(`/messages/t/${encodeURIComponent(threadId)}`, locationRef.origin).href,
        signature: `active:${threadId}:${Date.now()}`,
        incomingPreview: true,
        explicitUnread: false,
        reason,
        observedAt: Date.now(),
      });
    }

    const initialTargets = scan("initial_unread");
    let restored = null;
    try {
      restored = JSON.parse(session?.getItem?.(PERSIST_KEY) || "null");
    } catch {
      restored = null;
    }
    const restoredThreadIds = [
      restored?.activeThreadId,
      ...(restored?.pendingThreadIds || []),
    ].filter((threadId, index, values) => threadId && values.indexOf(threadId) === index);
    for (const threadId of restoredThreadIds) {
      const target = initialTargets.find((candidate) => candidate.threadId === threadId) ||
        (extractThreadId(locationRef.href || locationRef.pathname, locationRef.origin) === threadId
          ? {
              threadId,
              url: new URL(`/messages/t/${encodeURIComponent(threadId)}`, locationRef.origin).href,
              signature: `restored:${threadId}`,
              incomingPreview: true,
              explicitUnread: false,
            }
          : null);
      if (target) queue.enqueue({ ...target, reason: "restored_queue" });
    }
    const initialQueueState = queue.getState();
    if (
      !initialQueueState.activeThreadId &&
      !initialQueueState.pendingThreadIds.length &&
      isMessagesThreadRoute(locationRef.pathname)
    ) {
      queueCurrentThread("active_thread_start");
    }

    const observer = MutationObserverCtor
      ? new MutationObserverCtor((records) => {
          for (const record of records) {
            const anchors = anchorsFromMutationRecords([record]);
            for (const anchor of anchors) {
              observeTarget(describeThreadAnchor(anchor, {
                origin: locationRef.origin,
                sellerProfileNames: options.sellerProfileNames || [],
              }), "sidebar_mutation");
            }
            const targetElement = record.target?.nodeType === 1
              ? record.target
              : record.target?.parentElement;
            const activeChanged =
              targetElement?.closest?.(ACTIVE_MESSAGE_SELECTOR) ||
              Array.from(record.addedNodes || []).some((node) => {
                const element = node?.nodeType === 1 ? node : node?.parentElement;
                return element &&
                  (element.matches?.(ACTIVE_MESSAGE_SELECTOR) || element.closest?.(ACTIVE_MESSAGE_SELECTOR));
              });
            if (activeChanged && isMessagesThreadRoute(locationRef.pathname)) {
              queueCurrentThread("active_thread_mutation");
            }
          }
        })
      : null;
    observer?.observe?.(documentRef.body || documentRef.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const intervalId = setInterval(() => scan("interval_scan"), 1500);

    const controller = Object.freeze({
      enqueue: queue.enqueue,
      getState() {
        return {
          ...queue.getState(),
          lastDiscoveredThreadId,
          currentThreadId: extractThreadId(
            locationRef.href || locationRef.pathname,
            locationRef.origin,
          ) || null,
        };
      },
      stop() {
        observer?.disconnect?.();
        clearInterval(intervalId);
      },
      whenIdle: queue.whenIdle,
    });
    globalThis.__dealerPilotMessengerAutonomyController = controller;
    return controller;
  }

  globalThis.DealerPilotMessengerAutonomy = Object.freeze({
    anchorsFromMutationRecords,
    collectThreadTargets,
    createFifoThreadQueue,
    describeThreadAnchor,
    extractThreadId,
    isMessagesThreadRoute,
    isOutgoingPreview,
    normalizePreviewSignature,
    start,
  });
})();
