const DEFAULT_BACKEND_URL =
  "https://ec193748-b4c5-4148-b6bc-c48c04b54f9f-00-3kog7rk919p6z.janeway.replit.dev";

// ---- DOM refs: main panel ----
const urlInput   = document.getElementById("url");
const statusEl   = document.getElementById("status");
const startBtn   = document.getElementById("start");
const refreshBtn = document.getElementById("refresh");

const el = {
  dotOnline:  document.getElementById("dot-online"),
  vOnline:    document.getElementById("v-online"),
  dotBackend: document.getElementById("dot-backend"),
  vBackend:   document.getElementById("v-backend"),
  vJobs:      document.getElementById("v-jobs"),
  vCurrent:   document.getElementById("v-current"),
  vSync:      document.getElementById("v-sync"),
};

// ---- DOM refs: debug panel ----
const dbg = {
  version:    document.getElementById("d-version"),
  chromeId:   document.getElementById("d-chrome-id"),
  dealerId:   document.getElementById("d-dealer-id"),
  backendUrl: document.getElementById("d-backend-url"),
  connStatus: document.getElementById("d-conn-status"),
  heartbeat:  document.getElementById("d-heartbeat"),
  claimed:    document.getElementById("d-claimed"),
  published:  document.getElementById("d-published"),
  error:          document.getElementById("d-error"),
  marketplace:    document.getElementById("d-marketplace"),
  messenger:      document.getElementById("d-messenger"),
  workflowStep:   document.getElementById("d-workflow-step"),
  workflowStepAt: document.getElementById("d-workflow-step-at"),
};

let nextJob   = null;
let activeJob = null;
let lastConnectionOk = false;

// ---- Helpers ----
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

function getModeLabel(job) {
  if (!job) return "";
  const mode = job.mode || "Assisted";
  return mode === "Controlled" ? " [AUTO]" : " [Assisted]";
}

function renderStart() {
  if (activeJob) {
    startBtn.textContent = `Reopen Marketplace${getModeLabel(activeJob)}`;
    startBtn.disabled = false;
  } else if (nextJob) {
    startBtn.textContent = `Start Publishing Job${getModeLabel(nextJob)}`;
    startBtn.disabled = false;
  } else {
    startBtn.textContent = "Start Publishing Job";
    startBtn.disabled = true;
  }
}

