const DEFAULT_BACKEND_URL =
  "https://ec193748-b4c5-4148-b6bc-c48c04b54f9f-00-3kog7rk919p6z.janeway.replit.dev";

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
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body) {
  const base = await getBackendUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "PING") {
        const base = await getBackendUrl();
        await apiGet("/api/healthz");
        sendResponse({ ok: true, data: { backendUrl: base } });
        return;
      }
      if (message.type === "GET_TEST_LISTING") {
        const data = await apiGet("/api/extension/test-listing");
        sendResponse({ ok: true, data });
        return;
      }
      if (message.type === "SEND_MESSAGE_CONTEXT") {
        const data = await apiPost("/api/extension/message-context", message.payload);
        sendResponse({ ok: true, data });
        return;
      }
      sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});
