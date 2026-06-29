const DEFAULT_BACKEND_URL =
  "https://ec193748-b4c5-4148-b6bc-c48c04b54f9f-00-3kog7rk919p6z.janeway.replit.dev";

const urlInput = document.getElementById("url");
const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

chrome.storage.local.get("backendUrl").then(({ backendUrl }) => {
  urlInput.value = backendUrl || DEFAULT_BACKEND_URL;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = urlInput.value.trim().replace(/\/+$/, "");
  if (!value) {
    setStatus("Please enter a URL.", "err");
    return;
  }
  await chrome.storage.local.set({ backendUrl: value });
  setStatus("Saved. Testing connection…");
  try {
    const res = await fetch(`${value}/api/healthz`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      setStatus("Connected. Backend is reachable.", "ok");
    } else {
      setStatus(`Saved, but backend returned ${res.status}.`, "err");
    }
  } catch (err) {
    setStatus("Saved, but could not reach backend.", "err");
  }
});
