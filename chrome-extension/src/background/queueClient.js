const DEFAULT_BACKEND_URL = "https://app.1987dealerpilot.com";
const LEGACY_RENDER_BACKEND_URL = "https://dealerpilot-cq3x.onrender.com";
const REPLIT_BACKEND_URL = "https://dealerpilot1987.replit.app";

const MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/vehicle";
const FACEBOOK_LOGIN_URL =
  "https://www.facebook.com/login/?next=%2Fmarketplace%2Fcreate%2Fvehicle";

async function getBackendUrl() {
  return DealerPilotApiClient.getBackendUrl();
}

// ---- Environment detection ----
// Classifies the active backendUrl so the popup can clearly show whether the
// extension is pointed at Render, Replit, or a local dev server before a
// live publish test.
function detectEnvironment(url) {
  if (!url) return "Unknown";
  if (/1987dealerpilot\.com/i.test(url)) return "Production";
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
  return DealerPilotApiClient.apiGet(path);
}

async function apiPost(path, body) {
  return DealerPilotApiClient.apiPost(path, body);
}

function findMissingMarketplaceFields(payload) {
  const fill = payload?.fill || {};
  const missing = [];
  const required = [
    ["year", fill.year], ["make", fill.make], ["model", fill.model],
    ["mileage", fill.mileage], ["body style", fill.bodyStyle],
    ["exterior color", fill.exteriorColor], ["fuel type", fill.fuelType],
    ["transmission", fill.transmission], ["location", fill.location],
    ["description", fill.description],
  ];
  for (const [label, value] of required) {
    if (value === null || value === undefined || String(value).trim() === "") missing.push(label);
  }
  if (!Number.isFinite(Number(fill.price)) || Number(fill.price) <= 0) missing.push("price");
  if (!Array.isArray(payload?.images) || payload.images.filter(Boolean).length === 0) missing.push("photos");
  return missing;
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

async function getDealerId() {
  const stored = await chrome.storage.local.get("dealerId");
  const value = Number(stored.dealerId);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function getQueueDecision(job, extra = {}) {
  const nowMs = Date.now();
  const scheduledMs = job?.scheduledAt ? new Date(job.scheduledAt).getTime() : null;
  const eligibleNow = scheduledMs == null || (Number.isFinite(scheduledMs) && scheduledMs <= nowMs);
  return {
    at: new Date(nowMs).toISOString(),
    jobId: job?.id ?? null,
    vehicleId: job?.vehicleId ?? null,
    vehicleLabel: job?.vehicleLabel ?? null,
    status: job?.status ?? null,
    mode: job?.mode ?? null,
    source: job?.source ?? null,
    approvedByUser: job?.approvedByUser ?? null,
    scheduledAt: job?.scheduledAt ?? null,
    eligibleNow,
    secondsUntilEligible: eligibleNow || scheduledMs == null
      ? 0
      : Math.max(0, Math.ceil((scheduledMs - nowMs) / 1000)),
    ...extra,
  };
}

async function recordQueueDecision(event, job, extra = {}) {
  const decision = getQueueDecision(job, { event, ...extra });
  console.log("[DealerPilot AI] [QUEUE]", JSON.stringify(decision));
  try {
    await chrome.storage.local.set({ lastQueueDecision: decision });
  } catch (_) { /* non-critical */ }
  return decision;
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

function detectFacebookTabStateFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    const isFacebook =
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "web.facebook.com";
    if (!isFacebook) return null;

    const isLoginPage =
      /^\/(login(\.php)?|checkpoint|recover|two_step_verification|privacy\/consent)/.test(path) ||
      parsed.search.includes("reauth=1") ||
      (parsed.search.includes("next=") && path === "/login.php");

    const marketplaceDetected = path.includes("/marketplace");

    return {
      fbLoggedIn: !isLoginPage,
      marketplaceConnected: marketplaceDetected && !isLoginPage,
      marketplaceDetected,
      marketplacePath: marketplaceDetected ? path : null,
      marketplaceUrl: marketplaceDetected ? url : null,
    };
  } catch (_err) {
    return null;
  }
}

const FACEBOOK_PAGE_STATE_TTL_MS = 2 * 60 * 1000;

function aggregateFacebookPageStates(pageStates, nowMs = Date.now()) {
  const freshEntries = Object.entries(pageStates || {}).filter(([, state]) => {
    const reportedAtMs = Date.parse(state?.reportedAt || "");
    return Number.isFinite(reportedAtMs) && nowMs - reportedAtMs <= FACEBOOK_PAGE_STATE_TTL_MS;
  });
  const freshStates = freshEntries.map(([, state]) => state);
  const marketplaceState = freshStates.find((state) => state.marketplaceDetected === true) || null;
  return {
    pageStates: Object.fromEntries(freshEntries),
    patch: {
      fbLoggedIn: freshStates.length > 0 ? freshStates.some((state) => state.fbLoggedIn === true) : null,
      marketplaceConnected: freshStates.some((state) => state.marketplaceConnected === true),
      marketplaceDetected: freshStates.some((state) => state.marketplaceDetected === true),
      marketplacePath: marketplaceState?.marketplacePath || null,
      marketplaceUrl: marketplaceState?.marketplaceUrl || null,
      marketplaceDetectedAt: marketplaceState?.marketplaceDetectedAt || null,
    },
  };
}

async function saveFacebookPageState(tabId, state, tabUrl) {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    return { ok: false, reason: "sender_tab_missing" };
  }
  const { facebookPageStates = {} } = await chrome.storage.local.get("facebookPageStates");
  const reportedAt = new Date().toISOString();
  facebookPageStates[String(tabId)] = {
    fbLoggedIn: state?.fbLoggedIn === true,
    marketplaceConnected: state?.marketplaceConnected === true,
    marketplaceDetected: state?.marketplaceDetected === true,
    marketplacePath: state?.marketplacePath || null,
    marketplaceUrl: state?.marketplaceUrl || tabUrl || null,
    marketplaceDetectedAt: state?.marketplaceDetectedAt || null,
    reportedAt,
  };
  const aggregate = aggregateFacebookPageStates(facebookPageStates);
  await chrome.storage.local.set({
    facebookPageStates: aggregate.pageStates,
    ...aggregate.patch,
  });
  return { ok: true, ...aggregate.patch };
}

