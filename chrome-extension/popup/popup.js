const DEFAULT_BACKEND_URL = "https://dealerpilot1987.replit.app";

// ---- DOM refs: main panel ----
const urlInput   = document.getElementById("url");
const statusEl   = document.getElementById("status");
const startBtn   = document.getElementById("dev-start");
const refreshBtn = document.getElementById("refresh");

const el = {
  dotBackend:   document.getElementById("dot-backend"),
  vBackend:     document.getElementById("v-backend"),
  vCurrent:     document.getElementById("v-current"),
  vQueued:      document.getElementById("v-queued"),
  vLastPoll:    document.getElementById("v-last-poll"),
  vSync:        document.getElementById("v-sync"),
  pillFb:       document.getElementById("pill-fb"),
  pillFbText:   document.getElementById("pill-fb-text"),
  pillMkp:      document.getElementById("pill-mkp"),
  pillMkpText:  document.getElementById("pill-mkp-text"),
  fbLoginRow:   document.getElementById("fb-login-row"),
  btnFbLogin:   document.getElementById("btn-fb-login"),
};

// ---- DOM refs: debug panel ----
const dbg = {
  version:       document.getElementById("d-version"),
  chromeId:      document.getElementById("d-chrome-id"),
  dealerId:      document.getElementById("d-dealer-id"),
  backendUrl:    document.getElementById("d-backend-url"),
  connStatus:    document.getElementById("d-conn-status"),
  fbLogin:       document.getElementById("d-fb-login"),
  mkpAccess:     document.getElementById("d-mkp-access"),
  heartbeat:     document.getElementById("d-heartbeat"),
  claimed:       document.getElementById("d-claimed"),
  published:     document.getElementById("d-published"),
  error:             document.getElementById("d-error"),
  marketplace:       document.getElementById("d-marketplace"),
  messenger:         document.getElementById("d-messenger"),
  workflowStep:      document.getElementById("d-workflow-step"),
  workflowStepAt:    document.getElementById("d-workflow-step-at"),
  lastPoll:          document.getElementById("d-last-poll"),
  lastNext:          document.getElementById("d-last-next"),
  lastNextAt:        document.getElementById("d-last-next-at"),
  lastClaim:         document.getElementById("d-last-claim"),
  lastClaimErr:      document.getElementById("d-last-claim-err"),
  activeJob:         document.getElementById("d-active-job"),
};

let nextJob   = null;
let activeJob = null;
let lastConnectionOk = false;
let lastFbLoggedIn = null;

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
    const existing = document.getElementById("dp-reset-job");
    if (!existing) {
      const reset = document.createElement("button");
      reset.id = "dp-reset-job";
      reset.textContent = "✕ Clear stuck job";
      reset.style.cssText = "display:block;margin:4px auto 0;background:none;border:none;color:#888;font-size:11px;cursor:pointer;text-decoration:underline;";
      reset.addEventListener("click", async () => {
        await send({ type: "CLEAR_ACTIVE_JOB" });
        activeJob = null;
        reset.remove();
        setStatus("Job cleared. Refreshing…", "ok");
        await refresh();
      });
      startBtn.insertAdjacentElement("afterend", reset);
    }
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

// ---- FB / Marketplace status pills ----
function updateFbPills(fbLoggedIn, marketplaceConnected) {
  lastFbLoggedIn = fbLoggedIn;

  // Facebook pill
  if (fbLoggedIn === true) {
    el.pillFb.className = "status-pill pill-ok";
    el.pillFbText.textContent = "FB: Logged In";
    setDot(el.pillFb.querySelector(".dot"), "on");
    el.fbLoginRow.style.display = "none";
  } else if (fbLoggedIn === false) {
    el.pillFb.className = "status-pill pill-err";
    el.pillFbText.textContent = "FB: Not Logged In";
    setDot(el.pillFb.querySelector(".dot"), "off");
    el.fbLoginRow.style.display = "block";
  } else {
    el.pillFb.className = "status-pill pill-off";
    el.pillFbText.textContent = "FB: Unknown";
    setDot(el.pillFb.querySelector(".dot"), "");
    el.fbLoginRow.style.display = "none";
  }

  // Marketplace pill
  if (marketplaceConnected === true) {
    el.pillMkp.className = "status-pill pill-ok";
    el.pillMkpText.textContent = "Marketplace: Ready";
    setDot(el.pillMkp.querySelector(".dot"), "on");
  } else if (fbLoggedIn === false) {
    el.pillMkp.className = "status-pill pill-err";
    el.pillMkpText.textContent = "Marketplace: No FB Login";
    setDot(el.pillMkp.querySelector(".dot"), "off");
  } else if (marketplaceConnected === false) {
    el.pillMkp.className = "status-pill pill-warn";
    el.pillMkpText.textContent = "Marketplace: Not Verified";
    setDot(el.pillMkp.querySelector(".dot"), "warn");
  } else {
    el.pillMkp.className = "status-pill pill-off";
    el.pillMkpText.textContent = "Marketplace: Unknown";
    setDot(el.pillMkp.querySelector(".dot"), "");
  }
}

