(function () {
  const DEFAULT_BACKEND_URL = "https://dealerpilot-cq3x.onrender.com";

  async function getBackendUrl() {
    const { backendUrl } = await chrome.storage.local.get("backendUrl");
    return (backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  }

  async function apiGet(path) {
    const base = await getBackendUrl();
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`GET ${path} failed: ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
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

  function claimPublishingJob(jobId, extensionId) {
    return apiPost(`/api/publishing/jobs/${jobId}/claim`, { extensionId });
  }

  function completePublishingJob(jobId, body) {
    return apiPost(`/api/publishing/jobs/${jobId}/complete`, body);
  }

  function sendHeartbeat(body) {
    return apiPost("/api/extension/heartbeat", body);
  }

  function sendSessionReport(body) {
    return apiPost("/api/extension/session-report", body);
  }

  globalThis.DealerPilotApiClient = {
    apiGet,
    apiPost,
    claimPublishingJob,
    completePublishingJob,
    getBackendUrl,
    sendHeartbeat,
    sendSessionReport,
  };
})();
