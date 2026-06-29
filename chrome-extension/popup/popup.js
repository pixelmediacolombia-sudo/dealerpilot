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

function getModeLabel(job) {
  if (!job) return "";
  const mode = job.mode || "Assisted";
  return mode === "Controlled" ? " [AUTO]" : " [Assisted]";
}

function renderStart() {
  if (activeJob) {
    const modeLabel = getModeLabel(activeJob);
    startBtn.textContent = `Reopen Marketplace${modeLabel}`;
    startBtn.disabled = false;
  } else if (nextJob) {
    const modeLabel = getModeLabel(nextJob);
    startBtn.textContent = `Start Publishing Job${modeLabel}`;
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

  // Send job_claimed progress event
  await send({
    type: "SEND_JOB_EVENT",
    jobId: claimedJob.id,
    event: "job_claimed",
    batchId: claimedJob.batchId || undefined,
  });

  // Safety check: if mode is Controlled and autoClickPublish is disabled, warn operator
  if (claimedJob.mode === "Controlled") {
    setStatus("Controlled mode — DealerPilot will auto-click Publish if all checks pass.", "ok");
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

refreshBtn.addEventListener("click", () => {
  setStatus("");
  refresh();
});

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
