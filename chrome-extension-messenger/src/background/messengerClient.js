(function () {
  const CONVERSATION_INTAKE_DEDUPE_MS = 120000;
  const DEFAULT_SETTINGS = Object.freeze({
    autoReplyEnabled: true,
    backendUrl: "https://app.1987dealerpilot.com",
    dealerId: 1,
    sessionId: "",
    sellerProfileNames: ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
  });
  const LEGACY_BACKEND_URL = "https://1987dealerpilot.com";
  const WINDOW_SETTINGS_PREFIX = "messengerSettingsWindow:";
  const conversationIntakeInFlight = new Set();
  const recentConversationIntakes = new Map();

  function validWindowId(value) {
    if (value === null || value === undefined || value === "") return null;
    const id = Number(value);
    return Number.isInteger(id) && id >= 0 ? id : null;
  }

  async function resolveWindowId(message = {}, sender = {}) {
    const explicit = validWindowId(message.windowId);
    if (explicit !== null) return explicit;
    const senderWindow = validWindowId(sender?.tab?.windowId);
    if (senderWindow !== null) return senderWindow;
    const current = await Promise.resolve(
      chrome.windows?.getCurrent ? chrome.windows.getCurrent() : null,
    ).catch(() => null);
    const currentId = validWindowId(current?.id);
    if (currentId !== null) return currentId;
    const tabs = await Promise.resolve(
      chrome.tabs?.query ? chrome.tabs.query({ active: true, lastFocusedWindow: true }) : [],
    ).catch(() => []);
    return validWindowId(tabs[0]?.windowId);
  }

  function windowSettingsKey(windowId) {
    const id = validWindowId(windowId);
    return id === null ? null : `${WINDOW_SETTINGS_PREFIX}${id}`;
  }

  function normalizeBackendUrl(value) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    return normalized === LEGACY_BACKEND_URL ? DEFAULT_SETTINGS.backendUrl : normalized;
  }

  async function reportSessionStatus(windowId = null) {
    const extensionId = await getExtensionId();
    const scopedWindowId = validWindowId(windowId);
    const targets = scopedWindowId === null
      ? await configuredWindowSettings()
      : [[scopedWindowId, await getSettings(scopedWindowId)]];
    const reports = await Promise.all(targets.map(async ([targetWindowId, settings]) => {
      if (!settings.sessionId) return { skipped: true, reason: "session_id_missing" };
      const query = {
        url: [
          "https://www.facebook.com/*",
          "https://web.facebook.com/*",
          "https://facebook.com/*",
        ],
      };
      if (validWindowId(targetWindowId) !== null) query.windowId = targetWindowId;
      const tabs = await chrome.tabs.query(query);
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
    }));
    return reports.length === 1 ? reports[0] : reports;
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

  async function getSettings(windowId = null) {
    const key = windowSettingsKey(windowId);
    const keys = [...Object.keys(DEFAULT_SETTINGS), ...(key ? [key] : [])];
    const stored = await chrome.storage.local.get(keys);
    const scoped = key && stored[key] && typeof stored[key] === "object" ? stored[key] : {};
    // A window with no scoped record starts from defaults; it must not inherit another dealer's mode.
    let values = key ? { ...DEFAULT_SETTINGS, ...scoped } : stored;
    if (key && !Object.keys(scoped).length) {
      // Pre-window-isolation installs stored the active dealer/session globally. Keep that
      // configuration usable once, until the first window saves its own scoped record.
      // Once any scoped record exists, a new window must start from its own defaults.
      const allStored = await chrome.storage.local.get(null);
      const hasScopedRecord = Object.keys(allStored).some((storageKey) =>
        storageKey.startsWith(WINDOW_SETTINGS_PREFIX) &&
        allStored[storageKey] &&
        typeof allStored[storageKey] === "object",
      );
      const legacySessionId = typeof allStored.sessionId === "string" && allStored.sessionId.trim();
      const legacySellerNames = Array.isArray(allStored.sellerProfileNames) && allStored.sellerProfileNames.length > 0;
      if (!hasScopedRecord && (legacySessionId || legacySellerNames)) {
        values = { ...DEFAULT_SETTINGS, ...allStored };
      }
    }
    const backendUrl = normalizeBackendUrl(values.backendUrl) || DEFAULT_SETTINGS.backendUrl;
    return {
      ...DEFAULT_SETTINGS,
      ...Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((setting) => [setting, values[setting]])),
      backendUrl,
      windowId: validWindowId(windowId),
      autoReplyEnabled: values.autoReplyEnabled !== false,
      dealerId: Number.isInteger(Number(values.dealerId)) && Number(values.dealerId) > 0 ? Number(values.dealerId) : 1,
      sessionId: typeof values.sessionId === "string" ? values.sessionId.trim() : "",
      sellerProfileNames: Array.isArray(values.sellerProfileNames)
        ? values.sellerProfileNames.filter(Boolean)
        : DEFAULT_SETTINGS.sellerProfileNames,
    };
  }

  async function configuredWindowSettings() {
    const windows = await Promise.resolve(
      chrome.windows?.getAll ? chrome.windows.getAll({ populate: false }) : [],
    ).catch(() => []);
    const targets = [];
    for (const browserWindow of windows) {
      const id = validWindowId(browserWindow?.id);
      const key = windowSettingsKey(id);
      if (key === null) continue;
      const stored = await chrome.storage.local.get(key);
      if (stored[key] && typeof stored[key] === "object") targets.push([id, await getSettings(id)]);
    }
    if (targets.length > 0) return targets;
    const legacy = await getSettings();
    return legacy.sessionId ? [[null, legacy]] : [];
  }

  async function saveSettings(windowId, patch) {
    const key = windowSettingsKey(windowId);
    if (key === null) {
      throw new Error("window_id_unavailable_settings_not_saved");
    }
    const current = await getSettings(windowId);
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [key]: next });
    return getSettings(windowId);
  }

  async function preserveMissingDefaultSettings() {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const missing = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS).filter(([key]) => stored[key] === undefined),
    );
    if (Object.keys(missing).length > 0) await chrome.storage.local.set(missing);
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
    async GET_SETTINGS(message, sender) {
      return getSettings(await resolveWindowId(message, sender));
    },

    async REPORT_SESSION_STATUS(message, sender) {
      return reportSessionStatus(await resolveWindowId(message, sender));
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

    async GET_DEBUG_STATE(message, sender) {
      const settings = await getSettings(await resolveWindowId(message, sender));
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

    async REFRESH_ACTIVE_MESSENGER_CONVERSATION() {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find((candidate) =>
        typeof candidate?.id === "number" &&
        /^https:\/\/(?:www\.|web\.)?facebook\.com\/(?:messages\/t\/|marketplace\/inbox)/i.test(String(candidate.url || "")),
      );
      if (!tab?.id) return { ok: false, error: "facebook_messenger_tab_not_active" };
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "REFRESH_ACTIVE_MESSENGER_CONVERSATION" });
        return response || { ok: false, error: "messenger_refresh_no_response" };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "messenger_refresh_failed" };
      }
    },

    async SAVE_SETTINGS(message, sender) {
      const patch = {};
      if (typeof message.autoReplyEnabled === "boolean") patch.autoReplyEnabled = message.autoReplyEnabled;
      if (typeof message.backendUrl === "string") {
        patch.backendUrl = normalizeBackendUrl(message.backendUrl) || DEFAULT_SETTINGS.backendUrl;
      }
      if (Number.isInteger(Number(message.dealerId)) && Number(message.dealerId) > 0) patch.dealerId = Number(message.dealerId);
      if (typeof message.sessionId === "string") patch.sessionId = message.sessionId.trim();
      if (Array.isArray(message.sellerProfileNames)) {
        patch.sellerProfileNames = message.sellerProfileNames.map((name) => String(name).trim()).filter(Boolean);
      }
      const windowId = await resolveWindowId(message, sender);
      const settings = await saveSettings(windowId, patch);
      reportSessionStatus(windowId).catch(() => {});
      return settings;
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

    async CONVERSATION_INTAKE(message, sender) {
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
        const settings = await getSettings(await resolveWindowId(message, sender));
        const response = await DealerPilotMessengerApiClient.apiPost("/api/conversations/intake", {
          extensionId,
          externalThreadRef: message.externalThreadRef,
          sourceUrl: message.sourceUrl,
          buyerName: message.buyerName,
          visibleMessages: message.visibleMessages || [],
          currentMessage: message.currentMessage,
          visibleImages: message.visibleImages || [],
          visibleAudios: message.visibleAudios || [],
          detectedMarketplaceListingUrl: message.detectedMarketplaceListingUrl,
          detectedVehicleTitle: message.detectedVehicleTitle,
          marketplaceDownPayment: message.marketplaceDownPayment,
          marketplaceAskingPrice: message.marketplaceAskingPrice,
          vehicleType: message.vehicleType,
          dealerId: settings.dealerId,
          sessionId: settings.sessionId,
          // The window-scoped background setting is authoritative. Do not trust a
          // stale content-script payload after the operator changes the popup.
          autoReplyEnabled: settings.autoReplyEnabled === true,
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

    async CONFIRM_MESSENGER_OUTBOUND_DELIVERY(message, sender) {
      const extensionId = await getExtensionId();
      const settings = await getSettings(await resolveWindowId(message, sender));
      const response = await DealerPilotMessengerApiClient.apiPost(
        `/api/conversations/outbound/${encodeURIComponent(message.jobId)}/delivered`,
        {
          extensionId,
          dealerId: settings.dealerId,
          externalThreadRef: message.externalThreadRef,
        },
      );
      const data = response?.data || response || {};
      await chrome.storage.local.set({ lastError: null });
      return data;
    },

    async CLOSE_MESSENGER_CONVERSATION(message, sender) {
      const conversationId = Number(message.conversationId);
      const externalThreadRef = typeof message.externalThreadRef === "string"
        ? message.externalThreadRef.trim()
        : "";
      if (!Number.isInteger(conversationId) || conversationId <= 0 || !externalThreadRef) {
        return { ok: false, error: "conversation_id_and_thread_required" };
      }
      const settings = await getSettings(await resolveWindowId(message, sender));
      const response = await DealerPilotMessengerApiClient.apiPost(
        `/api/conversations/${encodeURIComponent(conversationId)}/close-after-delivery`,
        {
          dealerId: settings.dealerId,
          externalThreadRef,
        },
      );
      const data = response?.data || response || {};
      return data;
    },
  };

  chrome.runtime.onInstalled?.addListener(async () => {
    await preserveMissingDefaultSettings().catch(() => {});
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
