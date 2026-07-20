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
    for (const [key, completedAt] of recentConversationIntakes.entries()) {
      if (now - completedAt > CONVERSATION_INTAKE_DEDUPE_MS) {
        recentConversationIntakes.delete(key);
      }
    }
  }

  const handlers = {
    async GET_SETTINGS() {
      return getSettings();
    },

    async GET_DEBUG_STATE() {
      const settings = await getSettings();
      const stored = await chrome.storage.local.get([
        "lastMessengerCaptureDebug",
        "lastMessengerCaptureDebugByTab",
        "lastConversationIntake",
        "lastError",
        "extensionId",
      ]);
      return {
        version: chrome.runtime.getManifest?.().version || "0.1.2",
        extensionId: stored.extensionId || null,
        settings,
        lastMessengerCaptureDebug: stored.lastMessengerCaptureDebug || null,
        lastMessengerCaptureDebugByTab: stored.lastMessengerCaptureDebugByTab || {},
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
      const { lastMessengerCaptureDebugByTab = {} } = await chrome.storage.local.get("lastMessengerCaptureDebugByTab");
      if (sourceTabId) lastMessengerCaptureDebugByTab[String(sourceTabId)] = debug;
      await chrome.storage.local.set({
        lastMessengerCaptureDebug: debug,
        lastMessengerCaptureDebugByTab,
      });
      return { saved: true };
    },

    async CONVERSATION_INTAKE(message) {
      const dedupeKey = message.idempotencyKey || message.messageHash || "";
      pruneRecentConversationIntakes();
      if (
        dedupeKey &&
        (conversationIntakeInFlight.has(dedupeKey) || recentConversationIntakes.has(dedupeKey))
      ) {
        return { skipped: true, reason: "duplicate_extension_intake" };
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
        if (dedupeKey) recentConversationIntakes.set(dedupeKey, Date.now());
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
