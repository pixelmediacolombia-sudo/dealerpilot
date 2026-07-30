(function () {
  const ALPHA_COMPOSER_URL =
    "https://business.facebook.com/latest/composer/?asset_id=265746649947861&business_id=7725528554132936&context_ref=HOME&nav_ref=internal_nav&ref=dealerpilot_alpha_page";

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
        sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });
})();
