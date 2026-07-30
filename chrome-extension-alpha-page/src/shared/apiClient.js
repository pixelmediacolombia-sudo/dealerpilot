(function () {
  const DEFAULT_BACKEND_URL = "https://1987dealerpilot.com";

  async function getBackendUrl() {
    const { backendUrl } = await chrome.storage.local.get("backendUrl");
    return (backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  }

  async function setBackendUrl(url) {
    const cleaned = String(url || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(cleaned)) {
      throw new Error("Backend URL must start with http:// or https://");
    }
    await chrome.storage.local.set({ backendUrl: cleaned });
    return cleaned;
  }

  async function apiGet(path) {
    const base = await getBackendUrl();
    const response = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`GET ${path} failed: ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  globalThis.DealerPilotAlphaApiClient = {
    apiGet,
    getBackendUrl,
    setBackendUrl,
  };
})();
