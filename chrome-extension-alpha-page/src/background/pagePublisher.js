(function () {
  const ALPHA_COMPOSER_URL =
    "https://business.facebook.com/latest/composer/?asset_id=265746649947861&business_id=7725528554132936&context_ref=HOME&nav_ref=internal_nav&ref=dealerpilot_alpha_page";

  async function saveLastError(error) {
    await chrome.storage.local.set({
      lastAlphaPageError: {
        message: error?.message ? String(error.message) : String(error),
        stack: error?.stack || null,
        at: new Date().toISOString(),
      },
    });
  }

  async function getDebugState() {
    const keys = [
      "backendUrl",
      "pendingAlphaPagePost",
      "lastAlphaPageDraftDebug",
      "lastAlphaPageError",
    ];
    const stored = await chrome.storage.local.get(keys);
    const pending = stored.pendingAlphaPagePost || null;
    return {
      version: chrome.runtime.getManifest?.().version || "0.1.0",
      backendUrl: stored.backendUrl || "https://1987dealerpilot.com",
      target: {
        pageId: "265746649947861",
        businessId: "7725528554132936",
        pageName: "Alpha MotorSports: Easy Credit / Credito Facil",
        composerUrl: ALPHA_COMPOSER_URL,
      },
      pendingPost: pending
        ? {
            vehicleId: pending.payload?.vehicle?.id || null,
            vehicleLabel: pending.payload?.vehicle?.label || null,
            photoCount: pending.payload?.images?.length || 0,
            autoFill: pending.autoFill === true,
            preparedAt: pending.preparedAt || null,
            filledAt: pending.filledAt || null,
            backendUrl: pending.backendUrl || null,
            readiness: pending.payload?.readiness || null,
            target: pending.payload?.target || null,
          }
        : null,
      lastDraftDebug: stored.lastAlphaPageDraftDebug || null,
      lastError: stored.lastAlphaPageError || null,
      rawPendingPost: pending,
    };
  }

  async function openAlphaComposer(composerUrl) {
    const targetUrl = composerUrl || ALPHA_COMPOSER_URL;
    const tabs = await chrome.tabs.query({ url: "https://business.facebook.com/latest/composer*" });
    if (tabs[0]?.id) {
      await chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
      if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
      return { tabId: tabs[0].id, reused: true };
    }
    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    return { tabId: tab.id, reused: false };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message?.type === "OPEN_ALPHA_COMPOSER") {
          const result = await openAlphaComposer(message.composerUrl);
          sendResponse({ ok: true, data: result });
          return;
        }
        if (message?.type === "ALPHA_DRAFT_DEBUG") {
          const debug = {
            ...(message.debug || {}),
            at: message.debug?.at || new Date().toISOString(),
          };
          await chrome.storage.local.set({ lastAlphaPageDraftDebug: debug });
          sendResponse({ ok: true, data: { saved: true } });
          return;
        }
        if (message?.type === "GET_DEBUG_STATE") {
          sendResponse({ ok: true, data: await getDebugState() });
          return;
        }
        sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
      } catch (error) {
        await saveLastError(error).catch(() => {});
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });
})();
