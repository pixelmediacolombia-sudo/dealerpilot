(function () {
  const CONVERSATION_INTAKE_DEDUPE_MS = 120000;
  const DEFAULT_SETTINGS = Object.freeze({
    dryRun: true,
    autoReplyEnabled: false,
    backendUrl: "https://1987dealerpilot.com",
    sellerProfileNames: ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
  });

  const conversationIntakeInFlight = new Set();
  const recentConversationIntakes = new Map();

  async function getExtensionId() {
    const { extensionId } = await chrome.storage.local.get("extensionId");
    if (extensionId) return extensionId;
    const generated =
      "msg-ext-" +
      (crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now()}`);
    await chrome.storage.local.set({ extensionId: generated });
    return generated;
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      dryRun: stored.dryRun !== false,
      autoReplyEnabled: stored.autoReplyEnabled === true,
      sellerProfileNames: Array.isArray(stored.sellerProfileNames)
        ? stored.sellerProfileNames.filter(Boolean)
        : DEFAULT_SETTINGS.sellerProfileNames,
    };
  }

  async function saveLastError(err) {
    const message = err?.message ? String(err.message) : String(err);
    await chrome.storage.local.set({
      lastError: {
        message,
        status: err?.status || null,
        data: err?.data || null,
        raw: {
          name: err?.name || null,
          message,
          stack: err?.stack || null,
          status: err?.status || null,
          data: err?.data || null,
        },
        at: new Date().toISOString(),
      },
    });
  }

  function pruneRecentConversationIntakes(now = Date.now()) {
    for (const [key, intake] of recentConversationIntakes.entries()) {
      if (now - intake.completedAt > CONVERSATION_INTAKE_DEDUPE_MS) {
        recentConversationIntakes.delete(key);
      }
    }
  }

  async function focusMessengerComposer(tabId, selectContents = false) {
    const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const editors = [...document.querySelectorAll(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]'
        )].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        const editor = editors.find((element) =>
          /write to|message|mensaje|escribe/i.test(element.getAttribute('aria-label') || '')
        ) || editors[0];
        if (!editor) return { ok: false, reason: 'composer_missing' };
        editor.scrollIntoView({ block: 'center' });
        editor.focus();
        if (${selectContents ? "true" : "false"}) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return {
          ok: true,
          aria: editor.getAttribute('aria-label') || '',
          text: editor.innerText || ''
        };
      })()`,
    });
    return response?.result?.value || { ok: false, reason: "composer_focus_failed" };
  }

  async function readMessengerComposer(tabId) {
    const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const editor = [...document.querySelectorAll(
          '[contenteditable="true"][role="textbox"][data-lexical-editor="true"]'
        )].find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return { found: Boolean(editor), text: editor?.innerText || '' };
      })()`,
    });
    return response?.result?.value || { found: false, text: "" };
  }

  async function loadAutoSendState() {
    const stored = await chrome.storage.local.get("messengerAutoSendState");
    return stored.messengerAutoSendState || { sendHashes: {}, replies: {} };
  }

  async function saveAutoSendState(state) {
    await chrome.storage.local.set({ messengerAutoSendState: state });
  }

  const handlers = {
    async GET_SETTINGS() {
      return getSettings();
    },

    async LOAD_AUTO_SEND_STATE() {
      return loadAutoSendState();
    },

    async SAVE_AUTO_SEND_STATE(message) {
      const existing = await loadAutoSendState();
      existing.sendHashes = { ...existing.sendHashes, ...(message.sendHashes || {}) };
      existing.replies = { ...existing.replies, ...(message.replies || {}) };
      await saveAutoSendState(existing);
      return { saved: true };
    },

    async GET_DEBUG_STATE() {
      const settings = await getSettings();
      const stored = await chrome.storage.local.get([
        "lastMessengerCaptureDebug",
        "lastMessengerCaptureDebugByTab",
        "messengerCaptureDebugHistory",
        "lastConversationIntake",
        "lastError",
        "extensionId",
      ]);
      return {
        version: chrome.runtime.getManifest?.().version || "0.1.6",
        extensionId: stored.extensionId || null,
        settings,
        lastMessengerCaptureDebug: stored.lastMessengerCaptureDebug || null,
        lastMessengerCaptureDebugByTab: stored.lastMessengerCaptureDebugByTab || {},
        messengerCaptureDebugHistory: stored.messengerCaptureDebugHistory || [],
        lastConversationIntake: stored.lastConversationIntake || null,
        lastError: stored.lastError || null,
      };
    },

    async SAVE_SETTINGS(message) {
      const patch = {};
      if (typeof message.dryRun === "boolean") patch.dryRun = message.dryRun;
      if (typeof message.autoReplyEnabled === "boolean") patch.autoReplyEnabled = message.autoReplyEnabled;
      if (typeof message.backendUrl === "string") patch.backendUrl = message.backendUrl.trim().replace(/\/+$/, "");
      if (Array.isArray(message.sellerProfileNames)) {
        patch.sellerProfileNames = message.sellerProfileNames.map((name) => String(name).trim()).filter(Boolean);
      }
      await chrome.storage.local.set(patch);
      return getSettings();
    },

    async MESSENGER_CAPTURE_DEBUG(message, sender) {
      const sourceTabId = sender?.tab?.id || message.sourceTabId || null;
      const debug = {
        ...(message.debug || {}),
        sourceTabId,
        at: message.debug?.at || new Date().toISOString(),
      };
      const {
        lastMessengerCaptureDebugByTab = {},
        messengerCaptureDebugHistory = [],
      } = await chrome.storage.local.get([
        "lastMessengerCaptureDebugByTab",
        "messengerCaptureDebugHistory",
      ]);
      if (sourceTabId) lastMessengerCaptureDebugByTab[String(sourceTabId)] = debug;
      const history = [debug, ...messengerCaptureDebugHistory].slice(0, 20);
      await chrome.storage.local.set({
        lastMessengerCaptureDebug: debug,
        lastMessengerCaptureDebugByTab,
        messengerCaptureDebugHistory: history,
      });
      return { saved: true };
    },

    async DEBUGGER_COMPOSER_WRITE(message, sender) {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: false, error: "no_tab_id" };
      const { x, y, text } = message;
      if (x == null || y == null) return { ok: false, error: "no_coordinates" };
      if (typeof text !== "string" || !text.trim()) return { ok: false, error: "no_reply_text" };
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch (err) {
        return { ok: false, error: "debugger_attach_failed", details: err.message };
      }
      try {
        const focused = await focusMessengerComposer(tabId, true);
        if (!focused.ok) return { ok: false, error: focused.reason || "composer_focus_failed" };
        await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const verified = await readMessengerComposer(tabId);
        return {
          ok: verified.found && verified.text.trim() === text.trim(),
          method: "debugger_main_world_write",
          error: verified.found ? "composer_write_unconfirmed" : "composer_missing_after_write",
          writtenText: verified.text,
          composerAria: focused.aria,
        };
      } catch (err) {
        return { ok: false, error: "debugger_dispatch_failed", details: err.message };
      } finally {
        try { await chrome.debugger.detach({ tabId }); } catch (e) {}
      }
    },

    async DEBUGGER_COMPOSER_SUBMIT(message, sender) {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: false, error: "no_tab_id" };
      const { x, y } = message;
      if (x == null || y == null) return { ok: false, error: "no_coordinates" };
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch (err) {
        return { ok: false, error: "debugger_attach_failed", details: err.message };
      }
      try {
        const focused = await focusMessengerComposer(tabId, false);
        if (!focused.ok) return { ok: false, error: focused.reason || "composer_focus_failed" };
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
        });
        return { ok: true, method: "debugger_main_world_submit", composerAria: focused.aria };
      } catch (err) {
        return { ok: false, error: "debugger_dispatch_failed", details: err.message };
      } finally {
        try { await chrome.debugger.detach({ tabId }); } catch (e) {}
      }
    },

    async CONVERSATION_INTAKE(message) {
      const dedupeKey = message.idempotencyKey || message.messageHash || "";
      pruneRecentConversationIntakes();
      if (dedupeKey && conversationIntakeInFlight.has(dedupeKey)) {
        return { skipped: true, reason: "duplicate_extension_intake" };
      }
      const recentIntake = dedupeKey ? recentConversationIntakes.get(dedupeKey) : null;
      if (recentIntake?.response) {
        return { ...recentIntake.response, duplicateExtensionIntake: true };
      }

      if (dedupeKey) conversationIntakeInFlight.add(dedupeKey);
      try {
        const extensionId = await getExtensionId();
        const response = await DealerPilotMessengerApiClient.apiPost("/api/conversations/intake", {
          extensionId,
          externalThreadRef: message.externalThreadRef,
          sourceUrl: message.sourceUrl,
          buyerName: message.buyerName,
          visibleMessages: message.visibleMessages || [],
          currentMessage: message.currentMessage,
          detectedMarketplaceListingUrl: message.detectedMarketplaceListingUrl,
          detectedVehicleTitle: message.detectedVehicleTitle,
          marketplaceDownPayment: message.marketplaceDownPayment,
          marketplaceAskingPrice: message.marketplaceAskingPrice,
          vehicleType: message.vehicleType,
          dealerId: message.dealerId || 1,
          messageDetectedAt: message.messageDetectedAt,
          messageHash: message.messageHash,
          idempotencyKey: message.idempotencyKey,
          routeAllowed: message.routeAllowed,
          conversationThreadDetected: message.conversationThreadDetected,
          buyerMessageDetected: message.buyerMessageDetected,
          buyerNameDetected: message.buyerNameDetected,
          sellerIsCurrentUser: message.sellerIsCurrentUser,
          marketplaceContextDetected: message.marketplaceContextDetected,
          availabilityQuickReplyAccepted: false,
          timestamp: new Date().toISOString(),
        });
        await chrome.storage.local.set({
          lastConversationIntake: {
            at: new Date().toISOString(),
            externalThreadRef: message.externalThreadRef || null,
            buyerName: message.buyerName || null,
            currentMessage: message.currentMessage || null,
            suggestedReplyReceived: !!(response?.suggestedReply || response?.data?.suggestedReply),
            skipped: false,
          },
        });
        if (dedupeKey) {
          recentConversationIntakes.set(dedupeKey, {
            completedAt: Date.now(),
            response,
          });
        }
        return response;
      } catch (err) {
        await chrome.storage.local.set({
          lastConversationIntake: {
            at: new Date().toISOString(),
            externalThreadRef: message.externalThreadRef || null,
            buyerName: message.buyerName || null,
            currentMessage: message.currentMessage || null,
            suggestedReplyReceived: false,
            skipped: false,
            error: {
              message: err?.message ? String(err.message) : String(err),
              status: err?.status || null,
              data: err?.data || null,
              raw: {
                name: err?.name || null,
                message: err?.message ? String(err.message) : String(err),
                stack: err?.stack || null,
                status: err?.status || null,
                data: err?.data || null,
              },
            },
          },
        });
        throw err;
      } finally {
        if (dedupeKey) conversationIntakeInFlight.delete(dedupeKey);
      }
    },
  };

  chrome.runtime.onInstalled?.addListener(() => {
    chrome.storage.local.set({
      dryRun: true,
      autoReplyEnabled: false,
      backendUrl: DEFAULT_SETTINGS.backendUrl,
      sellerProfileNames: DEFAULT_SETTINGS.sellerProfileNames,
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        const handler = handlers[message?.type];
        if (!handler) {
          sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
          return;
        }
        const data = await handler(message, sender);
        sendResponse({ ok: true, data });
      } catch (err) {
        await saveLastError(err).catch(() => {});
        sendResponse({
          ok: false,
          error: err?.message ? String(err.message) : String(err),
          status: err?.status,
          data: err?.data,
        });
      }
    })();
    return true;
  });

  globalThis.DealerPilotMessengerHandlers = handlers;
})();
