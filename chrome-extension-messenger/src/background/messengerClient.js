(function () {
  const CONVERSATION_INTAKE_DEDUPE_MS = 120000;
  const DEFAULT_SETTINGS = Object.freeze({
    dryRun: true,
    autoReplyEnabled: false,
    backendUrl: "https://1987dealerpilot.com",
    dealerId: 1,
    sessionId: "",
    sellerProfileNames: ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
  });

  const conversationIntakeInFlight = new Set();
  const recentConversationIntakes = new Map();

  async function reportSessionStatus() {
    const settings = await getSettings();
    if (!settings.sessionId) return { skipped: true, reason: "session_id_missing" };
    const extensionId = await getExtensionId();
    const tabs = await chrome.tabs.query({
      url: [
        "https://www.facebook.com/*",
        "https://web.facebook.com/*",
        "https://facebook.com/*",
      ],
    });
    const facebookTabs = tabs.filter((tab) => typeof tab.url === "string");
    const marketplaceConnected = facebookTabs.some((tab) =>
      /facebook\.com\/(marketplace|messages)/i.test(tab.url || ""),
    );
    return DealerPilotMessengerApiClient.apiPost("/api/extension/heartbeat", {
      extensionId,
      dealerId: settings.dealerId,
      sessionId: settings.sessionId,
      status: "online",
      fbLoggedIn: facebookTabs.length > 0,
      marketplaceConnected,
    });
  }

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
      dealerId: Number.isInteger(Number(stored.dealerId)) && Number(stored.dealerId) > 0 ? Number(stored.dealerId) : 1,
      sessionId: typeof stored.sessionId === "string" ? stored.sessionId.trim() : "",
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

    async REPORT_SESSION_STATUS() {
      return reportSessionStatus();
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
        "lastMessengerFollowUp",
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
        lastMessengerFollowUp: stored.lastMessengerFollowUp || {
          followUpsSent: 0,
          maxFollowUps: 3,
          status: "idle",
          nextDueAt: null,
        },
        lastError: stored.lastError || null,
      };
    },

    async SAVE_SETTINGS(message) {
      const patch = {};
      if (typeof message.dryRun === "boolean") patch.dryRun = message.dryRun;
      if (typeof message.autoReplyEnabled === "boolean") patch.autoReplyEnabled = message.autoReplyEnabled;
      if (typeof message.backendUrl === "string") patch.backendUrl = message.backendUrl.trim().replace(/\/+$/, "");
      if (Number.isInteger(Number(message.dealerId)) && Number(message.dealerId) > 0) patch.dealerId = Number(message.dealerId);
      if (typeof message.sessionId === "string") patch.sessionId = message.sessionId.trim();
      if (Array.isArray(message.sellerProfileNames)) {
        patch.sellerProfileNames = message.sellerProfileNames.map((name) => String(name).trim()).filter(Boolean);
      }
      await chrome.storage.local.set(patch);
      reportSessionStatus().catch(() => {});
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
        lastConversationIntake = null,
      } = await chrome.storage.local.get([
        "lastMessengerCaptureDebugByTab",
        "messengerCaptureDebugHistory",
        "lastConversationIntake",
      ]);
      if (sourceTabId) lastMessengerCaptureDebugByTab[String(sourceTabId)] = debug;
      const history = [debug, ...messengerCaptureDebugHistory].slice(0, 20);
      const patch = {
        lastMessengerCaptureDebug: debug,
        lastMessengerCaptureDebugByTab,
        messengerCaptureDebugHistory: history,
      };
      if (debug.autoSent === true && lastConversationIntake) {
        patch.lastConversationIntake = {
          ...lastConversationIntake,
          suggestedReply: null,
          suggestedReplyPreview: "",
          suggestedReplyClearedAt: debug.at,
          suggestedReplyClearReason: "auto_sent",
        };
      }
      await chrome.storage.local.set(patch);
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
        const settings = await getSettings();
        const response = await DealerPilotMessengerApiClient.apiPost("/api/conversations/intake", {
          extensionId,
          externalThreadRef: message.externalThreadRef,
          sourceUrl: message.sourceUrl,
          buyerName: message.buyerName,
          visibleMessages: message.visibleMessages || [],
          currentMessage: message.currentMessage,
          visibleImages: message.visibleImages || [],
          detectedMarketplaceListingUrl: message.detectedMarketplaceListingUrl,
          detectedVehicleTitle: message.detectedVehicleTitle,
          marketplaceDownPayment: message.marketplaceDownPayment,
          marketplaceAskingPrice: message.marketplaceAskingPrice,
          vehicleType: message.vehicleType,
          dealerId: settings.dealerId,
          sessionId: settings.sessionId,
          messageDetectedAt: message.messageDetectedAt,
          messageHash: message.messageHash,
          idempotencyKey: message.idempotencyKey,
          routeAllowed: message.routeAllowed,
          conversationThreadDetected: message.conversationThreadDetected,
          buyerMessageDetected: message.buyerMessageDetected,
          buyerNameDetected: message.buyerNameDetected,
          sellerIsCurrentUser: message.sellerIsCurrentUser,
          marketplaceContextDetected: message.marketplaceContextDetected,
          followUpEligible: message.followUpEligible === true,
          availabilityQuickReplyAccepted: false,
          timestamp: new Date().toISOString(),
        });
        const suggestedReply =
          response?.suggestedReply ||
          response?.data?.suggestedReply ||
          response?.data?.data?.suggestedReply ||
          "";
        await chrome.storage.local.set({
          lastConversationIntake: {
            at: new Date().toISOString(),
            externalThreadRef: message.externalThreadRef || null,
            buyerName: message.buyerName || null,
            currentMessage: message.currentMessage || null,
            suggestedReplyReceived: !!suggestedReply,
            suggestedReply: suggestedReply || null,
            suggestedReplyPreview: suggestedReply ? String(suggestedReply).slice(0, 240) : "",
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

    async CLAIM_DUE_MESSENGER_FOLLOW_UP(message) {
      const extensionId = await getExtensionId();
      const settings = await getSettings();
      const externalThreadRef = typeof message?.externalThreadRef === "string"
        ? message.externalThreadRef.trim()
        : "";
      const stored = await chrome.storage.local.get("lastMessengerFollowUp");
      const previous = stored.lastMessengerFollowUp || {};
      const response = await DealerPilotMessengerApiClient.apiPost("/api/conversations/follow-ups/claim", {
        extensionId,
        dealerId: settings.dealerId,
        externalThreadRef,
      });
      const data = response?.data || response || {};
      const nextState = data.followUp || {};
      const previousIsActive =
        previous.externalThreadRef === externalThreadRef &&
        previous.nextDueAt &&
        new Date(previous.nextDueAt).getTime() > Date.now() &&
        !["idle", "canceled", "buyer_message_missing", "closed"].includes(String(previous.status || "").toLowerCase());
      const shouldKeepActiveState = !data.job &&
        String(nextState.status || "idle").toLowerCase() === "idle" &&
        previousIsActive;
      await chrome.storage.local.set({
        lastMessengerFollowUp: {
          ...(shouldKeepActiveState ? previous : nextState),
          jobId: data.job?.id || null,
          status: data.job ? "claimed" : shouldKeepActiveState ? previous.status : nextState.status || "idle",
          externalThreadRef: externalThreadRef || previous.externalThreadRef || null,
          updatedAt: new Date().toISOString(),
        },
        lastError: null,
      });
      return data;
    },

    async CONFIRM_MESSENGER_OUTBOUND_DELIVERY(message) {
      const extensionId = await getExtensionId();
      const settings = await getSettings();
      const response = await DealerPilotMessengerApiClient.apiPost(
        `/api/conversations/outbound/${encodeURIComponent(message.jobId)}/delivered`,
        {
          extensionId,
          dealerId: settings.dealerId,
          externalThreadRef: message.externalThreadRef,
        },
      );
      const data = response?.data || response || {};
      await chrome.storage.local.set({
        lastMessengerFollowUp: {
          ...(data.followUp || {}),
          jobId: data.job?.id || message.jobId || null,
          externalThreadRef: message.externalThreadRef || null,
          updatedAt: new Date().toISOString(),
        },
        lastError: null,
      });
      return data;
    },

    async CANCEL_MESSENGER_FOLLOW_UP(message) {
      const settings = await getSettings();
      const response = await DealerPilotMessengerApiClient.apiPost(
        `/api/conversations/follow-ups/${encodeURIComponent(message.jobId)}/cancel`,
        {
          dealerId: settings.dealerId,
          externalThreadRef: message.externalThreadRef,
          reason: message.reason,
        },
      );
      const data = response?.data || response || {};
      await chrome.storage.local.set({
        lastMessengerFollowUp: {
          ...(data.followUp || {}),
          jobId: message.jobId || null,
          updatedAt: new Date().toISOString(),
        },
      });
      return data;
    },

    async CANCEL_MESSENGER_FOLLOW_UPS_FOR_BUYER(message) {
      const settings = await getSettings();
      const response = await DealerPilotMessengerApiClient.apiPost(
        "/api/conversations/follow-ups/cancel-by-thread",
        {
          dealerId: settings.dealerId,
          externalThreadRef: message.externalThreadRef,
          reason: message.reason,
        },
      );
      const data = response?.data || response || {};
      await chrome.storage.local.set({
        lastMessengerFollowUp: {
          ...(data.followUp || {}),
          status: "canceled",
          updatedAt: new Date().toISOString(),
        },
      });
      return data;
    },
  };

  chrome.runtime.onInstalled?.addListener(() => {
    chrome.storage.local.set({
      dryRun: true,
      autoReplyEnabled: false,
      backendUrl: DEFAULT_SETTINGS.backendUrl,
      sellerProfileNames: DEFAULT_SETTINGS.sellerProfileNames,
    }).catch(() => {});
    chrome.alarms?.create?.("dealerpilot-messenger-heartbeat", { periodInMinutes: 1 });
  });

  chrome.runtime.onStartup?.addListener(() => {
    chrome.alarms?.create?.("dealerpilot-messenger-heartbeat", { periodInMinutes: 1 });
    reportSessionStatus().catch(() => {});
  });
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm?.name === "dealerpilot-messenger-heartbeat") reportSessionStatus().catch(() => {});
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
