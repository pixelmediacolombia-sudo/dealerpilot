const DEFAULT_BACKEND_URL =
  "https://ec193748-b4c5-4148-b6bc-c48c04b54f9f-00-3kog7rk919p6z.janeway.replit.dev";

const urlInput = document.getElementById("url");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const refreshBtn = document.getElementById("refresh");

const el = {
  dotOnline: document.getElementById("dot-online"),
  vOnline: document.getElementById("v-online"),
  dotBackend: document.getElementById("dot-backend"),
  vBackend: document.getElementById("v-backend"),
  vJobs: document.getElementById("v-jobs"),
  vCurrent: document.getElementById("v-current"),
  vSync: document.getElementById("v-sync"),
};

let nextJob = null;
let activeJob = null;

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = kind || "";
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function setDot(dot, kind) {
  dot.className = "dot" + (kind ? " " + kind : "");
}

function renderStart() {
  if (activeJob) {
    startBtn.textContent = "Reopen Marketplace (active job)";
    startBtn.disabled = false;
  } else if (nextJob) {
    startBtn.textContent = "Start Publishing Job";
    startBtn.disabled = false;
  } else {
    startBtn.textContent = "Start Publishing Job";
    startBtn.disabled = true;
  }
}

async function refresh() {
  el.vOnline.textContent = navigator.onLine ? "Yes" : "No";
  setDot(el.dotOnline, navigator.onLine ? "on" : "off");

  const stored = await chrome.storage.local.get("activeJob");
  activeJob = stored.activeJob || null;

  el.vBackend.textContent = "Checking…";
  setDot(el.dotBackend, "warn");
  const ping = await send({ type: "PING" });
  if (ping && ping.ok) {
    el.vBackend.textContent = "Connected";
    setDot(el.dotBackend, "on");
  } else {
    el.vBackend.textContent = "Unreachable";
    setDot(el.dotBackend, "off");
    el.vJobs.textContent = "—";
    el.vCurrent.textContent = activeJob ? activeJob.listingTitle || `Job #${activeJob.id}` : "None";
    el.vSync.textContent = new Date().toLocaleTimeString();
    renderStart();
    return;
  }

  const res = await send({ type: "GET_NEXT_JOB" });
  if (res && res.ok) {
    nextJob = res.data.job || null;
    el.vJobs.textContent = nextJob ? "1+ ready" : "None";
  } else {
    nextJob = null;
    el.vJobs.textContent = "Error";
  }

  el.vCurrent.textContent = activeJob
    ? activeJob.listingTitle || `Job #${activeJob.id}`
    : "None";
  el.vSync.textContent = new Date().toLocaleTimeString();
  renderStart();
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;

  if (activeJob) {
    await send({ type: "OPEN_MARKETPLACE" });
    setStatus("Reopened Marketplace for the active job.", "ok");
    window.close();
    return;
  }

  if (!nextJob) {
    setStatus("No jobs available.", "err");
    startBtn.disabled = false;
    return;
  }

  setStatus("Claiming job…");
  const claim = await send({ type: "CLAIM_JOB", jobId: nextJob.id });
  if (!claim || !claim.ok) {
    // 409 => someone else claimed it; refresh to fetch another.
    if (claim && claim.status === 409) {
      setStatus("Job was already claimed. Fetching another…", "err");
    } else {
      setStatus("Claim failed: " + (claim && claim.error), "err");
    }
    await refresh();
    startBtn.disabled = false;
    return;
  }

  const claimedJob = claim.data.job || claim.data;
  await chrome.storage.local.set({ activeJob: claimedJob });
  activeJob = claimedJob;

  setStatus("Job claimed. Opening Marketplace…", "ok");
  await send({ type: "OPEN_MARKETPLACE" });
  window.close();
});

refreshBtn.addEventListener("click", () => {
  setStatus("");
  refresh();
});

// Poll the backend for job availability while the popup is open. Popups close
// when they lose focus, so the interval is naturally torn down with the page;
// we also clear it explicitly on unload to be safe.
const POLL_MS = 5000;
const pollTimer = setInterval(refresh, POLL_MS);
window.addEventListener("unload", () => clearInterval(pollTimer));

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
  await refresh();
});

refresh();