async function removeFacebookPageState(tabId) {
  const { facebookPageStates = {} } = await chrome.storage.local.get("facebookPageStates");
  delete facebookPageStates[String(tabId)];
  const aggregate = aggregateFacebookPageStates(facebookPageStates);
  await chrome.storage.local.set({
    facebookPageStates: aggregate.pageStates,
    ...aggregate.patch,
  });
}

async function detectFacebookTabState() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://www.facebook.com/*",
        "https://web.facebook.com/*",
        "https://facebook.com/*",
      ],
    });
    let best = null;
    for (const tab of tabs) {
      const state = detectFacebookTabStateFromUrl(tab.url || "");
      if (!state) continue;
      if (!best || state.marketplaceConnected || (!best.marketplaceConnected && state.marketplaceDetected)) {
        best = state;
      }
      if (state.marketplaceConnected) break;
    }
    if (!best) return {};

    const now = new Date().toISOString();
    const patch = {
      fbLoggedIn: best.fbLoggedIn,
      marketplaceConnected: best.marketplaceConnected,
      marketplaceDetected: best.marketplaceDetected,
      marketplacePath: best.marketplacePath,
      marketplaceUrl: best.marketplaceUrl,
      marketplaceDetectedAt: best.marketplaceDetected ? now : null,
    };
    await chrome.storage.local.set(patch);
    return patch;
  } catch (err) {
    console.warn("[DealerPilot AI] Facebook tab state detection failed", err);
    return {};
  }
}

