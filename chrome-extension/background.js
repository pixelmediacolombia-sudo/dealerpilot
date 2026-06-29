const DEFAULT_BACKEND_URL =
  "https://ec193748-b4c5-4148-b6bc-c48c04b54f9f-00-3kog7rk919p6z.janeway.replit.dev";

const MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/vehicle";

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  return (backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

async function getExtensionId() {
  const { extensionId } = await chrome.storage.local.get("extensionId");
  if (extensionId) return extensionId;
  const generated =
    "ext-" +
    (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
  await chrome.storage.local.set({ extensionId: generated });
  return generated;
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

const handlers = {
  async PING() {
    const base = await getBackendUrl();
    await apiGet("/api/healthz");
    try {
      await apiPost("/api/extension/heartbeat", { backendUrl: base, status: "online" });
    } catch (heartbeatErr) {
      console.warn("[DealerPilot AI] heartbeat failed", heartbeatErr);
    }
    return { backendUrl: base };
  },

  async GET_TEST_LISTING() {
    return apiGet("/api/extension/test-listing");
  },

  async SEND_MESSAGE_CONTEXT(message) {
    return apiPost("/api/extension/message-context", message.payload);
  },

  // ---- Publishing queue ----
  async GET_NEXT_JOB() {
    return apiGet("/api/publishing/jobs/next");
  },

  async CLAIM_JOB(message) {
    const extensionId = await getExtensionId();
    const job = await apiPost(`/api/publishing/jobs/${message.jobId}/claim`, { extensionId });
    return { job };
  },

  async GET_JOB_PAYLOAD(message) {
    return apiGet(`/api/publishing/jobs/${message.jobId}/payload`);
  },

  async COMPLETE_JOB(message) {
    const extensionId = await getExtensionId();
    const body = { extensionId };
    if (message.listingUrl) body.listingUrl = message.listingUrl;
    return apiPost(`/api/publishing/jobs/${message.jobId}/complete`, body);
  },

  async FAIL_JOB(message) {
    const extensionId = await getExtensionId();
    const body = { extensionId };
    if (message.reason) body.reason = message.reason;
    return apiPost(`/api/publishing/jobs/${message.jobId}/fail`, body);
  },

  async SEND_JOB_EVENT(message) {
    const extensionId = await getExtensionId();
    return apiPost(`/api/publishing/jobs/${message.jobId}/event`, {
      event: message.event,
      extensionId,
      details: message.details || undefined,
      batchId: message.batchId || undefined,
    });
  },

  async GET_EXTENSION_ID() {
    return { extensionId: await getExtensionId() };
  },

  async OPEN_MARKETPLACE() {
    const tab = await chrome.tabs.create({ url: MARKETPLACE_CREATE_URL });
    return { tabId: tab.id };
  },

  // ---- Sales AI: Conversation Intake ----
  // Called by the Messenger content script when a buyer message is detected.
  // Sends conversation context to the backend, receives an AI suggested reply.
  // Does NOT auto-send the reply — operator must click "Insert Reply".
  async CONVERSATION_INTAKE(message) {
    const extensionId = await getExtensionId();
    return apiPost("/api/conversations/intake", {
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
      timestamp: new Date().toISOString(),
    });
  },

  // Fetch lead status for a conversation thread
  async GET_CONVERSATION_LEAD(message) {
    return apiGet(`/api/conversations?dealerId=1`).then((data) => {
      const conv = (data.conversations || []).find(
        (c) => c.externalThreadRef === message.externalThreadRef,
      );
      return { conversation: conv || null };
    });
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      const handler = handlers[message.type];
      if (!handler) {
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        return;
      }
      const data = await handler(message);
      sendResponse({ ok: true, data });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        status: err && err.status,
        data: err && err.data,
      });
    }
  })();
  return true;
});
