(function () {
  const DEFAULT_BACKEND_URL = "https://app.1987dealerpilot.com";
  const LEGACY_BACKEND_URL = "https://1987dealerpilot.com";

  function normalizeBackendUrl(value) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    return normalized === LEGACY_BACKEND_URL ? DEFAULT_BACKEND_URL : normalized;
  }

  async function getBackendUrl() {
    const { backendUrl } = await chrome.storage.local.get("backendUrl");
    const normalized = normalizeBackendUrl(backendUrl) || DEFAULT_BACKEND_URL;
    if (backendUrl && normalized !== backendUrl) {
      await chrome.storage.local.set({ backendUrl: normalized });
    }
    return normalized;
  }

  async function apiPost(path, body) {
    const base = await getBackendUrl();
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`POST ${path} failed: ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  globalThis.DealerPilotMessengerApiClient = Object.freeze({
    apiPost,
    getBackendUrl,
  });
})();