async function closeMarketplaceTabs(sender, message = {}) {
  const ids = new Set();
  const senderTabId = sender?.tab?.id;
  if (senderTabId) ids.add(senderTabId);

  const requestedTabId = Number(message.tabId);
  if (Number.isFinite(requestedTabId) && requestedTabId > 0) ids.add(requestedTabId);

  // Only close the tab that explicitly requested cleanup. A broad Marketplace
  // sweep could close a user's existing listing, promotion, or seller tab.
  // Duplicate candidates are resolved by the content flow before completion;
  // unrelated tabs must never be treated as extension-owned.

  const closed = [];
  for (const id of ids) {
    try {
      await chrome.tabs.remove(id);
      closed.push(id);
    } catch (err) {
      console.warn("[DealerPilot AI] Could not close Marketplace tab:", id, err);
    }
  }

  return { ok: true, closed: closed.length > 0, tabIds: closed };
}

async function sendHeartbeatSnapshot() {
  const base = await getBackendUrl();
  const detected = await detectFacebookTabState();
  const { fbLoggedIn, marketplaceConnected } = await chrome.storage.local.get([
    "fbLoggedIn",
    "marketplaceConnected",
  ]);
  const resolvedFbLoggedIn = detected.fbLoggedIn ?? fbLoggedIn ?? null;
  const resolvedMarketplaceConnected =
    detected.marketplaceConnected ?? marketplaceConnected ?? null;
  const now = new Date().toISOString();
  const heartbeatUrl = `${base}/api/extension/heartbeat`;

  try {
    const data = await DealerPilotApiClient.sendHeartbeat({
      backendUrl: base,
      status: "online",
      chromeExtensionId: chrome.runtime.id,
      fbLoggedIn: resolvedFbLoggedIn,
      marketplaceConnected: resolvedMarketplaceConnected,
    });
    await chrome.storage.local.set({
      lastHeartbeat: now,
      lastHeartbeatUrl: heartbeatUrl,
      lastHeartbeatResponse: { ok: true, status: 200, body: data, at: now },
    });
    return { backendUrl: base, environment: detectEnvironment(base), ok: true };
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
    return { backendUrl: base, environment: detectEnvironment(base), ok: false };
  }
}

// ---- Message handlers ----