function fmtTime(iso) {
  if (!iso) return "Never";
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// ---- Debug panel ----
async function loadDebugState() {
  // Chrome extension ID is available directly in the popup context
  dbg.chromeId.textContent = truncate(chrome.runtime.id || "—", 24);
  dbg.chromeId.title = chrome.runtime.id || "";

  const res = await send({ type: "GET_DEBUG_STATE" });
  if (!res || !res.ok) {
    dbg.connStatus.textContent = "Error reading state";
    dbg.connStatus.className = "value err";
    return;
  }
  const d = res.data;

  dbg.version.textContent    = d.version || "—";
  dbg.dealerId.textContent   = `${d.dealerId} — ${d.dealerName}`;
  dbg.backendUrl.textContent = truncate(d.backendUrl || "—", 32);
  dbg.backendUrl.title       = d.backendUrl || "";

  dbg.connStatus.textContent  = lastConnectionOk ? "Connected" : "Unreachable";
  dbg.connStatus.className    = "value " + (lastConnectionOk ? "ok" : "err");

  dbg.heartbeat.textContent = fmtTime(d.lastHeartbeat);

  if (d.lastClaimedJob) {
    const j = d.lastClaimedJob;
    dbg.claimed.textContent = `#${j.id} — ${truncate(j.title || "", 20)} (${fmtTime(j.claimedAt)})`;
    dbg.claimed.className = "value ok";
  } else {
    dbg.claimed.textContent = "None";
    dbg.claimed.className   = "value";
  }

  if (d.lastPublishedJob) {
    const j = d.lastPublishedJob;
    dbg.published.textContent = `#${j.id} at ${fmtTime(j.completedAt)}`;
    dbg.published.className   = "value ok";
  } else {
    dbg.published.textContent = "None";
    dbg.published.className   = "value";
  }

  if (d.lastError) {
    dbg.error.textContent = `${truncate(d.lastError.message, 36)} (${fmtTime(d.lastError.at)})`;
    dbg.error.className   = "value err";
  } else {
    dbg.error.textContent = "None";
    dbg.error.className   = "value ok";
  }

  const mkpYes = d.marketplaceDetected;
  dbg.marketplace.textContent = mkpYes ? "Yes ✓" : "No";
  dbg.marketplace.className   = "value " + (mkpYes ? "ok" : "");

  const msgYes = d.messengerDetected;
  dbg.messenger.textContent = msgYes ? "Yes ✓" : "No";
  dbg.messenger.className   = "value " + (msgYes ? "ok" : "");

  if (d.workflowStep) {
    const isErr = d.workflowStep.startsWith("❌");
    dbg.workflowStep.textContent = d.workflowStep;
    dbg.workflowStep.className   = "value " + (isErr ? "err" : "ok");
    dbg.workflowStepAt.textContent = fmtTime(d.workflowStepAt);
  } else {
    dbg.workflowStep.textContent   = "—";
    dbg.workflowStep.className     = "value";
    dbg.workflowStepAt.textContent = "—";
  }
}

// ---- Main refresh ----
async function refresh() {
  el.vOnline.textContent = navigator.onLine ? "Yes" : "No";
  setDot(el.dotOnline, navigator.onLine ? "on" : "off");

  const stored = await chrome.storage.local.get("activeJob");
  activeJob = stored.activeJob || null;

  el.vBackend.textContent = "Checking…";
  setDot(el.dotBackend, "warn");

  const ping = await send({ type: "PING" });
  lastConnectionOk = !!(ping && ping.ok);

  if (lastConnectionOk) {
    el.vBackend.textContent = "Connected";
    setDot(el.dotBackend, "on");
  } else {
    el.vBackend.textContent = "Unreachable";
    setDot(el.dotBackend, "off");
    el.vJobs.textContent    = "—";
    el.vCurrent.textContent = activeJob
      ? activeJob.listingTitle || `Job #${activeJob.id}`
      : "None";
    el.vSync.textContent = new Date().toLocaleTimeString();
    renderStart();
    await loadDebugState();
    return;
  }

  const res = await send({ type: "GET_NEXT_JOB" });
  if (res && res.ok) {
    nextJob = res.data && res.data.job ? res.data.job : (res.data || null);
    el.vJobs.textContent = nextJob ? "1+ ready" : "None";
  } else {
    nextJob = null;
    el.vJobs.textContent = "Error";
  }

  el.vCurrent.textContent = activeJob
    ? (activeJob.listingTitle || `Job #${activeJob.id}`) + getModeLabel(activeJob)
    : "None";
  el.vSync.textContent = new Date().toLocaleTimeString();
  renderStart();

  await loadDebugState();
}

// ---- Start job ----
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
    if (claim && claim.status === 409) {
      setStatus("Job was already claimed. Fetching another…", "err");
    } else {
      setStatus("Claim failed: " + (claim && claim.error), "err");
    }
    await refresh();
    startBtn.disabled = false;
    return;
  }

  const claimedJob = (claim.data && claim.data.job) ? claim.data.job : claim.data;

  await send({
    type: "SEND_JOB_EVENT",
    jobId: claimedJob.id,
    event: "job_claimed",
    batchId: claimedJob.batchId || undefined,
  });

  if (claimedJob.mode === "Controlled") {
    setStatus("Controlled mode — DealerPilot will auto-fill all fields.", "ok");
  }

  await chrome.storage.local.set({ activeJob: claimedJob });
  activeJob = claimedJob;

  await send({
    type: "SEND_JOB_EVENT",
    jobId: claimedJob.id,
    event: "marketplace_opened",
    batchId: claimedJob.batchId || undefined,
  });

  setStatus("Job claimed. Opening Marketplace…", "ok");
  await send({ type: "OPEN_MARKETPLACE" });
  window.close();
});

// ---- Refresh button ----
refreshBtn.addEventListener("click", () => {
  setStatus("");
  refresh();
});

// ---- Debug buttons ----
document.getElementById("clear-error").addEventListener("click", async () => {
  await send({ type: "CLEAR_LAST_ERROR" });
  dbg.error.textContent = "None";
  dbg.error.className   = "value ok";
});

document.getElementById("reload-debug").addEventListener("click", () => {
  loadDebugState();
});

// ---- Save backend URL ----
chrome.storage.local.get("backendUrl").then(({ backendUrl }) => {
  urlInput.value = backendUrl || DEFAULT_BACKEND_URL;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = urlInput.value.trim().replace(/\/+$/, "");
  if (!value) { setStatus("Please enter a URL.", "err"); return; }
  await chrome.storage.local.set({ backendUrl: value });
  setStatus("Saved. Testing connection…");
  await refresh();
});

// ---- Auto-refresh ----
const POLL_MS = 5000;
const pollTimer = setInterval(refresh, POLL_MS);
window.addEventListener("unload", () => clearInterval(pollTimer));

// ---- Init ----
refresh();