// ---- Debug panel ----
async function loadDebugState() {
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

  // FB login / marketplace in debug panel
  const fbState = d.fbLoggedIn;
  dbg.fbLogin.textContent = fbState === true ? "Yes ✓" : fbState === false ? "No ✗" : "Unknown";
  dbg.fbLogin.className   = "value " + (fbState === true ? "ok" : fbState === false ? "err" : "");

  const mkpState = d.marketplaceConnected;
  dbg.mkpAccess.textContent = mkpState === true ? "Yes ✓" : mkpState === false ? "No" : "Unknown";
  dbg.mkpAccess.className   = "value " + (mkpState === true ? "ok" : "");

  dbg.heartbeat.textContent = fmtTime(d.lastHeartbeat);

  // Publisher
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

  // Poll diagnostics
  dbg.lastPoll.textContent = fmtTime(d.lastPollTime);
  dbg.lastPoll.className   = d.lastPollTime ? "value ok" : "value";

  if (d.lastNextResponse) {
    dbg.lastNext.textContent   = truncate(d.lastNextResponse, 30);
    dbg.lastNext.title         = d.lastNextResponse;
    const hasJob = d.lastNextResponse.startsWith("job #");
    dbg.lastNext.className     = "value " + (hasJob ? "ok" : "");
  } else {
    dbg.lastNext.textContent = "—";
    dbg.lastNext.className   = "value";
  }
  dbg.lastNextAt.textContent = fmtTime(d.lastNextResponseAt);

  if (d.lastClaimAttempt) {
    dbg.lastClaim.textContent = `#${d.lastClaimAttempt.jobId} at ${fmtTime(d.lastClaimAttempt.at)}`;
    dbg.lastClaim.className   = "value ok";
  } else {
    dbg.lastClaim.textContent = "None";
    dbg.lastClaim.className   = "value";
  }

  if (d.lastClaimError) {
    dbg.lastClaimErr.textContent = truncate(d.lastClaimError.message, 28) + ` (${fmtTime(d.lastClaimError.at)})`;
    dbg.lastClaimErr.title       = d.lastClaimError.message;
    dbg.lastClaimErr.className   = "value err";
  } else {
    dbg.lastClaimErr.textContent = "None";
    dbg.lastClaimErr.className   = "value ok";
  }

  if (d.activeJob) {
    const aj = d.activeJob;
    dbg.activeJob.textContent = `#${aj.id} — ${truncate(aj.vehicleLabel || aj.listingTitle || "Job", 18)} (${aj.status})`;
    dbg.activeJob.className   = "value ok";
  } else {
    dbg.activeJob.textContent = "None";
    dbg.activeJob.className   = "value";
  }

  // Job history
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

  // Sync pills with latest stored state
  updateFbPills(d.fbLoggedIn, d.marketplaceConnected);
}

// ---- Main refresh ----
async function refresh() {
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
    el.vQueued.textContent = "—";

    const stored = await chrome.storage.local.get(["activeJob", "fbLoggedIn", "marketplaceConnected", "lastPollTime"]);
    activeJob = stored.activeJob || null;
    el.vCurrent.textContent = activeJob
      ? (activeJob.vehicleLabel || activeJob.listingTitle || `Job #${activeJob.id}`) + getModeLabel(activeJob)
      : "None";
    el.vLastPoll.textContent = fmtTime(stored.lastPollTime);
    el.vSync.textContent = new Date().toLocaleTimeString();
    updateFbPills(stored.fbLoggedIn ?? null, stored.marketplaceConnected ?? null);
    renderStart();
    await loadDebugState();
    return;
  }

  const stored = await chrome.storage.local.get(["activeJob", "lastPollTime"]);
  activeJob = stored.activeJob || null;
  el.vLastPoll.textContent = fmtTime(stored.lastPollTime);

  // Fetch the next queued job — this is what the alarm polls too
  const res = await send({ type: "GET_NEXT_JOB" });
  if (res && res.ok) {
    const raw = res.data;
    nextJob =
      (raw && raw.job && raw.job.id != null) ? raw.job :
      (raw && Array.isArray(raw.jobs) && raw.jobs[0]?.id != null) ? raw.jobs[0] :
      (raw && raw.id != null) ? raw :
      null;
  } else {
    nextJob = null;
  }

  if (nextJob) {
    el.vQueued.textContent = `#${nextJob.id} — ${truncate(nextJob.vehicleLabel || nextJob.listingTitle || "Job", 18)}`;
    el.vQueued.className = "value ok";
  } else {
    el.vQueued.textContent = "None";
    el.vQueued.className = "value";
  }

  el.vCurrent.textContent = activeJob
    ? (activeJob.vehicleLabel || activeJob.listingTitle || `Job #${activeJob.id}`) + getModeLabel(activeJob)
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

  const jobId = nextJob.id ?? nextJob.jobId ?? null;
  if (jobId == null) {
    setStatus("No valid publishing job id returned by backend.", "err");
    startBtn.disabled = false;
    return;
  }

  setStatus("Claiming job…");
  const claim = await send({ type: "CLAIM_JOB", jobId });
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

// ---- FB Login button ----
el.btnFbLogin.addEventListener("click", async () => {
  await send({ type: "OPEN_FACEBOOK_LOGIN" });
  setStatus("Facebook login tab opened.", "ok");
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

document.getElementById("clear-active-job").addEventListener("click", async () => {
  await send({ type: "CLEAR_ACTIVE_JOB" });
  activeJob = null;
  dbg.activeJob.textContent = "None";
  dbg.activeJob.className   = "value";
  el.vCurrent.textContent   = "None";
  setStatus("Active job cleared.", "ok");
  await refresh();
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
