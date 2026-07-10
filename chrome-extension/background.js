const DEFAULT_BACKEND_URL = "https://dealerpilot-cq3x.onrender.com";
const REPLIT_BACKEND_URL = "https://dealerpilot1987.replit.app";

const MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/vehicle";
const FACEBOOK_LOGIN_URL =
  "https://www.facebook.com/login/?next=%2Fmarketplace%2Fcreate%2Fvehicle";

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  return (backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

// ---- Environment detection ----
// Classifies the active backendUrl so the popup can clearly show whether the
// extension is pointed at Render, Replit, or a local dev server before a
// live publish test.
function detectEnvironment(url) {
  if (!url) return "Unknown";
  if (/onrender\.com/i.test(url)) return "Render";
  if (/replit\.(app|dev)/i.test(url)) return "Replit";
  if (/localhost|127\.0\.0\.1/i.test(url)) return "Local";
  return "Custom";
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

// ---- Debug state helpers ----

function saveLastError(err) {
  const message = err instanceof Error ? err.message : String(err);
  chrome.storage.local
    .set({ lastError: { message, at: new Date().toISOString() } })
    .catch(() => {});
}

// ---- Structured audit log ----
// Every Facebook tab open MUST call logAudit with a reason before tabs.create().
// Last 50 entries are persisted in chrome.storage.local under "auditLog".
async function logAudit(event, details = {}) {
  const entry = { event, timestamp: new Date().toISOString(), ...details };
  console.log("[DealerPilot AI] [AUDIT]", JSON.stringify(entry));
  try {
    const { auditLog = [] } = await chrome.storage.local.get("auditLog");
    const updated = [...auditLog, entry].slice(-50);
    await chrome.storage.local.set({ auditLog: updated });
  } catch (_) { /* non-critical */ }
}

// ---- Clear connectRequested on backend immediately after opening connection tab ----
// Prevents repeated tab-opens on every 15-second poll if the FB page doesn't load.
async function clearConnectRequested() {
  try {
    await apiPost("/api/extension/connect-acknowledge", {});
  } catch (e) {
    console.warn("[DealerPilot AI] Failed to clear connectRequested:", e);
  }
}

// ---- Message handlers ----

const handlers = {
  async PING() {
    const base = await getBackendUrl();
    await apiGet("/api/healthz");
    const { fbLoggedIn, marketplaceConnected } = await chrome.storage.local.get([
      "fbLoggedIn",
      "marketplaceConnected",
    ]);
    const now = new Date().toISOString();
    const heartbeatUrl = `${base}/api/extension/heartbeat`;
    try {
      const data = await apiPost("/api/extension/heartbeat", {
        backendUrl: base,
        status: "online",
        chromeExtensionId: chrome.runtime.id,
        fbLoggedIn: fbLoggedIn ?? null,
        marketplaceConnected: marketplaceConnected ?? null,
      });
      await chrome.storage.local.set({
        lastHeartbeat: now,
        lastHeartbeatUrl: heartbeatUrl,
        lastHeartbeatResponse: { ok: true, status: 200, body: data, at: now },
      });
    } catch (heartbeatErr) {
      console.warn("[DealerPilot AI] heartbeat failed", heartbeatErr);
      await chrome.storage.local
        .set({
          lastHeartbeatUrl: heartbeatUrl,
          lastHeartbeatResponse: {
            ok: false,
            status: heartbeatErr && heartbeatErr.status ? heartbeatErr.status : null,
            error: heartbeatErr instanceof Error ? heartbeatErr.message : String(heartbeatErr),
            at: now,
          },
        })
        .catch(() => {});
    }
    return { backendUrl: base, environment: detectEnvironment(base) };
  },

  // ---- Backend URL switching (no rebuild required) ----
  async SET_BACKEND_URL(message) {
    const url = (message && message.url ? message.url : "").trim().replace(/\/+$/, "");
    if (!url) throw new Error("Backend URL cannot be empty");
    await chrome.storage.local.set({ backendUrl: url });
    await logAudit("backend_url_switched", { url, environment: detectEnvironment(url) });
    return { ok: true, backendUrl: url, environment: detectEnvironment(url) };
  },

  // Named presets (Replit / Render / Local) so operators only type the
  // Render URL once, then can toggle between environments afterwards.
  async GET_BACKEND_PRESETS() {
    const { backendPresets } = await chrome.storage.local.get("backendPresets");
    return {
      replit: REPLIT_BACKEND_URL,
      render: DEFAULT_BACKEND_URL,
      local: "http://localhost:5000",
      ...(backendPresets || {}),
    };
  },

  async SAVE_BACKEND_PRESET(message) {
    const key = message && message.key;
    if (!["render", "local", "custom"].includes(key)) {
      throw new Error(`Invalid preset key: ${key}`);
    }
    const url = (message && message.url ? message.url : "").trim().replace(/\/+$/, "");
    const { backendPresets = {} } = await chrome.storage.local.get("backendPresets");
    backendPresets[key] = url;
    await chrome.storage.local.set({ backendPresets });
    return { ok: true, backendPresets };
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
    await chrome.storage.local.set({
      lastClaimedJob: {
        id: job.id,
        title: job.listingTitle || job.vehicleLabel || `Job #${job.id}`,
        claimedAt: new Date().toISOString(),
      },
    });
    return { job };
  },

  async GET_JOB_PAYLOAD(message) {
    return apiGet(`/api/publishing/jobs/${message.jobId}/payload`);
  },

  // Stores the payload endpoint's debug fields (v1.3.13) so the popup debug
  // panel can display the server's live publishMode/controlledMode/
  // autoClickPublish/backendEnvironment resolution without a separate call.
  async STORE_PAYLOAD_DEBUG(message) {
    await chrome.storage.local.set({
      lastPayloadDebug: { ...message.data, at: new Date().toISOString() },
    });
    return { ok: true };
  },

  async COMPLETE_JOB(message) {
    const extensionId = await getExtensionId();
    const body = { extensionId };
    if (message.listingUrl) body.listingUrl = message.listingUrl;
    const result = await apiPost(`/api/publishing/jobs/${message.jobId}/complete`, body);
    const finishedAt = new Date().toISOString();
    await chrome.storage.local.set({
      lastJobFinishedAt: finishedAt,
      lastPublishedJob: {
        id: message.jobId,
        completedAt: finishedAt,
        listingUrl: message.listingUrl || null,
      },
    });
    return result;
  },

  async FAIL_JOB(message) {
    const extensionId = await getExtensionId();
    const body = { extensionId };
    if (message.reason) body.reason = message.reason;
    const result = await apiPost(`/api/publishing/jobs/${message.jobId}/fail`, body);
    await chrome.storage.local.set({ lastJobFinishedAt: new Date().toISOString() });
    return result;
  },

  async CANCEL_JOB(message) {
    return apiPost(`/api/publishing/jobs/${message.jobId}/cancel`, {
      reason: message.reason || "Cancelled by operator from extension",
    });
  },

  async RETRY_JOB(message) {
    return apiPost(`/api/publishing/jobs/${message.jobId}/retry`, {});
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

  // ---- App-controlled bridge mode ----

  async GET_ASSIGNED_JOB() {
    const extensionId = await getExtensionId();
    return apiGet(`/api/publishing/jobs/assigned?extensionId=${encodeURIComponent(extensionId)}`);
  },

  async AUTO_START_ASSIGNED(message) {
    const extensionId = await getExtensionId();
    const now = new Date().toISOString();

    // ── SAFETY GUARD 1: Job age ──────────────────────────────────────────────
    // Reject jobs older than 10 minutes. Stale queued jobs must not auto-open
    // Facebook — the user must explicitly trigger them from the popup.
    const JOB_MAX_AGE_MS = 10 * 60 * 1000;
    if (message.createdAt) {
      const age = Date.now() - new Date(message.createdAt).getTime();
      if (age > JOB_MAX_AGE_MS && message.forceUserAction !== true) {
        await logAudit("AUTO_START_BLOCKED_STALE", {
          jobId: message.jobId,
          createdAt: message.createdAt,
          ageMin: Math.round(age / 60000),
          reason: "Job older than 10 minutes — requires explicit user action from popup",
        });
        return { skipped: true, reason: "stale", jobId: message.jobId };
      }
    }

    // ── SAFETY GUARD 2: Mode check ────────────────────────────────────────────
    // Only Controlled-mode jobs are processed by the extension.
    if (message.mode && message.mode !== "Controlled") {
      await logAudit("AUTO_START_BLOCKED_MODE", {
        jobId: message.jobId,
        mode: message.mode,
        reason: "Only Controlled-mode jobs are processed by extension",
      });
      return { skipped: true, reason: "wrong_mode", jobId: message.jobId };
    }

    // Record that we are attempting to claim this job
    await chrome.storage.local.set({
      lastClaimAttempt: { jobId: message.jobId, at: now },
    });

    let job;
    try {
      job = await apiPost(`/api/publishing/jobs/${message.jobId}/claim`, { extensionId });
    } catch (err) {
      await chrome.storage.local.set({
        lastClaimError: {
          jobId: message.jobId,
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        },
      });
      throw err;
    }

    await chrome.storage.local.set({
      activeJob: job,
      lastClaimedJob: {
        id: job.id,
        title: job.listingTitle || job.vehicleLabel || `Job #${job.id}`,
        claimedAt: new Date().toISOString(),
      },
      lastClaimError: null,
    });

    await apiPost(`/api/publishing/jobs/${job.id}/event`, {
      event: "job_claimed",
      extensionId,
    });

    // ── AUDIT LOG: every tab open must be logged with a reason ────────────────
    await logAudit("MARKETPLACE_TAB_OPENED", {
      reason: message.source || "auto_start_assigned",
      jobId: job.id,
      vehicleId: job.vehicleId || null,
      vehicleLabel: job.vehicleLabel || null,
      source: message.source || "poll",
      mode: job.mode || "Controlled",
      approvedByUser: message.approvedByUser ?? true,
      timestamp: new Date().toISOString(),
    });

    // If the user is not logged in, open the Facebook login URL with ?next= pointing to
    // marketplace/create so Facebook auto-redirects after login. Without this, an
    // unauthenticated navigation to MARKETPLACE_CREATE_URL lands on a bare login page
    // (no ?next= param) and after login Facebook goes to the home feed, not Marketplace.
    const { fbLoggedIn } = await chrome.storage.local.get("fbLoggedIn");
    const targetUrl = fbLoggedIn ? MARKETPLACE_CREATE_URL : FACEBOOK_LOGIN_URL;

    const [existing] = await chrome.tabs.query({ url: MARKETPLACE_CREATE_URL + "*" });
    let tab;
    if (existing && fbLoggedIn) {
      tab = await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      tab = await chrome.tabs.create({ url: targetUrl, active: true });
    }
    return { ok: true, jobId: job.id, tabId: tab.id };
  },

  // ---- Marketplace Connection flow ----

  async CONNECT_MARKETPLACE(message) {
    const action = message?.action || "marketplace";
    const url = action === "login" ? FACEBOOK_LOGIN_URL : MARKETPLACE_CREATE_URL;

    // AUDIT: every tab open must be logged
    await logAudit("MARKETPLACE_TAB_OPENED", {
      reason: "connect_requested",
      action,
      url,
      jobId: null,
      vehicleId: null,
      source: "connectRequested",
      approvedByUser: true,
      timestamp: new Date().toISOString(),
    });

    const tab = await chrome.tabs.create({ url, active: true });
    await chrome.storage.local.set({ connectTabId: tab.id });

    // SAFETY: clear connectRequested on backend immediately after opening the tab.
    // Without this, every 15-second poll sees connectRequested=true and opens another tab.
    await clearConnectRequested();

    return { ok: true, tabId: tab.id, action };
  },

  async FB_SESSION_REPORT(message) {
    const { fbLoggedIn, marketplaceConnected } = message;
    await chrome.storage.local.set({ fbLoggedIn, marketplaceConnected });
    const extensionId = await getExtensionId();
    try {
      await apiPost("/api/extension/session-report", {
        extensionId,
        fbLoggedIn: !!fbLoggedIn,
        marketplaceConnected: !!marketplaceConnected,
      });
    } catch (err) {
      console.warn("[DealerPilot AI] session-report failed", err);
    }
    return { ok: true };
  },

  async OPEN_FACEBOOK_LOGIN() {
    const tab = await chrome.tabs.create({ url: FACEBOOK_LOGIN_URL, active: true });
    return { tabId: tab.id };
  },

  async POLL_ASSIGNED_JOB(message = {}) {
    const forceUserAction = message.forceUserAction === true;

    // Self-heal: verify activeJob is still in-progress on the backend.
    // A stuck/terminal job in storage blocks all future polling.
    const { activeJob } = await chrome.storage.local.get("activeJob");
    if (activeJob) {
      try {
        const progress = await apiGet(`/api/publishing/jobs/${activeJob.id}/progress`);
        const terminal = ["Published", "Failed", "Cancelled"];
        if (terminal.includes(progress.status)) {
          await chrome.storage.local.remove("activeJob");
          // fall through to normal poll
        } else {
          await chrome.storage.local.set({ lastPollSkipReason: "active_job_in_progress", lastSkippedJobId: activeJob.id, lastSkippedAt: new Date().toISOString() }).catch(() => {});
          return { skipped: true, jobId: activeJob.id };
        }
      } catch {
        // Can't verify — keep skipping to avoid thrashing
        await chrome.storage.local.set({ lastPollSkipReason: "active_job_progress_check_failed", lastSkippedJobId: activeJob.id, lastSkippedAt: new Date().toISOString() }).catch(() => {});
        return { skipped: true, jobId: activeJob.id };
      }
    }

    const now = new Date().toISOString();
    await chrome.storage.local.set({ lastPollTime: now });

    const extensionId = await getExtensionId();

    // Check for a job explicitly assigned to this extension
    let data;
    try {
      data = await apiGet(`/api/publishing/jobs/assigned?extensionId=${encodeURIComponent(extensionId)}`);
    } catch {
      return { job: null };
    }
    const assignedJob = data && data.job && data.job.id ? data.job : null;
    if (assignedJob) {
      return handlers.AUTO_START_ASSIGNED({
        jobId: assignedJob.id,
        createdAt: assignedJob.assignedAt || assignedJob.createdAt || null,
        mode: assignedJob.mode || "Controlled",
        source: "assigned",
        approvedByUser: true,
        forceUserAction,
      });
    }

    // Check the general queue for any Queued/Retry job.
    // General queue jobs auto-start only if very recent (<5 min) — a "Publish Now"
    // job lands here seconds after the operator clicks the button.
    let nextData;
    try {
      nextData = await apiGet("/api/publishing/jobs/next");
      const summary = (nextData && nextData.job)
        ? `job #${nextData.job.id} — ${nextData.job.vehicleLabel || nextData.job.status}`
        : "null";
      await chrome.storage.local.set({
        lastNextResponse: summary,
        lastNextResponseAt: now,
      });
    } catch (err) {
      await chrome.storage.local.set({
        lastNextResponse: `error: ${err instanceof Error ? err.message : String(err)}`,
        lastNextResponseAt: now,
      });
      return { job: null };
    }
    const nextJob = nextData && nextData.job && nextData.job.id ? nextData.job : null;
    if (!nextJob) {
      // No publish job in queue — only now check connect-status so it never
      // interrupts an active Publish Now flow.
      try {
        const connectStatus = await apiGet("/api/extension/connect-status");
        if (connectStatus.connectRequested) {
          return handlers.CONNECT_MARKETPLACE({ action: connectStatus.connectAction || "marketplace" });
        }
      } catch {
        // ignore — don't block polling
      }
      return { job: null };
    }

    // SAFETY GATE: Only auto-start recent jobs from direct user actions.
    // auto_publish_batch jobs require approval unless the backend marks them
    // approvedByUser=true after the operator disabled "Require approval".
    // publish_now jobs bypass the age check — they are direct operator clicks.
    const RECENT_JOB_MS = 5 * 60 * 1000;
    const jobAge = nextJob.createdAt ? Date.now() - new Date(nextJob.createdAt).getTime() : Infinity;
    const jobSource = nextJob.source || null;
    const isPublishNow = jobSource === "publish_now";
    const isAutoPublishBatch = jobSource === "auto_publish_batch";
    const isApproved = nextJob.approvedByUser === true;
    const isApprovedAutoBatch = isAutoPublishBatch && isApproved;
    const isTooOld = jobAge > RECENT_JOB_MS;

    if (((isTooOld && !isPublishNow && !isApproved) || (isAutoPublishBatch && !isApprovedAutoBatch)) && !(forceUserAction && isPublishNow)) {
      const reason = isAutoPublishBatch
        ? "Job source is auto_publish_batch — user must approve from popup"
        : "Job is older than 5 minutes — user must trigger from popup";
      await logAudit("POLL_STALE_JOB_SKIPPED", {
        jobId: nextJob.id,
        createdAt: nextJob.createdAt,
        ageMin: Math.round(jobAge / 60000),
        source: jobSource,
        reason,
      });
      await chrome.storage.local.set({ lastPollSkipReason: reason, lastSkippedJobId: nextJob.id, lastSkippedAt: new Date().toISOString() }).catch(() => {});
      const staleLabel = isAutoPublishBatch
        ? `[needs approval] job #${nextJob.id} — ${nextJob.vehicleLabel || nextJob.status}`
        : `[stale] job #${nextJob.id} — ${nextJob.vehicleLabel || nextJob.status}`;
      await chrome.storage.local.set({
        lastNextResponse: staleLabel,
        lastNextResponseAt: Date.now(),
      });
      return { job: null, skipped: "stale", jobId: nextJob.id };
    }

    // ── Sequential queue: 2-minute inter-job cooldown ────────────────────────
    // SKIPPED for publish_now jobs — operator triggered, must start immediately.
    // Applied only to scheduled/queued batch jobs to prevent opening multiple tabs.
    if (!isPublishNow) {
      const { lastJobFinishedAt } = await chrome.storage.local.get("lastJobFinishedAt");
      if (lastJobFinishedAt) {
        const INTER_JOB_DELAY_MS = 2 * 60_000;
        const finishedMs  = new Date(lastJobFinishedAt).getTime();
        const cooldownEnd = finishedMs + INTER_JOB_DELAY_MS;
        const remaining   = cooldownEnd - Date.now();
        if (remaining > 0) {
          const remainingSec = Math.round(remaining / 1000);
          console.log(`[DealerPilot AI] Sequential queue: cooling down ${remainingSec}s before next job`);
          await chrome.storage.local.set({
            queueCooldownUntil: new Date(cooldownEnd).toISOString(),
            queueCooldownRemainingS: remainingSec,
          });
          return { skipped: true, reason: "cooldown", cooldownRemainingS: remainingSec };
        }
        await chrome.storage.local.remove(["queueCooldownUntil", "queueCooldownRemainingS"]);
      }
    }

    return handlers.AUTO_START_ASSIGNED({
      jobId: nextJob.id,
      createdAt: nextJob.createdAt || null,
      mode: nextJob.mode || "Controlled",
      source: jobSource || "publish_now",
      approvedByUser: true,
      forceUserAction,
    });
  },

  // ── Instant wake: called by the dashboard immediately after Publish Now ──
  // Bypasses the alarm interval so the job is claimed in under 2 seconds.
  async POLL_NOW(message = {}) {
    return handlers.POLL_ASSIGNED_JOB({
      forceUserAction: message.forceUserAction === true,
    });
  },

  async GET_EXTENSION_ID() {
    return { extensionId: await getExtensionId() };
  },

  async OPEN_MARKETPLACE() {
    await logAudit("MARKETPLACE_TAB_OPENED", {
      reason: "explicit_user_action",
      source: "OPEN_MARKETPLACE",
      jobId: null,
      vehicleId: null,
      approvedByUser: true,
      timestamp: new Date().toISOString(),
    });
    const tab = await chrome.tabs.create({ url: MARKETPLACE_CREATE_URL });
    return { tabId: tab.id };
  },

  // ---- Job validation ----
  // Called by content.js before running the publishing flow to confirm the
  // activeJob is still active on the backend (not stale/terminal/cancelled).
  async VALIDATE_JOB(message) {
    return apiGet(`/api/publishing/jobs/${message.jobId}/progress`);
  },

  // ---- Emergency kill switch ----
  // Clears ALL local extension state, cancels the active job on backend,
  // and resets connectRequested. Safe to call at any time.
  async EMERGENCY_KILL() {
    await logAudit("EMERGENCY_KILL", {
      reason: "operator_triggered",
      timestamp: new Date().toISOString(),
    });

    // Get current state before wiping
    const { activeJob } = await chrome.storage.local.get("activeJob");

    // Wipe all local extension state (including audit log)
    await chrome.storage.local.remove([
      "activeJob", "lastClaimedJob", "lastPublishedJob",
      "lastError", "lastClaimAttempt", "lastClaimError",
      "lastNextResponse", "lastNextResponseAt", "connectTabId",
      "lastPollTime", "auditLog",
    ]);

    // Cancel active job on backend (mark Failed)
    if (activeJob && activeJob.id) {
      try {
        const extensionId = await getExtensionId();
        await apiPost(`/api/publishing/jobs/${activeJob.id}/fail`, {
          extensionId,
          reason: "Emergency kill switch activated by operator",
        });
        await logAudit("EMERGENCY_KILL_JOB_CANCELLED", { jobId: activeJob.id });
      } catch (e) {
        console.warn("[DealerPilot AI] Emergency kill: failed to cancel job on backend", e);
      }
    }

    // Reset connectRequested on backend
    await clearConnectRequested();

    return { ok: true, cancelledJobId: activeJob?.id ?? null };
  },

  // ---- Reset all local state (non-destructive: keeps backendUrl, extensionId) ----
  async RESET_EXTENSION_STATE() {
    await chrome.storage.local.remove(STATE_KEYS_TO_CLEAR);
    await chrome.storage.local.set({ installedAt: new Date().toISOString() });
    console.log("[DealerPilot AI] Extension state reset by operator");
    return { ok: true };
  },

  async GET_DEBUG_STATE() {
    const keys = [
      "backendUrl",
      "extensionId",
      "installedAt",
      "storedVersion",
      "lastHeartbeat",
      "lastClaimedJob",
      "lastPublishedJob",
      "lastError",
      "marketplaceDetected",
      "messengerDetected",
      "workflowStep",
      "workflowStepAt",
      "fbLoggedIn",
      "marketplaceConnected",
      "connectTabId",
      "activeJob",
      "lastPollTime",
      "lastNextResponse",
      "lastNextResponseAt",
      "lastClaimAttempt",
      "lastClaimError",
      "auditLog",
      "lastHeartbeatUrl",
      "lastHeartbeatResponse",
      "lastPayloadDebug",
    ];
    const stored = await chrome.storage.local.get(keys);
    const base = await getBackendUrl();
    const manifest = chrome.runtime.getManifest();
    return {
      version: manifest.version,
      extensionId: stored.extensionId || null,
      backendUrl: base,
      environment: detectEnvironment(base),
      dealerId: 1,
      dealerName: "Alpha Motorsport",
      lastHeartbeat: stored.lastHeartbeat || null,
      lastHeartbeatUrl: stored.lastHeartbeatUrl || null,
      lastHeartbeatResponse: stored.lastHeartbeatResponse || null,
      lastPayloadDebug: stored.lastPayloadDebug || null,
      lastClaimedJob: stored.lastClaimedJob || null,
      lastPublishedJob: stored.lastPublishedJob || null,
      lastError: stored.lastError || null,
      marketplaceDetected: stored.marketplaceDetected || false,
      messengerDetected: stored.messengerDetected || false,
      workflowStep: stored.workflowStep || null,
      workflowStepAt: stored.workflowStepAt || null,
      fbLoggedIn: stored.fbLoggedIn ?? null,
      marketplaceConnected: stored.marketplaceConnected ?? null,
      connectTabId: stored.connectTabId || null,
      activeJob: stored.activeJob || null,
      lastPollTime: stored.lastPollTime || null,
      lastNextResponse: stored.lastNextResponse || null,
      lastNextResponseAt: stored.lastNextResponseAt || null,
      lastClaimAttempt: stored.lastClaimAttempt || null,
      lastClaimError: stored.lastClaimError || null,
      auditLog: stored.auditLog || [],
    };
  },

  async CLEAR_LAST_ERROR() {
    await chrome.storage.local.remove("lastError");
    return { ok: true };
  },

  async CLEAR_ACTIVE_JOB() {
    await chrome.storage.local.remove(["activeJob", "lastClaimedJob"]);
    return { ok: true };
  },

  // ---- Sales AI: Conversation Intake ----
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

  async GET_CONVERSATION_LEAD(message) {
    return apiGet(`/api/conversations?dealerId=1`).then((data) => {
      const conv = (data.conversations || []).find(
        (c) => c.externalThreadRef === message.externalThreadRef,
      );
      return { conversation: conv || null };
    });
  },

  // ---- Photo proxy: fetch a job photo through our backend proxy ----
  // Constructs the backend proxy URL and delegates to FETCH_IMAGE_AS_BASE64.
  // The extension NEVER contacts CDN/dealer image hosts directly — only our backend.
  async FETCH_JOB_PHOTO(message) {
    const { jobId, index } = message;
    const base = await getBackendUrl();
    const proxyUrl = `${base}/api/publishing/jobs/${jobId}/photo/${index}`;
    console.log(`[PHOTO] proxy fetch — job ${jobId} photo ${index} — ${proxyUrl}`);
    return handlers.FETCH_IMAGE_AS_BASE64({ url: proxyUrl });
  },

  // ---- Image proxy: fetch a remote image and return it as base64 ----
  // Content scripts cannot bypass CORS; the service worker can.
  async FETCH_IMAGE_AS_BASE64(message) {
    console.log("[PHOTO] background received request — url:", message.url);

    // Detect and reject relative URLs early — they cannot be resolved by the
    // service worker (it would try chrome-extension://[id]/... which doesn't exist).
    if (!message.url || message.url.startsWith("/") || message.url.startsWith("./")) {
      const err = `[PHOTO] RELATIVE URL DETECTED — cannot fetch "${message.url}" from service worker. ` +
        "The payload endpoint must return absolute URLs (https://...). " +
        "Fix: prepend the backend base URL before returning image URLs in the payload response.";
      console.error(err);
      throw new Error(err);
    }

    console.log("[PHOTO] fetching URL:", message.url);
    let response;
    try {
      response = await fetch(message.url);
    } catch (fetchErr) {
      // Surface the raw network/CORS exception instead of swallowing it
      const errMsg = `[PHOTO] fetch() threw exception for "${message.url}": ${fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr)}`;
      console.error(errMsg, fetchErr);
      throw new Error(errMsg);
    }

    console.log("[PHOTO] response status:", response.status, response.statusText, "— url:", message.url);

    // Log CORS-relevant headers
    const corsHeader = response.headers.get("access-control-allow-origin");
    const contentType = response.headers.get("content-type") || "image/jpeg";
    console.log("[PHOTO] response headers — content-type:", contentType, "| access-control-allow-origin:", corsHeader);

    if (!response.ok) {
      const errMsg = `[PHOTO] Image fetch failed: HTTP ${response.status} ${response.statusText} — ${message.url}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    if (!contentType.toLowerCase().startsWith("image/")) {
      const errMsg = `[PHOTO] proxy returned invalid Content-Type ${contentType} for ${message.url}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    console.log("[PHOTO] blob size:", uint8Array.length, "bytes —", Math.round(uint8Array.length / 1024), "KB");

    // Convert binary to base64 in safe chunks (avoids call-stack overflow on large images)
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    console.log("[PHOTO] returning base64 — length:", base64.length, "chars, type:", contentType);
    return { base64, type: contentType };
  },
};

// ── Version check on every service worker start ─────────────────────────────
// Runs before any message handler. If the stored version differs from the
// current manifest version, all stale local state is wiped and installedAt
// is reset so the popup never surfaces jobs from a previous install/session.
const STATE_KEYS_TO_CLEAR = [
  "activeJob", "lastClaimedJob", "lastPublishedJob",
  "lastError", "lastClaimAttempt", "lastClaimError",
  "lastNextResponse", "lastNextResponseAt", "connectTabId",
  "lastPollTime", "auditLog",
];

(async () => {
  const manifest = chrome.runtime.getManifest();
  const currentVersion = manifest.version;
  const { storedVersion } = await chrome.storage.local.get("storedVersion");
  if (storedVersion !== currentVersion) {
    await chrome.storage.local.remove(STATE_KEYS_TO_CLEAR);
    await chrome.storage.local.set({
      storedVersion: currentVersion,
      installedAt: new Date().toISOString(),
    });
    console.log(`[DealerPilot AI] Version ${storedVersion ?? "none"} → ${currentVersion}: state cleared, installedAt reset`);
  }

  // ── One-time URL migration: old Replit default → Render ──────────────────
  // Dealers who installed before Render was the default may have the old
  // Replit URL stored. Upgrade it silently on first startup after this change.
  // The `replitUrlMigrated` flag prevents re-running if the dealer later
  // deliberately re-points to Replit via the popup.
  const { backendUrl: storedUrl, replitUrlMigrated } = await chrome.storage.local.get([
    "backendUrl",
    "replitUrlMigrated",
  ]);
  if (!replitUrlMigrated) {
    if (storedUrl === REPLIT_BACKEND_URL) {
      await chrome.storage.local.set({ backendUrl: DEFAULT_BACKEND_URL });
      console.log(`[DealerPilot AI] URL migration: Replit default → Render (${DEFAULT_BACKEND_URL})`);
    }
    await chrome.storage.local.set({ replitUrlMigrated: true });
  }
})();

// ── Immediate poll on browser startup ────────────────────────────────────────
// The alarm persists across service worker restarts, but the first tick after
// browser launch may be up to 60 s away.  Polling immediately on startup
// ensures any pending publish_now job is claimed without the full alarm delay.
chrome.runtime.onStartup.addListener(() => {
  handlers.POLL_ASSIGNED_JOB().catch((err) => saveLastError(err));
});

// ---- App-controlled polling alarm ----
chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.alarms.create("pollAssigned", { periodInMinutes: 0.25 });
  // Clear all stale state on fresh install or update
  await chrome.storage.local.remove(STATE_KEYS_TO_CLEAR);
  const manifest = chrome.runtime.getManifest();
  await chrome.storage.local.set({
    installedAt: new Date().toISOString(),
    storedVersion: manifest.version,
  });
  console.log(`[DealerPilot AI] onInstalled (${details.reason}): state cleared, installedAt set`);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "pollAssigned") return;
  handlers.POLL_ASSIGNED_JOB().catch((err) => saveLastError(err));
});

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
      saveLastError(err);
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