const handlers = {
  async PING() {
    await apiGet("/api/healthz");
    const heartbeat = await sendHeartbeatSnapshot();
    return { backendUrl: heartbeat.backendUrl, environment: heartbeat.environment };
  },

  async PAGE_STATE_REPORT(message, sender) {
    return saveFacebookPageState(sender?.tab?.id, message?.state, sender?.tab?.url);
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

  // ---- Publishing queue ----
  async GET_NEXT_JOB() {
    return apiGet("/api/publishing/jobs/next");
  },

  async CLAIM_JOB(message) {
    const extensionId = await getExtensionId();
    const job = await DealerPilotApiClient.claimPublishingJob(message.jobId, extensionId);
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
    const result = await DealerPilotApiClient.completePublishingJob(message.jobId, body);
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

  async MARK_NEEDS_REVIEW(message) {
    return apiPost(`/api/publishing/jobs/${message.jobId}/needs-review`, {
      reason: message.reason || "Required Marketplace data is incomplete",
    });
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
    const extensionId = chrome.runtime.id || await getExtensionId();
    return apiGet(`/api/publishing/jobs/assigned?extensionId=${encodeURIComponent(extensionId)}`);
  },

  async AUTO_START_ASSIGNED(message) {
    const extensionId = await getExtensionId();
    const now = new Date().toISOString();

    // ── SAFETY GUARD 1: Job age ──────────────────────────────────────────────
    // Reject jobs older than 10 minutes. Stale queued jobs must not auto-open
    // Facebook — the user must explicitly trigger them from the popup.
    const JOB_MAX_AGE_MS = 10 * 60 * 1000;
    const isAutomaticBatch = message.source === "auto_publish_batch";
    if (message.createdAt && !isAutomaticBatch) {
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

    if (message.scheduledAt) {
      const scheduledMs = new Date(message.scheduledAt).getTime();
      const waitMs = scheduledMs - Date.now();
      if (Number.isFinite(waitMs) && waitMs > 1000) {
        const remainingSec = Math.ceil(waitMs / 1000);
        await chrome.storage.local.set({
          queueCooldownUntil: new Date(scheduledMs).toISOString(),
          queueCooldownRemainingS: remainingSec,
          lastPollSkipReason: "scheduled_at_wait",
          lastSkippedJobId: message.jobId,
          lastSkippedAt: new Date().toISOString(),
        });
        return { skipped: true, reason: "scheduled_at_wait", cooldownRemainingS: remainingSec };
      }
    }

    // Preflight before claiming/opening Facebook. Incomplete vehicles must not
    // become orphaned in Publishing if the service worker restarts mid-claim.
    let payload;
    try {
      payload = await apiGet(`/api/publishing/jobs/${message.jobId}/payload`);
    } catch (err) {
      const reason = `Marketplace preflight could not load vehicle data: ${err instanceof Error ? err.message : String(err)}`;
      await apiPost(`/api/publishing/jobs/${message.jobId}/needs-review`, { reason });
      await chrome.storage.local.remove("activeJob");
      await logAudit("AUTO_START_SKIPPED_PREFLIGHT", { jobId: message.jobId, reason });
      return handlers.POLL_ASSIGNED_JOB();
    }

    const missingFields = findMissingMarketplaceFields(payload);
    if (missingFields.length > 0) {
      const reason = `Missing required Marketplace data: ${missingFields.join(", ")}`;
      await apiPost(`/api/publishing/jobs/${message.jobId}/needs-review`, { reason });
      await chrome.storage.local.remove("activeJob");
      await logAudit("AUTO_START_SKIPPED_INCOMPLETE", {
        jobId: message.jobId,
        vehicleId: payload?.vehicleId || null,
        missingFields,
        reason,
      });
      return handlers.POLL_ASSIGNED_JOB();
    }

    // Record that we are attempting to claim this job only after preflight passes.
    await chrome.storage.local.set({
      lastClaimAttempt: { jobId: message.jobId, at: now },
    });

    let job;
    try {
      job = await DealerPilotApiClient.claimPublishingJob(message.jobId, extensionId);
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

    const { pendingRetry } = await chrome.storage.local.get("pendingRetry");
    const retryCount = Number(pendingRetry?.jobId) === Number(job.id)
      ? Number(pendingRetry.retryCount || 0)
      : 0;
    await chrome.storage.local.set({
      activeJob: { ...job, _retryCount: retryCount, _prefetchedPayload: payload },
    });
    if (retryCount > 0) await chrome.storage.local.remove("pendingRetry");

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
      // Always reset the existing create form for the newly claimed job. Merely
      // focusing the tab can retain validation errors and values from the job
      // that was just moved to Needs Review.
      tab = await chrome.tabs.update(existing.id, {
        url: MARKETPLACE_CREATE_URL,
        active: true,
      });
      await chrome.windows.update(existing.windowId, { focused: true });
      await logAudit("MARKETPLACE_FORM_RELOADED_FOR_JOB", {
        jobId: job.id,
        vehicleId: job.vehicleId || null,
        tabId: existing.id,
      });
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
      await DealerPilotApiClient.sendSessionReport({
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
        const terminal = ["Published", "Failed", "Cancelled", "Needs Review"];
        if (terminal.includes(progress.status)) {
          await recordQueueDecision("ACTIVE_JOB_CLEARED_TERMINAL", activeJob, {
            backendStatus: progress.status,
            decision: "continue_queue",
          });
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
    await sendHeartbeatSnapshot();

    const extensionId = chrome.runtime.id || await getExtensionId();

    // Check for a job explicitly assigned to this extension
    let data;
    try {
      data = await apiGet(`/api/publishing/jobs/assigned?extensionId=${encodeURIComponent(extensionId)}`);
    } catch {
      return { job: null };
    }
    const assignedJob = data && data.job && data.job.id ? data.job : null;
    if (assignedJob) {
      await recordQueueDecision("QUEUE_ASSIGNED_OBSERVED", assignedJob, {
        decision: "auto_start_assigned",
        endpoint: "/api/publishing/jobs/assigned",
      });
      return handlers.AUTO_START_ASSIGNED({
        jobId: assignedJob.id,
        createdAt: assignedJob.assignedAt || assignedJob.createdAt || null,
        mode: assignedJob.mode || "Controlled",
        source: assignedJob.source || "assigned",
        scheduledAt: assignedJob.scheduledAt || null,
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
    await recordQueueDecision(
      nextJob ? "QUEUE_NEXT_OBSERVED" : "QUEUE_NEXT_EMPTY",
      nextJob,
      {
        decision: nextJob ? "evaluate" : "no_claimable_job",
        endpoint: "/api/publishing/jobs/next",
      },
    );
    if (!nextJob) {
      try {
        const soldData = await apiGet("/api/extension/marketplace-sold-actions");
        const action = Array.isArray(soldData?.actions) ? soldData.actions[0] : null;
        if (action?.listingUrl) {
          const { lastSoldActionOpenedId } = await chrome.storage.local.get("lastSoldActionOpenedId");
          if (lastSoldActionOpenedId !== action.listingId) {
            await chrome.storage.local.set({
              activeSoldAction: action,
              lastSoldActionOpenedId: action.listingId,
              lastSoldActionOpenedAt: new Date().toISOString(),
            });
            await logAudit("MARKETPLACE_SOLD_ACTION_OPENED", {
              listingId: action.listingId,
              vehicleId: action.vehicleId,
              vehicleLabel: action.label || null,
              url: action.listingUrl,
              source: "dealerpilot_sold_feedback",
            });
            const tab = await chrome.tabs.create({ url: action.listingUrl, active: true });
            return { ok: true, soldAction: true, listingId: action.listingId, tabId: tab.id };
          }
        }
      } catch (err) {
        console.warn("[DealerPilot AI] sold action poll failed", err);
      }

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
        const scheduledMs = nextJob.scheduledAt ? new Date(nextJob.scheduledAt).getTime() : 0;
        const cooldownEnd = Math.max(finishedMs + INTER_JOB_DELAY_MS, Number.isFinite(scheduledMs) ? scheduledMs : 0);
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
      scheduledAt: nextJob.scheduledAt || null,
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

  async CLOSE_CURRENT_TAB(message = {}, sender) {
    return closeMarketplaceTabs(sender, message);
  },

  async CLOSE_MARKETPLACE_TABS(message = {}, sender) {
    return closeMarketplaceTabs(sender, message);
  },

  // ---- Job validation ----
  // Called by content.js before running the publishing flow to confirm the
  // activeJob is still active on the backend (not stale/terminal/cancelled).
  async VALIDATE_JOB(message) {
    return apiGet(`/api/publishing/jobs/${message.jobId}/progress`);
  },

  async RESTORE_ACTIVE_JOB() {
    const extensionId = await getExtensionId();
    const data = await apiGet("/api/publishing/jobs");
    const activeStatuses = new Set([
      "Publishing",
      "Opening Facebook",
      "Filling Form",
      "Auto Publishing",
      "Downloading Photos",
      "Uploading Photos",
      "Waiting For Thumbnails",
      "Ready for Review",
    ]);
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const job = jobs
      .filter((candidate) =>
        activeStatuses.has(candidate.status) &&
        candidate.claimedByExtension === extensionId,
      )
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];

    if (!job) return { job: null };

    await chrome.storage.local.set({
      activeJob: job,
      lastClaimedJob: {
        id: job.id,
        title: job.listingTitle || job.vehicleLabel || `Job #${job.id}`,
        claimedAt: new Date().toISOString(),
        restoredAt: new Date().toISOString(),
      },
    });
    await logAudit("ACTIVE_JOB_RESTORED", { jobId: job.id, extensionId });
    return { job };
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
      "activeJob", "pendingRetry", "lastClaimedJob", "lastPublishedJob",
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
    const dealerId = await getDealerId();
    const manifest = chrome.runtime.getManifest();
    return {
      version: manifest.version,
      extensionId: stored.extensionId || null,
      backendUrl: base,
      environment: detectEnvironment(base),
      dealerId,
      dealerName: dealerId === 1 ? "Alpha Motorsport" : `Dealer ${dealerId}`,
      lastHeartbeat: stored.lastHeartbeat || null,
      lastHeartbeatUrl: stored.lastHeartbeatUrl || null,
      lastHeartbeatResponse: stored.lastHeartbeatResponse || null,
      lastPayloadDebug: stored.lastPayloadDebug || null,
      lastClaimedJob: stored.lastClaimedJob || null,
      lastPublishedJob: stored.lastPublishedJob || null,
      lastError: stored.lastError || null,
      marketplaceDetected: stored.marketplaceDetected || false,
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

  // ---- Photo proxy: fetch a job photo through our backend proxy ----
  // Constructs the backend proxy URL and delegates to FETCH_IMAGE_AS_BASE64.
  // The extension NEVER contacts CDN/dealer image hosts directly — only our backend.
  async FETCH_JOB_PHOTO(message) {
    const { jobId, index } = message;
    const base = await getBackendUrl();
    const proxyUrl = `${base}/api/publishing/jobs/${jobId}/photo/${index}`;
    console.log(`[PHOTO] proxy fetch — job ${jobId} photo ${index} — ${proxyUrl}`);
    return DealerPilotPhotoProxy.fetchImageAsBase64(proxyUrl);
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
  "activeJob", "pendingRetry", "lastClaimedJob", "lastPublishedJob",
  "lastError", "lastClaimAttempt", "lastClaimError",
  "lastNextResponse", "lastNextResponseAt", "connectTabId",
  "lastPollTime", "auditLog", "facebookPageStates",
  "marketplaceDetected", "marketplacePath", "marketplaceUrl",
  "marketplaceDetectedAt",
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
  const { backendUrl: storedUrl, replitUrlMigrated, publicDomainUrlMigrated } = await chrome.storage.local.get([
    "backendUrl",
    "replitUrlMigrated",
    "publicDomainUrlMigrated",
  ]);
  if (!replitUrlMigrated) {
    if (storedUrl === REPLIT_BACKEND_URL) {
      await chrome.storage.local.set({ backendUrl: DEFAULT_BACKEND_URL });
      console.log(`[DealerPilot AI] URL migration: Replit default → Render (${DEFAULT_BACKEND_URL})`);
    }
    await chrome.storage.local.set({ replitUrlMigrated: true });
  }
  if (!publicDomainUrlMigrated) {
    if (!storedUrl || storedUrl === LEGACY_RENDER_BACKEND_URL) {
      await chrome.storage.local.set({ backendUrl: DEFAULT_BACKEND_URL });
      console.log(`[DealerPilot AI] URL migration: legacy Render -> Production (${DEFAULT_BACKEND_URL})`);
    }
    await chrome.storage.local.set({ publicDomainUrlMigrated: true });
  }
})();

// ── Immediate poll on browser startup ────────────────────────────────────────
// The alarm persists across service worker restarts, but the first tick after
// browser launch may be up to 60 s away.  Polling immediately on startup
// ensures any pending publish_now job is claimed without the full alarm delay.
// Chrome may clear extension alarms after a browser restart. Recreate the
// polling alarm whenever the service worker starts so scheduled batch jobs do
// not depend on the popup being opened again.
async function ensurePollAssignedAlarm() {
  const alarm = await chrome.alarms.get("pollAssigned");
  if (!alarm) {
    chrome.alarms.create("pollAssigned", { periodInMinutes: 0.25 });
  }
}

ensurePollAssignedAlarm().catch((err) => saveLastError(err));

chrome.runtime.onStartup.addListener(() => {
  ensurePollAssignedAlarm()
    .then(() => handlers.POLL_ASSIGNED_JOB())
    .catch((err) => saveLastError(err));
});

// ---- App-controlled polling alarm ----
chrome.runtime.onInstalled.addListener(async (details) => {
  await ensurePollAssignedAlarm();
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

chrome.tabs.onRemoved?.addListener((tabId) => {
  removeFacebookPageState(tabId).catch((err) =>
    console.warn("[DealerPilot AI] Failed to remove closed Facebook tab state", err),
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      const handler = handlers[message.type];
      if (!handler) {
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        return;
      }
      const data = await handler(message, _sender);
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
