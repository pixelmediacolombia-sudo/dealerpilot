const DEFAULT_BACKEND_URL = "https://dealerpilot-cq3x.onrender.com";
const REPLIT_BACKEND_URL = "https://dealerpilot1987.replit.app";

// Build date is bumped manually alongside manifest.json's version field.
const BUILD_DATE = "2026-07-09";

(function initVersionDisplay() {
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version;
  const headerVersionEl = document.getElementById("header-version");
  const headerBuildEl   = document.getElementById("header-build");
  const dBuildEl        = document.getElementById("d-build");
  if (headerVersionEl) headerVersionEl.textContent = `v${version} · Alpha Motorsport`;
  if (headerBuildEl)   headerBuildEl.textContent   = `Build: ${version} — ${BUILD_DATE}`;
  if (dBuildEl)         dBuildEl.textContent        = `APP_CONTROLLED_PUBLISHING_${version} — ${BUILD_DATE}`;
})();

// ---- DOM refs: main panel ----
const urlInput   = document.getElementById("url");
const statusEl   = document.getElementById("status");
const startBtn   = document.getElementById("dev-start");
const refreshBtn = document.getElementById("refresh");

const el = {
  dotBackend:   document.getElementById("dot-backend"),
  vBackend:     document.getElementById("v-backend"),
  vMode:        document.getElementById("v-mode"),
  vPublishModeBanner: document.getElementById("v-publish-mode-banner"),
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
  vEnvBadge:    document.getElementById("v-env-badge"),
};

// ---- DOM refs: debug panel ----
const dbg = {
  version:       document.getElementById("d-version"),
  chromeId:      document.getElementById("d-chrome-id"),
  extId:         document.getElementById("d-ext-id"),
  dealerId:      document.getElementById("d-dealer-id"),
  backendUrl:    document.getElementById("d-backend-url"),
  environment:   document.getElementById("d-environment"),
  heartbeatUrl:      document.getElementById("d-heartbeat-url"),
  heartbeatResponse: document.getElementById("d-heartbeat-response"),
  payloadMode:       document.getElementById("d-payload-mode"),
  payloadFlags:      document.getElementById("d-payload-flags"),
  payloadEnv:        document.getElementById("d-payload-env"),
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
  return mode === "Controlled" ? " [Full Auto]" : " [Assisted]";
}

function updatePublishModeDisplay(job) {
  const mode = job ? (job.mode || "Assisted") : "Full Auto";
  const isFullAuto = mode === "Controlled" || mode === "Full Auto";
  if (el.vMode) {
    el.vMode.textContent = isFullAuto ? "Full Auto ✓" : "Assisted";
    el.vMode.className = "value " + (isFullAuto ? "ok" : "warn-text");
  }
  if (el.vPublishModeBanner) {
    el.vPublishModeBanner.textContent = isFullAuto
      ? "Mode: Full Auto — extension clicks Next + Publish automatically."
      : "Mode: Assisted — operator clicks Publish manually.";
  }
}

function renderStart() {
  if (activeJob) {
    startBtn.textContent = "Reopen Marketplace";
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
    startBtn.textContent = "Resume Current Approved Job";
    startBtn.disabled = false;
  } else {
    startBtn.textContent = "Resume Current Approved Job";
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
function envBadgeClass(env) {
  switch (env) {
    case "Render": return "env-render";
    case "Replit": return "env-replit";
    case "Local":  return "env-local";
    default:       return "env-custom";
  }
}

function envBadgeLabel(env) {
  switch (env) {
    case "Render": return "Render ✓";
    case "Replit": return "Replit (dev)";
    case "Local":  return "Local ⚠";
    default:       return (env || "Unknown") + " ⚠";
  }
}

function fmtHeartbeatResponse(hb) {
  if (!hb) return "—";
  if (hb.ok) return `OK (${fmtTime(hb.at)})`;
  return `Error${hb.status ? " " + hb.status : ""}: ${truncate(hb.error || "unknown", 24)}`;
}

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
  dbg.extId.textContent      = truncate(d.extensionId || "—", 24);
  dbg.extId.title            = d.extensionId || "";
  dbg.dealerId.textContent   = `${d.dealerId} — ${d.dealerName}`;
  dbg.backendUrl.textContent = truncate(d.backendUrl || "—", 32);
  dbg.backendUrl.title       = d.backendUrl || "";

  dbg.environment.textContent = d.environment || "Unknown";
  dbg.environment.className   = "value " + (d.environment === "Render" ? "ok" : d.environment === "Replit" ? "" : "warn-text");

  el.vEnvBadge.textContent = envBadgeLabel(d.environment);
  el.vEnvBadge.className   = "env-badge " + envBadgeClass(d.environment);

  dbg.heartbeatUrl.textContent = truncate(d.lastHeartbeatUrl || "—", 32);
  dbg.heartbeatUrl.title       = d.lastHeartbeatUrl || "";

  dbg.heartbeatResponse.textContent = fmtHeartbeatResponse(d.lastHeartbeatResponse);
  dbg.heartbeatResponse.title       = d.lastHeartbeatResponse
    ? JSON.stringify(d.lastHeartbeatResponse)
    : "";
  dbg.heartbeatResponse.className   = "value " + (d.lastHeartbeatResponse
    ? (d.lastHeartbeatResponse.ok ? "ok" : "err")
    : "");

  const pd = d.lastPayloadDebug;
  if (pd) {
    dbg.payloadMode.textContent = `${pd.publishMode || "—"} (${fmtTime(pd.at)})`;
    dbg.payloadFlags.textContent = `controlled=${pd.controlledMode === true} · autoClick=${pd.autoClickPublish === true}`;
    dbg.payloadEnv.textContent = pd.backendEnvironment || "—";
  } else {
    dbg.payloadMode.textContent = "—";
    dbg.payloadFlags.textContent = "—";
    dbg.payloadEnv.textContent = "—";
  }

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
    const isLiveJobFmt = d.lastNextResponse.startsWith("job #");
    const isStale      = d.lastNextResponse.startsWith("[stale]");
    const needsApprove = d.lastNextResponse.startsWith("[needs approval]");

    // Suppress unconfirmed legacy cache: if it looks like a raw "job #N" string
    // (no prefix from the current safety gate) and the timestamp is older than
    // 2 minutes, treat it as unverified and hide it. This catches stale
    // chrome.storage.local values from previous sessions (e.g. "job #19").
    const STALE_MS = 2 * 60 * 1000;
    const responseAge = d.lastNextResponseAt ? Date.now() - d.lastNextResponseAt : Infinity;
    const isUnconfirmedLegacy = isLiveJobFmt && responseAge > STALE_MS;

    if (isUnconfirmedLegacy) {
      dbg.lastNext.textContent = "— (stale cache cleared)";
      dbg.lastNext.title       = `Suppressed: ${d.lastNextResponse}`;
      dbg.lastNext.className   = "value";
    } else {
      dbg.lastNext.textContent = truncate(d.lastNextResponse, 32);
      dbg.lastNext.title       = d.lastNextResponse;
      dbg.lastNext.className   = "value " + (
        isLiveJobFmt ? "ok"        :
        isStale      ? "err"       :
        needsApprove ? "warn-text" : ""
      );
    }
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

  // ── Fresh-install filter ──────────────────────────────────────────────────
  // Only show a queued job if it was created AFTER this extension was installed,
  // OR it's a publish_now job that the user approved within the last 10 minutes.
  if (nextJob) {
    const { installedAt } = await chrome.storage.local.get("installedAt");
    if (installedAt) {
      const installedTime = new Date(installedAt).getTime();
      const jobCreatedAt = nextJob.createdAt ? new Date(nextJob.createdAt).getTime() : 0;
      const jobAge = Date.now() - jobCreatedAt;
      const isAfterInstall = jobCreatedAt > installedTime;
      const isPublishNowApproved = nextJob.source === "publish_now" && nextJob.approvedByUser === true;
      const isRecent = jobAge < 10 * 60 * 1000;
      if (!isAfterInstall && !(isPublishNowApproved && isRecent)) {
        nextJob = null;
      }
    }
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
  updatePublishModeDisplay(activeJob || nextJob);
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

// ---- Emergency Kill ----
document.getElementById("emergency-kill").addEventListener("click", async () => {
  const btn = document.getElementById("emergency-kill");
  btn.disabled = true;
  btn.textContent = "Killing…";
  await send({ type: "EMERGENCY_KILL" });
  // Also wipe chrome.storage display fields directly so popup reflects it instantly
  await chrome.storage.local.remove([
    "activeJob", "lastClaimedJob", "lastPublishedJob",
    "lastError", "lastClaimAttempt", "lastClaimError",
    "lastNextResponse", "lastNextResponseAt",
    "lastPollTime", "auditLog",
  ]);
  activeJob = null;
  nextJob = null;
  // Reset display immediately without waiting for refresh
  dbg.activeJob.textContent = "None";   dbg.activeJob.className = "value";
  dbg.claimed.textContent   = "None";   dbg.claimed.className   = "value";
  dbg.published.textContent = "None";   dbg.published.className = "value";
  dbg.lastNext.textContent  = "—";      dbg.lastNext.className  = "value";
  dbg.lastPoll.textContent  = "Never";  dbg.lastPoll.className  = "value";
  dbg.lastClaim.textContent = "None";   dbg.lastClaim.className = "value";
  dbg.lastClaimErr.textContent = "None"; dbg.lastClaimErr.className = "value ok";
  dbg.error.textContent     = "None";   dbg.error.className     = "value ok";
  el.vQueued.textContent    = "None";
  el.vCurrent.textContent   = "None";
  renderStart();
  setStatus("Emergency kill complete — all state cleared.", "ok");
  btn.disabled = false;
  btn.textContent = "🚨 Emergency Kill / Reset All";
  await refresh();
});

// ---- Reset Extension State ----
document.getElementById("reset-state").addEventListener("click", async () => {
  const btn = document.getElementById("reset-state");
  btn.disabled = true;
  await send({ type: "RESET_EXTENSION_STATE" });
  activeJob = null;
  nextJob = null;
  el.vQueued.textContent = "None";   el.vQueued.className = "value";
  el.vCurrent.textContent = "None";
  renderStart();
  setStatus("Extension state reset — ready for a fresh start.", "ok");
  btn.disabled = false;
  await refresh();
});

// ---- Clear Cached Queue Display ----
document.getElementById("clear-queue-display").addEventListener("click", async () => {
  await chrome.storage.local.remove(["lastNextResponse", "lastNextResponseAt"]);
  dbg.lastNext.textContent  = "—";
  dbg.lastNext.className    = "value";
  dbg.lastNextAt.textContent = "Never";
  el.vQueued.textContent    = "None";
  if (!activeJob) nextJob = null;
  renderStart();
  setStatus("Queue display cleared.", "ok");
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

// ---- Switch Backend URL (Replit / Render / Local / Custom, no rebuild) ----
const envSelect = document.getElementById("env-select");
const envUrlInput = document.getElementById("env-url-input");
const switchBackendBtn = document.getElementById("switch-backend");

async function loadBackendPresetsIntoUI() {
  const res = await send({ type: "GET_BACKEND_PRESETS" });
  const presets = res && res.ok ? res.data : {};
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  const current = (backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");

  let selected = "custom";
  if (current === (presets.replit || REPLIT_BACKEND_URL)) selected = "replit";
  else if (presets.render && current === presets.render) selected = "render";
  else if (presets.local && current === presets.local) selected = "local";

  envSelect.value = selected;
  envUrlInput.value =
    selected === "custom" ? current : presets[selected] || current;

  envSelect.dataset.presets = JSON.stringify(presets);
}

envSelect.addEventListener("change", () => {
  const presets = JSON.parse(envSelect.dataset.presets || "{}");
  const key = envSelect.value;
  if (key === "replit") envUrlInput.value = presets.replit || REPLIT_BACKEND_URL;
  else if (key === "render") envUrlInput.value = presets.render || "";
  else if (key === "local") envUrlInput.value = presets.local || "http://localhost:5000";
  // "custom" leaves the field for manual entry
});

switchBackendBtn.addEventListener("click", async () => {
  const key = envSelect.value;
  const url = envUrlInput.value.trim().replace(/\/+$/, "");
  if (!url) { setStatus("Please enter a URL to switch to.", "err"); return; }

  if (key === "render" || key === "local" || key === "custom") {
    await send({ type: "SAVE_BACKEND_PRESET", key, url });
  }

  const res = await send({ type: "SET_BACKEND_URL", url });
  if (!res || !res.ok) {
    setStatus("Failed to switch backend URL.", "err");
    return;
  }
  urlInput.value = url;
  setStatus(`Switched to ${res.data.environment}: ${url}`);
  await loadBackendPresetsIntoUI();
  await refresh();
  await loadDebugState();
});

loadBackendPresetsIntoUI();

// ---- Auto-refresh ----
const POLL_MS = 5000;
const pollTimer = setInterval(refresh, POLL_MS);
window.addEventListener("unload", () => clearInterval(pollTimer));

// ---- Init ----
refresh();
