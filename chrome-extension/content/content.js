(function () {
  if (window.__marketplaceAiPanelLoaded) return;
  window.__marketplaceAiPanelLoaded = true;

  const log = (...args) => console.log("[DealerPilot AI]", ...args);

  // ---- Workflow step instrumentation ----
  function stateLog(msg) {
    console.log(`[DealerPilot AI][STATE] ${msg}`);
    chrome.storage.local
      .set({ workflowStep: msg, workflowStepAt: new Date().toISOString() })
      .catch(() => { });
  }

  function stateError(context, err) {
    const detail = err ? `: ${err.message || String(err)}` : "";
    console.error(`[DealerPilot AI][ERROR] ${context}${detail}`, err || "");
    chrome.storage.local
      .set({ workflowStep: `\u274C ${context}`, workflowStepAt: new Date().toISOString() })
      .catch(() => { });
  }

  // ---- Safe runtime communication ----
  const CTXI = "EXTENSION_CONTEXT_INVALIDATED";
  const EXT_VERSION = chrome.runtime.getManifest().version;
  const BUILD_LABEL = `APP_CONTROLLED_PUBLISHING_${EXT_VERSION}`;

  // ── Performance / fast-mode settings ────────────────────────────────────────
  // MARKETPLACE_FAST_MODE=true fills the 10 required fields:
  //   photos → vehicle type → year → make → model → mileage → price →
  //   title → description → location
  // Condition and all other optional fields are skipped in fast mode.
  // Target: one vehicle published in 90 s – 3 min.
  const MARKETPLACE_FAST_MODE = true;

  const BUDGET = {
    THUMBNAIL_WAIT_MS: 20_000,       // stop polling thumbnails after 20 s
    COMBOBOX_WAIT_MS: 5_000,       // max time to find year / make / model combobox
    COMBOBOX_OPTIONS_MS: 8_000,       // max time for option list to appear
    TOTAL_JOB_MS: 4 * 60_000,   // 4-minute hard cap on the full job
  };

  // ── Per-job photo cache ───────────────────────────────────────────────────
  // Keyed by "${jobId}-${index}" → { base64, type }
  // Survives multiple uploadPhotos calls within the same page load.
  const _photoCache = new Map();

  // Set to true once waitForPhotoThumbnails confirms at least one thumbnail.
  // validateBeforeNext skips its own photo re-scan when this is already true,
  // preventing false "0 photos" failures when photos are clearly visible.
  let _photosConfirmed = false;

  function _runtimeAlive() {
    try {
      const id = (typeof chrome !== "undefined") && chrome.runtime && chrome.runtime.id;
      return !!id;
    } catch (_) {
      return false;
    }
  }

  function showContextInvalidated() {
    try {
      setStatus(
        "DealerPilot extension was updated. Please fully refresh this Facebook tab and try again.",
        "err",
      );
    } catch (_) { }
    try {
      if (!document.getElementById("mai-ctx-banner")) {
        const b = document.createElement("div");
        b.id = "mai-ctx-banner";
        b.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
          "background:#c0392b;color:#fff;font:bold 13px/42px sans-serif;" +
          "text-align:center;padding:0 16px;letter-spacing:.01em;box-shadow:0 2px 8px rgba(0,0,0,.4);";
        b.textContent =
          "⚠ DealerPilot extension was updated — fully refresh this Facebook tab to continue.";
        document.documentElement.appendChild(b);
      }
    } catch (_) { }
  }

  function send(message) {
    if (!_runtimeAlive()) {
      showContextInvalidated();
      return Promise.resolve({ ok: false, error: CTXI });
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            const msg = lastErr.message || "";
            if (msg.toLowerCase().includes("context invalidated")) {
              showContextInvalidated();
              resolve({ ok: false, error: CTXI });
            } else {
              resolve({ ok: false, error: msg });
            }
            return;
          }
          resolve(response);
        });
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (msg.toLowerCase().includes("context invalidated")) {
          showContextInvalidated();
          resolve({ ok: false, error: CTXI });
        } else {
          resolve({ ok: false, error: msg });
        }
      }
    });
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelText(el) {
    const parts = [
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      el.getAttribute("name"),
    ];
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) parts.push(lbl.textContent);
    }
    const wrapLabel = el.closest("label");
    if (wrapLabel) parts.push(wrapLabel.textContent);
    return normalizeText(parts.filter(Boolean).join(" "));
  }

  function findField(keywords) {
    const fields = Array.from(
      document.querySelectorAll(
        'input[type="text"], input:not([type]), input[type="number"], textarea',
      ),
    ).filter((el) => el.offsetParent !== null);
    const normalizedKeywords = keywords.map(normalizeText);
    for (const kw of normalizedKeywords) {
      const match = fields.find((el) => labelText(el).includes(kw));
      if (match) return match;
    }
    return null;
  }

  function waitForField(keywords, maxWaitMs = 5000) {
    return new Promise((resolve) => {
      const interval = 300;
      let elapsed = 0;
      const tick = () => {
        const field = findField(keywords);
        if (field) { resolve(field); return; }
        elapsed += interval;
        if (elapsed > 900 && elapsed % 900 === 0) nudgeMarketplaceFormScroll();
        if (elapsed >= maxWaitMs) { resolve(null); return; }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  // ---- Select-field helpers (Facebook progressive dropdowns) ----

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function waitForReactRender(ms) { return sleep(ms === undefined ? 900 : ms); }

  function nudgeMarketplaceFormScroll() {
    const candidates = [
      document.scrollingElement,
      ...Array.from(document.querySelectorAll("div")).filter((el) => {
        const style = window.getComputedStyle(el);
        const canScroll = /(auto|scroll)/.test(style.overflowY || "");
        return canScroll && el.scrollHeight > el.clientHeight + 80;
      }),
    ].filter(Boolean);

    const target = candidates.find((el) => {
      const text = normalizeText(el.innerText || el.textContent || "");
      return text.includes("vehiculo en venta") || text.includes("vehicle for sale") || text.includes("marketplace");
    }) || document.scrollingElement;

    if (!target) return;
    target.scrollBy?.({ top: 360, behavior: "auto" });
    if (!target.scrollBy) target.scrollTop += 360;
  }

  // ---- ARIA combobox helpers ----

  function findCombobox(keywords) {
    const boxes = Array.from(document.querySelectorAll('[role="combobox"]'))
      .filter((el) => el.offsetParent !== null);
    const normalizedKeywords = keywords.map(normalizeText);
    for (const el of boxes) {
      const inner = normalizeText(el.innerText || el.textContent || "");
      const ariaLabel = normalizeText(el.getAttribute("aria-label") || "");
      const labelledBy = el.getAttribute("aria-labelledby");
      let labelTxt = "";
      if (labelledBy) {
        const lbEl = document.getElementById(labelledBy);
        if (lbEl) labelTxt = normalizeText(lbEl.innerText || lbEl.textContent || "");
      }
      const combined = `${inner} ${labelTxt} ${ariaLabel}`;
      if (normalizedKeywords.some((k) => combined.includes(k))) return el;
    }
    return null;
  }

  function waitForCombobox(keywords, maxWaitMs) {
    const limit = maxWaitMs === undefined ? 10000 : maxWaitMs;
    const kwStr = keywords.join("/");
    return new Promise((resolve) => {
      const interval = 300;
      let elapsed = 0;
      const tick = () => {
        const el = findCombobox(keywords);
        if (el) {
          console.log(`[WAIT] combobox(${kwStr}) FOUND at ${elapsed}ms`);
          resolve(el);
          return;
        }
        console.log(`[WAIT] combobox(${kwStr}) not in DOM — ${elapsed}ms / ${limit}ms`);
        elapsed += interval;
        if (elapsed > 900 && elapsed % 900 === 0) nudgeMarketplaceFormScroll();
        if (elapsed >= limit) {
          console.log(`[TIMEOUT] combobox(${kwStr}) not found after ${limit}ms`);
          resolve(null);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function waitForOptions(maxWaitMs, stepLabel) {
    const limit = maxWaitMs === undefined ? 8000 : maxWaitMs;
    const tag = stepLabel || "options";
    return new Promise((resolve) => {
      const interval = 150;
      let elapsed = 0;
      const tick = () => {
        // Primary check: visible non-fixed elements
        let opts = Array.from(document.querySelectorAll('[role="option"]'))
          .filter((el) => el.offsetParent !== null);
        // Fallback: Facebook renders option lists in fixed-position portals where
        // offsetParent is always null — detect them via getBoundingClientRect instead.
        if (opts.length === 0) {
          opts = Array.from(document.querySelectorAll('[role="option"]')).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
        }
        if (opts.length > 0) {
          console.log(`[OPTIONS] ${tag}: ${opts.length} options found at ${elapsed}ms`);
          opts.forEach((o, i) => {
            const t = (o.innerText || o.textContent || "").trim();
            console.log(`  [${i}] "${t}"  HTML: ${o.outerHTML.slice(0, 200)}`);
          });
          resolve(opts);
          return;
        }
        console.log(`[WAIT] ${tag} options — not visible yet — ${elapsed}ms / ${limit}ms`);
        elapsed += interval;
        if (elapsed >= limit) {
          const popup =
            document.querySelector('[role="listbox"]') ||
            document.querySelector('[role="dialog"]') ||
            document.querySelector('[aria-modal="true"]');
          const popupHtml = popup
            ? popup.outerHTML.slice(0, 3000)
            : "(no popup container found in DOM)";
          console.log(`[TIMEOUT] ${tag} options — 0 found after ${limit}ms`);
          console.log(`[OPTIONS] Popup HTML dump:\n${popupHtml}`);
          resolve([]);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function waitForMoreComboboxes(countBefore, maxWaitMs) {
    const limit = maxWaitMs === undefined ? 6000 : maxWaitMs;
    return new Promise((resolve) => {
      const interval = 250;
      let elapsed = 0;
      const tick = () => {
        const count = document.querySelectorAll('[role="combobox"]').length;
        if (count > countBefore) {
          console.log(`[WAIT] combobox count: ${countBefore} → ${count} at ${elapsed}ms`);
          resolve(true);
          return;
        }
        console.log(`[WAIT] combobox count still ${count} (want > ${countBefore}) — ${elapsed}ms / ${limit}ms`);
        elapsed += interval;
        if (elapsed >= limit) {
          console.log(`[TIMEOUT] combobox count did not increase after ${limit}ms (stayed at ${count})`);
          resolve(false);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function waitForNamedCombobox(label, keywords, maxWaitMs) {
    const limit = maxWaitMs === undefined ? 20000 : maxWaitMs;
    const kwStr = keywords.join("/");
    return new Promise((resolve) => {
      const interval = 250;
      let elapsed = 0;
      const tick = () => {
        const el = findCombobox(keywords);
        if (el) {
          console.log(`[FOUND] "${label}" combobox (${kwStr}) appeared at ${elapsed}ms`);
          resolve(el);
          return;
        }
        console.log(`[WAIT] waiting for "${label}" combobox — ${elapsed}ms / ${limit}ms`);
        elapsed += interval;
        if (elapsed >= limit) {
          console.log(`[TIMEOUT] "${label}" combobox (${kwStr}) did not appear after ${limit}ms`);
          resolve(null);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function waitForNamedField(label, keywords, maxWaitMs) {
    const limit = maxWaitMs === undefined ? 20000 : maxWaitMs;
    return new Promise((resolve) => {
      const interval = 250;
      let elapsed = 0;
      const tick = () => {
        const el = findField(keywords);
        if (el) {
          console.log(`[FOUND] "${label}" field appeared at ${elapsed}ms`);
          resolve(el);
          return;
        }
        console.log(`[WAIT] waiting for "${label}" field — ${elapsed}ms / ${limit}ms`);
        elapsed += interval;
        if (elapsed > 750 && elapsed % 1000 === 0) nudgeMarketplaceFormScroll();
        if (elapsed >= limit) {
          console.log(`[TIMEOUT] "${label}" field did not appear after ${limit}ms`);
          resolve(null);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  // ---- Page detection (SPA-aware) ----

  function detectPageState() {
    const hostname = location.hostname;
    const pathname = location.pathname;
    const href = location.href;
    const now = new Date().toISOString();

    const isMarketplaceNow =
      hostname.includes("facebook.com") && pathname.includes("/marketplace");

    const isMessengerNow =
      hostname.includes("messenger.com") || /\/messages\b/.test(pathname);

    const isLoginPage =
      /^\/(login(\.php)?|checkpoint|recover|two_step_verification|privacy\/consent)/.test(pathname) ||
      location.search.includes("reauth=1") ||
      (location.search.includes("next=") && pathname === "/login.php");
    const fbLoggedIn = hostname.includes("facebook.com") && !isLoginPage;
    const isMarketplaceCreate = pathname.startsWith("/marketplace/create");
    const marketplaceConnected = isMarketplaceCreate && fbLoggedIn;

    chrome.storage.local
      .set({
        marketplaceDetected: isMarketplaceNow,
        marketplacePath: isMarketplaceNow ? pathname : null,
        marketplaceUrl: isMarketplaceNow ? href : null,
        marketplaceDetectedAt: now,
        messengerDetected: isMessengerNow,
        fbLoggedIn,
        marketplaceConnected,
      })
      .catch(() => { });

    if (hostname.includes("facebook.com")) {
      try {
        chrome.runtime.sendMessage({
          type: "FB_SESSION_REPORT",
          fbLoggedIn,
          marketplaceConnected,
        });
      } catch (_e) { }
    }

    log("Page state:", { isMarketplaceNow, isMessengerNow, fbLoggedIn, marketplaceConnected });
    return { isMarketplaceNow, isMessengerNow };
  }

  const _initial = detectPageState();
  [500, 1500, 3000].forEach((ms) => setTimeout(detectPageState, ms));

  (function patchHistory() {
    function wrap(origFn) {
      return function (...args) {
        const result = origFn.apply(this, args);
        setTimeout(detectPageState, 0);
        return result;
      };
    }
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
  })();
  window.addEventListener("popstate", detectPageState);

  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      detectPageState();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  const href = location.href;
  const isMessenger = _initial.isMessengerNow;
  const isMarketplaceCreate = /\/marketplace\/create/.test(location.pathname);

  // ---- Panel UI ----
  const panel = document.createElement("div");
  panel.id = "mai-panel";
  panel.innerHTML = `
    <div id="mai-header">
      <span id="mai-dot"></span>
      <span id="mai-title">DealerPilot AI</span>
      <span style="font-size:9px;opacity:.55;margin-left:4px;letter-spacing:.02em;">v${EXT_VERSION}</span>
      <button id="mai-toggle" title="Collapse">_</button>
    </div>
    <div id="mai-body">
      <div id="mai-status" class="mai-status">Checking connection…</div>
      <div id="mai-job-box"></div>
      <div id="mai-actions"></div>
      <div id="mai-output" class="mai-output" hidden></div>
    </div>
  `;
  document.documentElement.appendChild(panel);

  const statusEl = panel.querySelector("#mai-status");
  const actionsEl = panel.querySelector("#mai-actions");
  const outputEl = panel.querySelector("#mai-output");
  const jobBoxEl = panel.querySelector("#mai-job-box");
  const dotEl = panel.querySelector("#mai-dot");
  const bodyEl = panel.querySelector("#mai-body");

  panel.querySelector("#mai-toggle").addEventListener("click", () => {
    bodyEl.hidden = !bodyEl.hidden;
  });

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "mai-status" + (kind ? " mai-" + kind : "");
  }

  function showOutput(html) {
    outputEl.hidden = false;
    outputEl.innerHTML = html;
  }

  function clearOutput() {
    outputEl.hidden = true;
    outputEl.innerHTML = "";
  }

  function button(label, onClick, variant) {
    const b = document.createElement("button");
    b.className = "mai-btn" + (variant ? " " + variant : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Connection check ----
  send({ type: "PING" }).then((res) => {
    if (res && res.error === CTXI) return;
    if (res && res.ok) {
      dotEl.classList.add("mai-on");
      setStatus("Connected to DealerPilot", "ok");
    } else {
      dotEl.classList.add("mai-off");
      setStatus("Backend unreachable. Set the URL in the extension popup.", "err");
    }
  });

  // ---- Login page: show resume message if there is an active job ----
  // When Facebook is not logged in, AUTO_START_ASSIGNED opens the login URL.
  // After the user logs in, Facebook redirects to /marketplace/create and the
  // content script on that page auto-resumes the flow.  Show a helpful status
  // here so the operator knows publishing is waiting — not broken.
  const _isLoginPage = /\/(login|checkpoint|recover|two_step_verification)/.test(location.pathname)
    || (location.pathname === "/login.php")
    || location.search.includes("next=%2Fmarketplace");
  if (_isLoginPage) {
    chrome.storage.local.get("activeJob").then(({ activeJob }) => {
      if (activeJob && activeJob.id) {
        setStatus("Log in to continue — publishing will resume automatically.", "ok");
        jobBoxEl.innerHTML = `<div class="mai-job">
          <div class="mai-job-title">Job #${escapeHtml(String(activeJob.id))} waiting</div>
          <div class="mai-job-meta">Sign in to Facebook. DealerPilot will open Marketplace and continue publishing automatically after login.</div>
        </div>`;
      }
    }).catch(() => { });
  }

  // ---- Safety: stop on Facebook login / checkpoint / captcha ----
  function detectSecurityGate() {
    const url = location.href;
    if (/\/login|\/checkpoint|\/recover|\/two_step_verification|\/captcha/i.test(url)) {
      return "Facebook login or security checkpoint detected.";
    }
    const bodyText = (document.body.innerText || "").toLowerCase();
    const flags = [
      "log in to facebook",
      "log into facebook",
      "enter your password",
      "security check",
      "confirm your identity",
      "we need to confirm",
      "captcha",
      "suspicious activity",
    ];
    if (flags.some((f) => bodyText.includes(f))) {
      return "Facebook security/login screen detected.";
    }
    return null;
  }

  // ── waitForManualContinue ────────────────────────────────────────────────────
  // Shows a top-of-page banner and panel message asking the operator to complete
  // an action manually.  Resolves when the operator clicks "Continue →".
  function waitForManualContinue(message) {
    return new Promise((resolve) => {
      // Remove any previous banner
      const old = document.getElementById("mai-manual-action");
      if (old) old.remove();

      const banner = document.createElement("div");
      banner.id = "mai-manual-action";
      banner.style.cssText =
        "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:#c0392b;color:#fff;padding:12px 24px;border-radius:0 0 10px 10px;" +
        "font:bold 13px/1.6 sans-serif;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.45);" +
        "max-width:620px;";
      banner.innerHTML =
        '<div style="margin-bottom:10px;">⚠️ ' + message + "</div>" +
        '<button id="mai-manual-continue" style="' +
        "background:#27ae60;color:#fff;border:none;padding:9px 28px;" +
        'border-radius:5px;font:bold 13px sans-serif;cursor:pointer;">Continue →</button>';
      document.documentElement.appendChild(banner);

      showOutput(
        '<div style="color:#e74c3c;font-weight:700;margin-bottom:6px;">⚠️ Manual Action Required</div>' +
        '<div style="font-size:12px;line-height:1.5;margin-bottom:8px;">' + escapeHtml(message) + "</div>",
      );

      banner.querySelector("#mai-manual-continue").addEventListener("click", () => {
        banner.remove();
        stateLog("Manual action confirmed by operator");
        resolve();
      });
    });
  }

  // ── scanForAnyOptions ────────────────────────────────────────────────────────
  // Waits up to `waitMs` for any visible option-like elements to appear in the
  // DOM, checking multiple roles / element types Facebook has used across UI
  // versions.  Returns the array (possibly empty).
  async function scanForAnyOptions(waitMs, tag) {
    const limit = waitMs ?? 8000;
    const label = tag || "options";
    const start = Date.now();
    while (Date.now() - start < limit) {
      // 1. role=option (standard, may be in a fixed portal)
      let opts = Array.from(document.querySelectorAll('[role="option"]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (opts.length) { console.log(`[VT] ${label}: ${opts.length} [role="option"]`); return opts; }

      // 2. role=menuitem
      opts = Array.from(document.querySelectorAll('[role="menuitem"]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (opts.length) { console.log(`[VT] ${label}: ${opts.length} [role="menuitem"]`); return opts; }

      // 3. li / data-value inside any listbox / dialog
      const popup =
        document.querySelector('[role="listbox"]') ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.querySelector('[aria-modal="true"]');
      if (popup) {
        opts = Array.from(popup.querySelectorAll('li, [data-value], [role="listitem"]')).filter(
          (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          },
        );
        if (opts.length) { console.log(`[VT] ${label}: ${opts.length} li/data-value in popup`); return opts; }
      }

      await sleep(200);
    }
    console.log(`[VT] ${label}: no options found after ${limit}ms`);
    return [];
  }

  // =====================================================================
  // Publishing-queue flow on the Marketplace create page.
  // =====================================================================
  async function runPublishingFlow(job) {
    const securityIssue = detectSecurityGate();
    if (securityIssue) {
      jobBoxEl.innerHTML = `<div class="mai-banner"><strong>Stopped for safety.</strong> ${escapeHtml(
        securityIssue,
      )} Log in / clear the check manually, then reopen this job. Nothing was filled and Publish was not touched.</div>`;
      setStatus("Paused: complete the Facebook security step manually.", "err");
      log("Security gate detected; aborting fill", securityIssue);
      return;
    }

    // ── Performance budget tracking ──────────────────────────────────────────
    const _jobStartMs = Date.now();
    function elapsed() { return Math.round((Date.now() - _jobStartMs) / 1000); }
    function checkBudget(label) {
      if (Date.now() - _jobStartMs > BUDGET.TOTAL_JOB_MS) {
        throw new Error(`Job exceeded 4-minute budget at step "${label}" (${elapsed()}s elapsed)`);
      }
    }

    jobBoxEl.innerHTML = `
      <div class="mai-job">
        <div class="mai-job-title">${escapeHtml(job.listingTitle || "Publishing job")}</div>
        <div class="mai-job-meta">${escapeHtml(job.vehicleLabel || "")}${job.dealerName ? " · " + escapeHtml(job.dealerName) : ""
      } · Job #${escapeHtml(String(job.id))}</div>
      </div>`;

    let fill, images;
    if (job._prefetchedPayload) {
      fill = job._prefetchedPayload.fill;
      images = job._prefetchedPayload.images ?? [];
    } else {
      setStatus("Loading listing data…");
      const res = await send({ type: "GET_JOB_PAYLOAD", jobId: job.id });
      if (!res || !res.ok) {
        if (res?.error === CTXI) return;
        const is404 = res && typeof res.error === "string" && res.error.includes("404");
        if (is404) {
          await chrome.storage.local.remove(["activeJob", "lastClaimedJob"]);
          setStatus("Job #" + job.id + " no longer exists — queue was cleared. Reopen the extension popup to start a new job.", "err");
        } else {
          setStatus("Could not load job data: " + (res && res.error), "err");
        }
        return;
      }
      fill = res.data.fill;
      images = res.data.images;

      // Adopt the server-healed mode + new debug fields (v1.3.13). job.mode may
      // be stale ("Assisted") on the queue/claim object; the payload endpoint
      // always re-derives it from live env vars and heals the DB row, so trust
      // res.data over the job we were handed.
      if (res.data.job && res.data.job.mode) job.mode = res.data.job.mode;
      job.autoClickPublish = res.data.autoClickPublish === true;
      job.publishMode = res.data.publishMode;
      job.backendEnvironment = res.data.backendEnvironment;
      send({
        type: "STORE_PAYLOAD_DEBUG",
        data: {
          publishMode: res.data.publishMode,
          controlledMode: res.data.controlledMode,
          autoClickPublish: res.data.autoClickPublish,
          backendEnvironment: res.data.backendEnvironment,
        },
      }).catch(() => { });
    }

    const filled = [];
    const missed = [];
    const warnings = [];

    // ------------------------------------------------------------------
    // selectComboboxStep — interact with a Facebook [role="combobox"].
    // ------------------------------------------------------------------
    async function selectComboboxStep(label, keywords, targetValue, afterWait, isRequired = true) {
      console.log(`[STEP] ${label}`);
      stateLog(`Step: ${label}`);

      if (targetValue === null || targetValue === undefined || targetValue === "") {
        stateLog(`Skipping "${label}" — no value in listing data`);
        warnings.push(`${label}: no value in listing data — skipped`);
        return false;
      }

      setStatus(`Waiting for "${label}" combobox…`);
      const combobox = await waitForCombobox(keywords, BUDGET.COMBOBOX_WAIT_MS);
      if (!combobox) {
        stateError(`Could not find ${label} combobox`);
        missed.push(label);
        warnings.push(`${label}: combobox did not appear`);
        return false;
      }
      console.log(`[FOUND] ${label} combobox`, combobox);
      stateLog(`${label} combobox found`);

      const countBefore = document.querySelectorAll('[role="combobox"]').length;

      console.log(`[CLICK] ${label} combobox (countBefore=${countBefore})`);
      combobox.click();
      stateLog(`${label} — combobox clicked, waiting for options`);
      setStatus(`Opened "${label}" — waiting for options…`);

      let options = await waitForOptions(undefined, label);

      // ── Retry stage 1: synthetic MouseEvent sequence ──────────────────
      if (!options.length) {
        stateLog(`${label} — no options on first click; retrying with synthetic mouse events`);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(350);
        const cb2 = (await waitForCombobox(keywords, 3000)) || combobox;
        cb2.focus();
        await sleep(200);
        cb2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        cb2.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        cb2.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        await sleep(500);
        options = await waitForOptions(6000, `${label}-retry1`);
      }

      // ── Retry stage 2: keyboard ArrowDown / Space to open dropdown ────
      if (!options.length) {
        stateLog(`${label} — still no options; trying keyboard ArrowDown`);
        const cb3 = (await waitForCombobox(keywords, 2000)) || combobox;
        cb3.focus();
        await sleep(200);
        cb3.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
        await sleep(400);
        cb3.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
        await sleep(400);
        options = await waitForOptions(5000, `${label}-retry2`);
      }

      // ── Retry stage 3 (year / make only): type value + Enter ──────────
      if (!options.length && (label === "year" || label === "make")) {
        stateLog(`${label} — keyboard type fallback`);
        const cb4 = (await waitForCombobox(keywords, 2000)) || combobox;
        cb4.focus();
        await sleep(200);
        for (const ch of String(targetValue)) {
          cb4.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
          cb4.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true }));
          cb4.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
          await sleep(60);
        }
        await sleep(700);
        options = await waitForOptions(4000, `${label}-type`);
        if (!options.length) {
          // Final attempt: press Enter and verify combobox text changed
          cb4.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          await sleep(500);
          const cbText = (cb4.innerText || cb4.textContent || "").trim().toLowerCase();
          const expected = String(targetValue).toLowerCase().trim();
          if (cbText && cbText.includes(expected)) {
            stateLog(`${label} — keyboard Enter selected: "${cbText}"`);
            filled.push(label);
            return true;
          }
        }
      }

      if (!options.length) {
        stateLog(`${label} — trying broad Facebook popup option scan`);
        options = await scanForAnyOptions(5000, `${label}-broad-scan`);
      }

      if (!options.length) {
        stateError(`No [role="option"] elements appeared for ${label} (all retries exhausted)`);
        missed.push(label);
        warnings.push(`${label}: no options appeared after clicking combobox`);
        return false;
      }

      // ---- Fuzzy option matching ----
      const needle = normalizeText(targetValue);
      const getText = (o) => normalizeText(o.innerText || o.textContent || "");
      const norm = (s) => normalizeText(s).replace(/[^a-z0-9]/g, "");

      // Vehicle-type alias set — Facebook has used many different labels
      const VT_ALIASES = [
        "car/truck", "cars & trucks", "cars and trucks",
        "vehicle", "car", "truck", "automobile", "cars", "trucks",
        "auto/camioneta", "auto", "camioneta", "vehiculo", "vehiculos",
      ];

      // Color normalization map — handle Facebook label variants
      const COLOR_MAP = {
        "beige": ["beige", "tan", "cafe claro"],
        "black": ["black", "negro", "negra"],
        "blue": ["blue", "navy", "dark blue", "light blue", "azul"],
        "brown": ["brown", "burgundy", "maroon", "wine", "marron", "cafe", "vino", "vinotinto"],
        "gold": ["gold", "champagne", "bronze", "copper", "dorado", "bronce", "cobre"],
        "gray": ["gray", "grey", "silver", "charcoal", "dark gray", "light gray", "gris", "plateado", "plata"],
        "green": ["green", "olive", "dark green", "light green", "verde", "oliva"],
        "orange": ["orange", "naranja"],
        "purple": ["purple", "violet", "lavender", "morado", "purpura", "violeta", "lavanda"],
        "red": ["red", "dark red", "rojo", "roja"],
        "white": ["white", "pearl", "cream", "ivory", "off-white", "blanco", "blanca", "perla", "crema", "marfil"],
        "yellow": ["yellow", "amarillo", "amarilla"],
        "other": ["other", "otro", "otra"],
      };

      // Body style map — normalize vehicle body type to Facebook's option labels
      const BODY_STYLE_MAP = {
        "suv": ["suv", "sport utility", "sport-utility", "utilitario deportivo"],
        "sedan": ["sedan", "saloon", "sedan"],
        "truck": ["truck", "pickup", "pick-up", "pick up", "camioneta", "camion", "camioneta pickup"],
        "coupe": ["coupe", "2-door", "2door", "cupe"],
        "hatchback": ["hatchback", "hatch", "5-door", "compacto"],
        "van": ["van", "minivan", "mini-van", "furgoneta", "minivan"],
        "wagon": ["wagon", "estate", "touring", "familiar"],
        "convertible": ["convertible", "cabriolet", "roadster", "cabrio", "descapotable"],
      };

      const FUEL_MAP = {
        "gasoline": ["gasoline", "gas", "petrol", "gasolina"],
        "diesel": ["diesel"],
        "electric": ["electric", "ev", "eléctrico", "electrico"],
        "hybrid": ["hybrid", "híbrido", "hibrido"],
        "plug-in hybrid": ["plug-in hybrid", "plugin hybrid", "híbrido enchufable", "hibrido enchufable"],
        "flex": ["flex", "flex fuel", "combustible flexible"],
        "other": ["other", "otro", "otra"],
      };

      const CONDITION_MAP = {
        "used": ["used", "pre-owned", "usado", "usada"],
        "new": ["new", "nuevo", "nueva"],
        "excellent": ["excellent", "excelente"],
        "good": ["good", "bueno", "buena"],
        "fair": ["fair", "aceptable", "regular"],
        "salvage": ["salvage", "salvamento"],
      };

      let pick =
        options.find((o) => getText(o) === needle) ||
        options.find((o) => getText(o).includes(needle)) ||
        options.find((o) => needle.includes(getText(o)) && getText(o).length > 2) ||
        options.find((o) => norm(getText(o)) === norm(needle)) ||
        // Vehicle-type aliases
        (label === "vehicle type"
          ? options.find((o) => VT_ALIASES.some((a) => getText(o).includes(a)))
          : undefined) ||
        // Color matching — fires for "color", "exterior color", "interior color"
        (label.toLowerCase().includes("color")
          ? (() => {
            for (const [canonical, aliases] of Object.entries(COLOR_MAP)) {
              if (aliases.some((a) => needle.includes(a) || a.includes(needle))) {
                const found = options.find((o) => {
                  const text = getText(o);
                  return text.includes(canonical) || aliases.some((a) => text.includes(a));
                });
                if (found) return found;
              }
            }
            return undefined;
          })()
          : undefined) ||
        // Body style matching
        (label === "body style"
          ? (() => {
            for (const [canonical, aliases] of Object.entries(BODY_STYLE_MAP)) {
              if (aliases.some((a) => needle.includes(a) || a.includes(needle))) {
                const found = options.find((o) => {
                  const text = getText(o);
                  return text.includes(canonical) || aliases.some((a) => text.includes(a));
                });
                if (found) return found;
              }
            }
            return undefined;
          })()
          : undefined) ||
        (label === "fuel type"
          ? (() => {
            for (const [canonical, aliases] of Object.entries(FUEL_MAP)) {
              if (aliases.some((a) => needle.includes(a) || a.includes(needle))) {
                const found = options.find((o) => {
                  const text = getText(o);
                  return text.includes(canonical) || aliases.some((a) => text.includes(a));
                });
                if (found) return found;
              }
            }
            return undefined;
          })()
          : undefined) ||
        (label === "condition"
          ? (() => {
            for (const [canonical, aliases] of Object.entries(CONDITION_MAP)) {
              if (aliases.some((a) => needle.includes(a) || a.includes(needle))) {
                const found = options.find((o) => {
                  const text = getText(o);
                  return text.includes(canonical) || aliases.some((a) => text.includes(a));
                });
                if (found) return found;
              }
            }
            return undefined;
          })()
          : undefined);

      if (!pick) {
        if (!isRequired) {
          // Optional field — skip rather than guess with a random option
          const sample = options.slice(0, 5)
            .map((o) => `"${(o.innerText || o.textContent || "").trim()}"`)
            .join(", ");
          console.log(`[SKIP] ${label}: no exact match for "${targetValue}" (optional) — skipping. Options: ${sample}`);
          warnings.push(`${label}: skipped — no exact match for "${targetValue}"`);
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return false;
        }
        // Required field — fall back to first available option
        pick = options[0];
        const fallbackText = pick ? (pick.innerText || pick.textContent || "").trim() : "(none)";
        console.log(
          `[WARN] ${label}: no match for "${targetValue}" — falling back to first option: "${fallbackText}"`,
        );
        warnings.push(`${label}: no exact match for "${targetValue}" — used first option: "${fallbackText}"`);
      }

      if (!pick) {
        const sample = options.slice(0, 8)
          .map((o) => `"${(o.innerText || o.textContent || "").trim()}"`)
          .join(", ");
        stateError(`No option found at all for ${label} — available: ${sample}`);
        missed.push(label);
        warnings.push(`${label}: option list was empty after filtering`);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return false;
      }

      const pickedText = (pick.innerText || pick.textContent || "").trim();
      console.log(`[CLICK] option "${pickedText}" for ${label}`);
      stateLog(`${label} → "${pickedText}"`);
      pick.click();
      filled.push(label);
      log(`${label} → "${pickedText}"`);

      // ---- Post-selection verification (year / make) ─────────────────
      if (label === "year" || label === "make") {
        await sleep(400);
        const cbNow = (await waitForCombobox(keywords, 2000)) || combobox;
        const displayedNow = (cbNow.innerText || cbNow.textContent || "").trim();
        const expectedNorm = String(targetValue).toLowerCase().trim();
        if (displayedNow.toLowerCase().includes(expectedNorm)) {
          stateLog(`${label} verified — combobox shows "${displayedNow}"`);
        } else {
          stateLog(`${label} — combobox shows "${displayedNow}" (expected "${targetValue}") — proceeding`);
          warnings.push(`${label}: selected "${pickedText}" but combobox shows "${displayedNow}" — verify manually`);
        }
      }

      // ---- Post-selection wait ----
      if (afterWait === "generic") {
        stateLog(`Waiting for next combobox after ${label} (generic count wait)`);
        const appeared = await waitForMoreComboboxes(countBefore, 6000);
        if (!appeared) {
          console.log(`[WARN] combobox count did not increase after selecting ${label}`);
        }
      } else if (afterWait && typeof afterWait === "object" && afterWait.keywords) {
        console.log(`[STEP] Waiting for "${afterWait.label}" combobox after ${label}…`);
        stateLog(`DOM-polling for "${afterWait.label}" combobox after ${label}`);
        const appeared = await waitForNamedCombobox(afterWait.label, afterWait.keywords, 20000);
        if (!appeared) {
          console.log(`[WARN] "${afterWait.label}" combobox did not appear after selecting ${label}`);
        }
      } else {
        await sleep(400);
      }

      return true;
    }

    // ------------------------------------------------------------------
    // selectVehicleTypeStep — dedicated, 7-strategy Vehicle Type selector.
    //
    // Facebook has changed the Vehicle Type dropdown multiple times. This
    // function tries every known interaction pattern before pausing for
    // manual operator action rather than hard-failing the job.
    // ------------------------------------------------------------------
    async function selectVehicleTypeStep(rawValue) {
      // ── Body-style → Facebook Vehicle Type mapping ──────────────────────
      // Facebook now shows granular body types (Truck, SUV, …) instead of
      // the old "Car/Truck" category.  Map whichever value the server sends
      // to the label Facebook is most likely to display.
      const VT_MAP = {
        "truck": "Truck",
        "pickup": "Truck",
        "pickup truck": "Truck",
        "suv": "SUV",
        "sport utility": "SUV",
        "sport-utility": "SUV",
        "sedan": "Sedan",
        "saloon": "Sedan",
        "coupe": "Coupe",
        "2-door": "Coupe",
        "hatchback": "Hatchback",
        "hatch": "Hatchback",
        "van": "Van",
        "minivan": "Van",
        "mini-van": "Van",
        "wagon": "Wagon",
        "estate": "Wagon",
        "convertible": "Convertible",
        "cabriolet": "Convertible",
        "roadster": "Convertible",
        "car/truck": "Car/Truck",
        "cars & trucks": "Car/Truck",
        "cars and trucks": "Car/Truck",
        "car": "Car/Truck",
        "automobile": "Car/Truck",
      };
      const rawLower = (rawValue || "").toLowerCase().trim();
      const mapped = VT_MAP[rawLower] || rawValue || "Car/Truck";
      const VT_KWS = ["vehicle type", "tipo de veh", "category", "tipo"];
      // Also include body-style keywords for vehicles whose bodyStyle value
      // might land in the vehicle-type combobox (depends on form version)
      const CAR_ALIASES = ["car/truck", "cars & trucks", "cars and trucks", "vehicle", "automobile"];

      console.log(`[VT] selectVehicleTypeStep: "${rawValue}" → "${mapped}"`);
      stateLog(`Vehicle type: "${rawValue}" → "${mapped}"`);

      // ── Option-picker helper ────────────────────────────────────────────
      function tryPickOption(optionEls, target) {
        if (!optionEls.length) return false;
        const needle = target.toLowerCase().trim();
        const getText = (o) => (o.innerText || o.textContent || "").toLowerCase().trim();
        const normStr = (s) => s.replace(/[^a-z0-9]/g, "");

        let pick =
          optionEls.find((o) => getText(o) === needle) ||
          optionEls.find((o) => getText(o).includes(needle)) ||
          optionEls.find((o) => needle.includes(getText(o)) && getText(o).length > 2) ||
          optionEls.find((o) => normStr(getText(o)) === normStr(needle)) ||
          (CAR_ALIASES.includes(needle)
            ? optionEls.find((o) => CAR_ALIASES.some((a) => getText(o).includes(a)))
            : undefined);

        if (!pick) {
          // Fallback: first option — log the discrepancy
          const sample = optionEls.slice(0, 6).map((o) => `"${getText(o)}"`).join(", ");
          console.warn(`[VT] No exact match for "${target}" — available: ${sample} — using first`);
          warnings.push(`vehicle type: no match for "${target}" — used first option: "${getText(optionEls[0])}"`);
          pick = optionEls[0];
        }

        const pickedText = (pick.innerText || pick.textContent || "").trim();
        console.log(`[VT] Clicking option "${pickedText}"`);
        stateLog(`vehicle type → "${pickedText}"`);
        pick.click();
        filled.push(`vehicle type`);
        log(`vehicle type → "${pickedText}"`);
        return true;
      }

      // ── Run a click + option-scan cycle ────────────────────────────────
      async function clickAndScan(el, strategyLabel, waitMs) {
        el.click();
        await sleep(350);
        const opts = await scanForAnyOptions(waitMs || 8000, strategyLabel);
        return opts;
      }

      // ── Locate the vehicle-type combobox ───────────────────────────────
      let cb = await waitForCombobox(VT_KWS, BUDGET.COMBOBOX_WAIT_MS);

      // ── Strategy 1: Keyword combobox → click → role-agnostic scan ──────
      setStatus("Selecting vehicle type (1/7)…");
      if (cb) {
        console.log("[VT] S1: keyword combobox found, clicking");
        const opts = await clickAndScan(cb, "S1", 8000);
        if (opts.length) {
          if (tryPickOption(opts, mapped)) { await sleep(350); return; }
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(350);
      }

      // ── Strategy 2: Synthetic mouse-event sequence ─────────────────────
      setStatus("Selecting vehicle type (2/7)…");
      {
        const cb2 = (await waitForCombobox(VT_KWS, 3000)) || cb;
        if (cb2) {
          console.log("[VT] S2: synthetic mousedown/mouseup/click");
          cb2.focus();
          await sleep(200);
          for (const evType of ["mousedown", "mouseup", "click"]) {
            cb2.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
          }
          await sleep(500);
          const opts = await scanForAnyOptions(6000, "S2");
          if (opts.length) {
            if (tryPickOption(opts, mapped)) { await sleep(350); return; }
          }
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await sleep(350);
        }
      }

      // ── Strategy 3: ArrowDown + Space keyboard open ────────────────────
      setStatus("Selecting vehicle type (3/7)…");
      {
        const cb3 = (await waitForCombobox(VT_KWS, 2000)) || cb;
        if (cb3) {
          console.log("[VT] S3: ArrowDown + Space keyboard open");
          cb3.focus();
          await sleep(200);
          cb3.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
          await sleep(400);
          cb3.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
          await sleep(400);
          const opts = await scanForAnyOptions(5000, "S3");
          if (opts.length) {
            if (tryPickOption(opts, mapped)) { await sleep(350); return; }
          }
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await sleep(350);
        }
      }

      // ── Strategy 4: Label-text walk — find "Vehicle type" text, click nearby button ──
      setStatus("Selecting vehicle type (4/7)…");
      {
        console.log("[VT] S4: scanning for visible 'Vehicle type' label text");
        const VT_LABEL_KWS = ["vehicle type", "tipo de vehículo", "tipo de vehiculo", "vehicle category"];
        const labelEls = Array.from(document.querySelectorAll("label, span, div, p, legend"))
          .filter((el) => {
            if (!el.offsetParent) return false;
            const t = (el.innerText || el.textContent || "").toLowerCase().trim();
            return VT_LABEL_KWS.some((kw) => t === kw || t.startsWith(kw));
          });
        console.log(`[VT] S4: ${labelEls.length} matching label elements`);
        for (const lbl of labelEls) {
          const container = lbl.closest("div, form, fieldset") || lbl.parentElement;
          if (!container) continue;
          const nearby = container.querySelector(
            '[role="combobox"], [role="button"][tabindex], div[tabindex="0"]',
          );
          if (nearby && nearby.offsetParent) {
            console.log("[VT] S4: clicking nearby combobox/button via label");
            const opts = await clickAndScan(nearby, "S4", 5000);
            if (opts.length) {
              if (tryPickOption(opts, mapped)) { await sleep(350); return; }
            }
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await sleep(350);
          }
        }
      }

      // ── Strategy 5: First visible combobox (positional fallback) ──────
      setStatus("Selecting vehicle type (5/7)…");
      {
        const allCbs = Array.from(document.querySelectorAll('[role="combobox"]'))
          .filter((el) => el.offsetParent !== null);
        console.log(`[VT] S5: ${allCbs.length} visible comboboxes — clicking first`);
        if (allCbs.length > 0) {
          const opts = await clickAndScan(allCbs[0], "S5", 5000);
          if (opts.length) {
            const texts = opts.map((o) => (o.innerText || o.textContent || "").toLowerCase().trim());
            const looksLikeVT = texts.some((t) =>
              ["car", "truck", "suv", "sedan", "coupe", "van", "motorcycle", "vehicle", "automobile"]
                .some((vt) => t.includes(vt)),
            );
            if (looksLikeVT) {
              if (tryPickOption(opts, mapped)) { await sleep(350); return; }
            }
          }
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await sleep(350);
        }
      }

      // ── Strategy 6: aria-owns / aria-controls / ancestor walk ─────────
      setStatus("Selecting vehicle type (6/7)…");
      {
        const cbEl = (await waitForCombobox(VT_KWS, 2000)) || cb;
        if (cbEl) {
          console.log("[VT] S6: aria-owns / ancestor walk");
          cbEl.focus();
          cbEl.click();
          await sleep(600);

          const ariaRef = cbEl.getAttribute("aria-owns") || cbEl.getAttribute("aria-controls");
          if (ariaRef) {
            const container = document.getElementById(ariaRef);
            if (container) {
              const opts = Array.from(
                container.querySelectorAll('[role="option"], [role="menuitem"], li, [data-value]'),
              ).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
              if (opts.length) {
                console.log(`[VT] S6: ${opts.length} options via aria-ref`);
                if (tryPickOption(opts, mapped)) { await sleep(350); return; }
              }
            }
          }

          // Walk up 6 ancestors looking for an expanded dropdown
          let ancestor = cbEl.parentElement;
          for (let i = 0; i < 6 && ancestor; i++) {
            const opts = Array.from(
              ancestor.querySelectorAll('[role="option"], [role="menuitem"]'),
            ).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
            if (opts.length) {
              console.log(`[VT] S6: ${opts.length} options in ancestor level ${i}`);
              if (tryPickOption(opts, mapped)) { await sleep(350); return; }
              break;
            }
            ancestor = ancestor.parentElement;
          }
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await sleep(350);
        }
      }

      // ── Strategy 7: Type the mapped value → await filtered options ─────
      setStatus("Selecting vehicle type (7/7 — type + Enter)…");
      {
        const cbEl = (await waitForCombobox(VT_KWS, 2000)) || cb;
        if (cbEl) {
          console.log(`[VT] S7: typing "${mapped}" char-by-char`);
          cbEl.focus();
          await sleep(200);
          for (const ch of mapped) {
            cbEl.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
            cbEl.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true }));
            cbEl.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
            await sleep(60);
          }
          await sleep(700);
          const opts = await scanForAnyOptions(4000, "S7");
          if (opts.length) {
            if (tryPickOption(opts, mapped)) { await sleep(350); return; }
          }
          // Try Enter to commit typed value
          cbEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          await sleep(500);
          const cbText = (cbEl.innerText || cbEl.textContent || "").trim();
          if (cbText && cbText.length > 1) {
            console.log(`[VT] S7: Enter committed, combobox shows "${cbText}"`);
            filled.push("vehicle type");
            log(`vehicle type → "${cbText}" (typed)`);
            return;
          }
        }
      }

      // ── All 7 strategies exhausted — pause for manual operator action ──
      console.error("[VT] All strategies failed — pausing for manual selection");
      stateError("Vehicle type auto-selection failed (all 7 strategies exhausted)");
      warnings.push("vehicle type: auto-selection failed — operator must select manually");

      await waitForManualContinue(
        "Select Vehicle Type on the Facebook form (the first dropdown), then click Continue.",
      );
      // Operator confirmed — credit the field as filled
      filled.push("vehicle type");
      warnings.push("vehicle type: selected manually by operator");
      stateLog("Vehicle type: operator confirmed manual selection");
    }

    // ------------------------------------------------------------------
    // fillStep — wait for a text input / textarea and write the value.
    // ------------------------------------------------------------------
    async function fillStep(label, keywords, value) {
      if (value === null || value === undefined || value === "") {
        stateLog(`Skipping "${label}" — no value in listing data`);
        warnings.push(`${label}: no value in listing data — skipped`);
        return false;
      }
      stateLog(`Filling ${label}`);
      const el = await waitForField(keywords, 6000);
      if (el) {
        setNativeValue(el, String(value));
        filled.push(label);
        log(`${label} filled`);
        return true;
      } else {
        stateError(`Could not find ${label} field`);
        missed.push(label);
        return false;
      }
    }

    async function fillTextOrSelectComboboxStep(label, textKeywords, comboKeywords, value, afterWait) {
      if (value === null || value === undefined || value === "") {
        stateLog(`Skipping "${label}" — no value in listing data`);
        warnings.push(`${label}: no value in listing data — skipped`);
        return false;
      }
      const textField = await waitForNamedField(label, textKeywords, 1800);
      if (textField) {
        setNativeValue(textField, String(value));
        filled.push(label);
        log(`${label} filled`);
        return true;
      }
      return selectComboboxStep(label, comboKeywords, value, afterWait, false);
    }

    // ==================================================================
    // STATE MACHINE — Phase 0: Photos first → required → optional
    // Priority: photos + required fields. Optional fields skip on no match.
    // ==================================================================

    try {

      // ---- Phase 0: Upload photos FIRST ----
      // Must happen before filling any text — Facebook requires at least
      // one photo before the Next button becomes active.
      stateLog("Phase 0: uploading photos first");
      setStatus("Uploading photos…");
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "field_fill_started", details: "Starting photo upload and form fill" }).catch(() => { });

      if (images && images.length) {
        const photoResult = await uploadPhotos(images, job.id, warnings);
        if (photoResult.failed) {
          if (job.mode === "Controlled" || job.autoClickPublish === true) {
            const reason = photoResult.reason || "Photo upload failed";
            stateError("Photo upload failed — aborting", new Error(reason));
            setStatus(reason, "err");
            send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => { });
            await send({ type: "FAIL_JOB", jobId: job.id, reason });
            await chrome.storage.local.remove("activeJob");
            renderReview(job, { filled, missed, warnings });
            return;
          }
          warnings.push(photoResult.reason || "Photo upload failed — upload photos manually");
        } else {
          filled.push(`photos (${photoResult.uploaded} uploaded)`);
        }
      } else {
        warnings.push("No photos in job payload — upload photos manually");
      }

      // ---- Phase 1: Vehicle type (required for Next button to activate) ----
      // Uses the dedicated 7-strategy selectVehicleTypeStep which also maps
      // body-style values (Truck/SUV/Sedan/…) to Facebook's label variants
      // and pauses for manual operator action rather than hard-failing.
      stateLog("Phase 1: vehicle type (required)");
      setStatus("Selecting vehicle type…");
      await selectVehicleTypeStep(fill.vehicleType || fill.bodyStyle || "Car/Truck");

      // ---- Phase 2: Year / Make / Model ──────────────────────────────────
      // Year and Make are required for Facebook to enable the Next button.
      // We try a robust 3-stage retry (click → synthetic events → keyboard).
      // If they still fail we continue filling the rest of the form (so the
      // operator can review a fully-filled form) and then let validateBeforeNext
      // surface the specific "Year / Make not selected" error.
      stateLog("Phase 2: year / make / model");

      setStatus("Selecting year…");
      const yearFilled = await selectComboboxStep(
        "year",
        ["year", "año", "ano"],
        fill.year ? String(fill.year) : null,
        "generic",
        false,  // false = don't auto-pick first option on no-match
      );

      setStatus("Selecting make…");
      const makeFilled = await fillTextOrSelectComboboxStep(
        "make",
        ["make", "marca"],
        ["make", "marca"],
        fill.make,
        "generic",
      );

      if (!yearFilled || !makeFilled) {
        const failing = [!yearFilled && fill.year ? "Year" : null, !makeFilled && fill.make ? "Make" : null]
          .filter(Boolean).join(" and ");
        if (failing) {
          stateLog(`⚠️ ${failing} not selected — filling remaining fields then pausing for operator`);
          setStatus(`⚠️ Action needed: select ${failing} manually on the form`, "err");
        }
      }

      // Model — text input that appears after Make cascade
      setStatus("Filling model…");
      stateLog("Waiting for Model text input");
      const modelInput = await waitForNamedField("model", ["model", "modelo"], 10000);
      if (modelInput && fill.model) {
        setNativeValue(modelInput, String(fill.model));
        modelInput.dispatchEvent(new Event("input", { bubbles: true }));
        modelInput.dispatchEvent(new Event("change", { bubbles: true }));
        modelInput.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        filled.push("model");
        log(`model → "${fill.model}"`);
      } else if (!fill.model) {
        warnings.push("model: no value in listing data — skipped");
      } else {
        warnings.push("model: text input did not appear after Make selection — skipped");
      }

      // ---- Phase 3: Required text fields — price, title, description, location ----
      stateLog("Phase 3: required text fields");
      setStatus("Filling price, title, description, location…");

      if (fill.priceMode === "DOWN_PAYMENT") {
        log(`pricing mode: DOWN_PAYMENT — posting $${fill.marketplaceDisplayedPrice ?? fill.price}`);
      } else {
        log(`pricing mode: FULL_PRICE — posting $${fill.price}`);
      }
      await fillStep("price", ["price", "listing price", "asking price", "precio"], fill.price);

      // Title — may be auto-generated by Facebook from Year/Make/Model
      {
        const TITLE_KWS = [
          "title", "listing title", "what are you selling",
          "vehicle name", "add a title", "item title",
          "título", "titulo",
        ];
        stateLog("Checking for title field");
        const titleEl = await waitForField(TITLE_KWS, 8000);
        if (titleEl) {
          if (fill.title) {
            setNativeValue(titleEl, String(fill.title));
            titleEl.dispatchEvent(new Event("input", { bubbles: true }));
            titleEl.dispatchEvent(new Event("change", { bubbles: true }));
            titleEl.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
            filled.push("title");
            log(`title → "${fill.title}"`);
          } else {
            warnings.push("title: field exists but no value in listing data");
          }
        } else {
          stateLog("title auto generated by Facebook");
          filled.push("title (auto generated)");
        }
      }

      await fillStep("description", ["description", "describe", "details", "descripción", "descripcion", "detalles"], fill.description);
      await fillStep("location", ["location", "city", "where", "ubicación", "ubicacion", "ciudad"], fill.location);

      // ---- Phase 4: Mileage (required for Next button) ──────────────────
      // Always attempted regardless of FAST_MODE — Facebook requires mileage.
      // Normalize: strip commas, "miles", "mi" text — numbers only.
      // "119,548 miles" → "119548"
      stateLog("Phase 4: mileage (required for Next button)");
      {
        const rawMileage = fill.mileage;
        if (rawMileage === null || rawMileage === undefined || rawMileage === "") {
          stateError("Mileage missing from vehicle data");
          setStatus("Mileage missing from vehicle data", "err");
          missed.push("mileage");
          warnings.push("mileage: Mileage missing from vehicle data");
        } else {
          const normalizedMileage = String(rawMileage)
            .replace(/,/g, "")
            .replace(/\s*(miles?|mi)\b/gi, "")
            .trim();
          stateLog(`Mileage: raw="${rawMileage}" → normalized="${normalizedMileage}"`);
          await fillStep("mileage", [
            "mileage", "odometer", "miles", "vehicle mileage",
            "number of miles", "mileage (optional)", "odometer reading",
            "millaje", "kilometraje", "kilómetros", "kilometros",
          ], normalizedMileage);
        }
      }

      // ---- Phase 5a: Body Style (required) ──────────────────────────────
      stateLog("Phase 5a: body style (required)");
      {
        let bodyStyleValue = fill.bodyStyle;
        if (!bodyStyleValue || bodyStyleValue.toLowerCase() === "unknown") {
          // Infer a safe default from vehicle type so Next can enable
          const vt = (fill.vehicleType || "").toLowerCase();
          bodyStyleValue = (vt.includes("truck") || vt.includes("pickup")) ? "Truck" : "Sedan";
          stateLog(`Body style unknown — defaulting to "${bodyStyleValue}" based on vehicle type`);
        }
        const bsOk = await selectComboboxStep(
          "body style",
          ["body style", "vehicle style", "body type", "style", "carrocería", "carroceria"],
          bodyStyleValue,
          null,
          false,
        );
        if (!bsOk && !missed.includes("body style")) {
          missed.push("body style");
          warnings.push(`body style: "${bodyStyleValue}" not found in Facebook options`);
        }
      }

      // ---- Phase 5b: Exterior Color (required) ───────────────────────────
      stateLog("Phase 5b: exterior color (required)");
      {
        const extColor = fill.exteriorColor || fill.color || null;
        if (!extColor) {
          missed.push("exterior color");
          warnings.push("exterior color: missing from vehicle data");
        } else {
          const ecOk = await selectComboboxStep(
            "exterior color",
            ["exterior color", "exterior", "color", "color exterior"],
            extColor,
            null,
            true,
          );
          if (!ecOk && !missed.includes("exterior color")) {
            missed.push("exterior color");
            warnings.push(`exterior color: "${extColor}" not found in Facebook options`);
          }
        }
      }

      // ---- Phase 5c: Interior Color (required — fallback: Black → Gray → Other) ─
      stateLog("Phase 5c: interior color (required, with fallbacks)");
      {
        const interiorCandidates = fill.interiorColor
          ? [fill.interiorColor, "Black", "Gray", "Other"]
          : ["Black", "Gray", "Other"];
        let interiorFilled = false;
        for (const candidate of interiorCandidates) {
          const missedBefore = missed.length;
          const warnsBefore = warnings.length;
          const ok = await selectComboboxStep(
            "interior color",
            ["interior color", "interior", "color interior"],
            candidate,
            null,
            true,
          );
          if (ok) { interiorFilled = true; break; }
          // Not the final fallback — undo spurious missed/warning entries and retry
          if (candidate !== interiorCandidates[interiorCandidates.length - 1]) {
            missed.splice(missedBefore);
            warnings.splice(warnsBefore);
          }
        }
        if (!interiorFilled && !missed.includes("interior color")) {
          missed.push("interior color");
          warnings.push("interior color: no fallback color (Black/Gray/Other) available in Facebook options");
        }
      }

      // ---- Phase 6: Additional vehicle details. Facebook often keeps these
      // below the fold in localized Marketplace forms.
      stateLog("Phase 6: condition / fuel / transmission");
      await selectComboboxStep(
        "condition",
        ["condition", "estado", "estado del vehículo", "estado del vehiculo"],
        fill.condition || "Used",
        null,
        false,
      );
      await selectComboboxStep(
        "fuel type",
        ["fuel", "fuel type", "tipo de combustible", "combustible"],
        fill.fuelType,
        null,
        false,
      );
      await selectComboboxStep(
        "transmission",
        ["transmission", "transmisión", "transmision"],
        fill.transmission,
        null,
        false,
      );

      checkBudget("workflow complete");
      stateLog(`Workflow Complete — ${elapsed()}s elapsed`);

    } catch (err) {
      stateError("Unexpected error in publishing workflow", err);
      setStatus("Workflow error: " + ((err && err.message) || String(err)), "err");
      log("Publishing flow crashed", err);
    }

    if (job.mode === "Controlled" || job.autoClickPublish === true) {
      await autoPublishFlow(job, { filled, missed, warnings });
    } else {
      setStatus("Fields filled. Review, then mark the result. Publish was NOT clicked.", "ok");
      renderReview(job, { filled, missed, warnings });
      log("Publishing fill complete", { job, filled, missed, warnings });
    }
  }

  // =====================================================================
  // Photo upload — fetch via background service worker (bypasses CORS),
  // inject into Facebook's hidden file input, wait for thumbnails.
  // ── Canvas resize helper ─────────────────────────────────────────────────
  // Scales a blob to maxWidth preserving aspect ratio, encodes as JPEG.
  // Falls back to the original blob if createImageBitmap or canvas fails.
  // =====================================================================
  // Canvas/bitmap resize helper (reemplaza la versión anterior)
  async function resizeImage(blob, maxWidth, quality) {
    // Intenta usar createImageBitmap (rápido); si falla, usa Image() + canvas fallback.
    async function bitmapResize(srcBlob, targetWidth, q) {
      const bitmap = await createImageBitmap(srcBlob);
      let { width, height } = bitmap;
      if (width > targetWidth) {
        height = Math.round((height * targetWidth) / width);
        width = targetWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return await new Promise((resolve, reject) => {
        canvas.toBlob((resized) => {
          if (resized) resolve(resized);
          else reject(new Error("canvas.toBlob returned null"));
        }, "image/jpeg", q);
      });
    }

    async function imageElementResize(srcBlob, targetWidth, q) {
      const url = URL.createObjectURL(srcBlob);
      try {
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Image() load failed"));
          image.src = url;
        });
        let { width, height } = img;
        if (width > targetWidth) {
          height = Math.round((height * targetWidth) / width);
          width = targetWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        return await new Promise((resolve, reject) => {
          canvas.toBlob((resized) => {
            if (resized) resolve(resized);
            else reject(new Error("canvas.toBlob returned null"));
          }, "image/jpeg", q);
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    try {
      return await bitmapResize(blob, maxWidth, quality);
    } catch (e) {
      console.warn("[PHOTO] createImageBitmap failed, falling back to Image():", e && e.message);
      try {
        return await imageElementResize(blob, maxWidth, quality);
      } catch (e2) {
        console.warn("[PHOTO] Image() fallback failed; returning original blob:", e2 && e2.message);
        return blob;
      }
    }
  }

  // =====================================================================
  // Ensure final JPEG is under maxBytes by trying quality and width reductions.
  // Devuelve Blob (JPEG) si tuvo éxito, o null si no pudo reducirlo.
  async function ensureUnderLimit(originalBlob, initialMaxWidth = 1600, initialQuality = 0.82, maxBytes = 10 * 1024 * 1024) {
    const QUALITY_STEPS = [initialQuality, 0.75, 0.65, 0.55, 0.5];
    const WIDTH_STEPS = [initialMaxWidth, 1200, 1000, 800];

    // If already small and JPEG, return early
    const lowerType = (originalBlob.type || "").toLowerCase();
    if (originalBlob.size <= maxBytes && (lowerType.includes("jpeg") || lowerType.includes("jpg"))) {
      return originalBlob;
    }

    for (const w of WIDTH_STEPS) {
      for (const q of QUALITY_STEPS) {
        try {
          const resized = await resizeImage(originalBlob, w, q);
          if (!resized) {
            console.warn(`[PHOTO] resizeImage failed for width=${w} quality=${q}`);
            continue;
          }
          // Ensure mime is image/jpeg
          const finalBlob = resized.type && resized.type !== "image/jpeg"
            ? new Blob([await resized.arrayBuffer()], { type: "image/jpeg" })
            : resized;
          console.log(`[PHOTO] compress attempt: width=${w} quality=${q} sizeKB=${Math.round(finalBlob.size / 1024)}`);
          if (finalBlob.size <= maxBytes) return finalBlob;
        } catch (e) {
          console.warn("[PHOTO] compress attempt error:", e && e.message);
        }
      }
    }

    // Último intento agresivo
    try {
      const last = await resizeImage(originalBlob, WIDTH_STEPS[WIDTH_STEPS.length - 1], 0.5);
      if (last.size <= maxBytes) return last;
    } catch (_) { /* ignore */ }

    console.warn("[PHOTO] Could not compress image under limit:", Math.round(originalBlob.size / 1024), "KB");
    return null;
  }

  // =====================================================================

  async function uploadPhotos(imageUrls, jobId, warnings) {
    // Upload up to 20 photos — Facebook's per-listing maximum.
    const DEFAULT_MAX = 20;
    const toUpload = imageUrls.slice(0, DEFAULT_MAX);
    const totalPhotos = toUpload.length;

    stateLog(`Photo upload: ${totalPhotos} photo(s) — locating file input`);
    setStatus("Looking for photo upload input…");

    // Wait up to 10 s for Facebook to render the file input
    let input = null;
    const FILE_SELECTORS = [
      'input[type="file"][accept*="image"]',
      'input[type="file"][multiple]',
      'input[type="file"]',
    ];
    for (let attempt = 0; attempt < 20; attempt++) {
      for (const sel of FILE_SELECTORS) {
        const found = document.querySelector(sel);
        if (found) { input = found; break; }
      }
      if (input) break;
      await sleep(500);
    }

    if (!input) {
      const reason = "Photo upload failed: no file input found on Facebook form";
      stateError(reason);
      return { uploaded: 0, failed: true, reason };
    }

    // ── Parallel download (3 concurrent) with in-memory cache ────────────
    send({
      type: "SEND_JOB_EVENT", jobId, event: "photo_download_started",
      details: `Downloading ${totalPhotos} photos`
    }).catch(() => { });
    stateLog(`Photo download: fetching ${totalPhotos} photo(s) in parallel batches of 5`);
    setStatus(`Downloading photos 0 / ${totalPhotos}…`);

    const BATCH = 5;
    const rawFiles = new Array(totalPhotos).fill(null);
    let downloaded = 0;

    for (let i = 0; i < totalPhotos; i += BATCH) {
      const indices = [];
      for (let j = i; j < Math.min(i + BATCH, totalPhotos); j++) indices.push(j);

      await Promise.all(indices.map(async (idx) => {
        const cacheKey = `${jobId}-${idx}`;
        try {
          let base64, type;
          if (_photoCache.has(cacheKey)) {
            ({ base64, type } = _photoCache.get(cacheKey));
            stateLog(`Photo ${idx + 1}: cache hit`);
          } else {
            const res = await send({ type: "FETCH_JOB_PHOTO", jobId, index: idx });
            if (!res || !res.ok) {
              console.error(`[PHOTO] proxy FAILED idx ${idx}:`, res?.error);
              stateLog(`Photo ${idx + 1}: proxy failed — ${res?.error}`);
              return;
            }
            ({ base64, type } = res.data);
            _photoCache.set(cacheKey, { base64, type });
          }

          // base64 → Uint8Array → Blob
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
          const mimeType = type || "image/jpeg";
          const originalBlob = new Blob([bytes], { type: mimeType });

          // Resize to max 1600 px wide, JPEG quality 0.82
          // Produce final JPEG bajo 10 MB (límite Facebook), con compresión progresiva.
          const TARGET_MAX_BYTES = 10 * 1024 * 1024;
          const finalBlob = await ensureUnderLimit(originalBlob, 1600, 0.82, TARGET_MAX_BYTES);

          if (!finalBlob) {
            const reason = `Photo ${idx + 1}: could not compress below ${(TARGET_MAX_BYTES / 1024).toFixed(0)} KB`;
            console.warn("[PHOTO]", reason);
            warnings.push(reason);

            // If active job is Controlled or autoClickPublish, fail it immediately
            try {
              const { activeJob } = await chrome.storage.local.get("activeJob");
              if (activeJob && (activeJob.mode === "Controlled" || activeJob.autoClickPublish === true) && activeJob.id === jobId) {
                await send({ type: "SEND_JOB_EVENT", jobId, event: "auto_publish_failed", details: reason }).catch(() => { });
                await send({ type: "FAIL_JOB", jobId, reason }).catch(() => { });
                await chrome.storage.local.remove("activeJob");
                return { uploaded: 0, failed: true, reason };
              }
            } catch (e) {
              console.warn("[PHOTO] error while failing job:", e && e.message);
            }

            // Default: skip this image and continue with others
            return;
          }

          stateLog(`Photo ${idx + 1}: ${Math.round(originalBlob.size / 1024)} KB → ${Math.round(finalBlob.size / 1024)} KB (final)`);

          rawFiles[idx] = new File([finalBlob], `vehicle-${idx + 1}.jpg`, { type: "image/jpeg" });
          downloaded++;
          setStatus(`Downloading photos ${downloaded} / ${totalPhotos}…`);
        } catch (err) {
          stateLog(`Photo ${idx + 1}: error — ${err.message}`);
        }
      }));

      // Progress event after each batch completes
      const done = Math.min(i + BATCH, totalPhotos);
      send({
        type: "SEND_JOB_EVENT", jobId, event: "photo_download_progress",
        details: `Downloading photos ${done} / ${totalPhotos}`
      }).catch(() => { });
    }

    const files = rawFiles.filter(Boolean);
    if (files.length === 0) {
      const reason = "Photo upload failed: could not download any images from the job payload";
      stateError(reason);
      return { uploaded: 0, failed: true, reason };
    }

    send({
      type: "SEND_JOB_EVENT", jobId, event: "photo_download_complete",
      details: `${files.length} photos ready`
    }).catch(() => { });
    stateLog(`Photos ready: ${files.length} / ${totalPhotos} downloaded and resized`);

    // ── Inject files into Facebook ────────────────────────────────────────
    stateLog(`Photo upload: injecting ${files.length} file(s)`);
    setStatus(`Uploading ${files.length} photo(s) to Facebook…`);
    send({
      type: "SEND_JOB_EVENT", jobId, event: "photo_upload_started",
      details: `Uploading ${files.length} photos`
    }).catch(() => { });

    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    send({
      type: "SEND_JOB_EVENT", jobId, event: "photo_upload_complete",
      details: `${files.length} photos injected`
    }).catch(() => { });

    // ── Fast check: file input has our injected files ─────────────────────
    // input.files only proves the browser accepted our DataTransfer. It does
    // not prove Facebook accepted/uploaded the photos, so Full Auto waits for
    // visible thumbnails or a non-zero Facebook photo counter before moving on.
    if (input.files && input.files.length > 0) {
      stateLog(`Photo upload: ${input.files.length} file(s) confirmed on file input`);
    }

    // ── Wait for Facebook to render thumbnails (gives Next button time to enable) ──
    stateLog("Photo upload: waiting for Facebook thumbnail rendering…");
    setStatus(`Waiting for Facebook to process ${files.length} photo(s)…`);
    send({ type: "SEND_JOB_EVENT", jobId, event: "thumbnail_wait_started" }).catch(() => { });
    const confirmed = await waitForPhotoThumbnails(files.length, BUDGET.THUMBNAIL_WAIT_MS);
    if (confirmed && !_photosConfirmed) {
      stateLog(`Photo upload: Facebook thumbnails visible`);
      _photosConfirmed = true;
      send({
        type: "SEND_JOB_EVENT", jobId, event: "thumbnail_detected",
        details: `${files.length} photos confirmed via DOM`
      }).catch(() => { });
    } else if (!confirmed) {
      const reason = `Photo upload failed: Facebook did not confirm ${files.length} uploaded photo(s)`;
      stateError(reason);
      warnings.push(reason);
      send({ type: "SEND_JOB_EVENT", jobId, event: "auto_publish_failed", details: reason }).catch(() => { });
      return { uploaded: files.length, failed: true, reason };
    }

    send({ type: "SEND_JOB_EVENT", jobId, event: "photos_uploaded", details: `${files.length} photos` }).catch(() => { });
    setStatus(`Photos uploaded (${files.length}). Continuing…`);
    await sleep(200);

    return { uploaded: files.length, failed: false };
  }

  async function waitForPhotoThumbnails(expectedCount, timeoutMs) {
    const start = Date.now();
    let lastMsg = 0;
    const getPhotoCounter = () => {
      const text = document.body?.innerText || "";
      const slashMatch = text.match(/(?:photos?|fotos?)\s*[·:\-]?\s*(\d+)\s*\/\s*\d+/i);
      if (slashMatch) return Number.parseInt(slashMatch[1], 10) || 0;
      const wordMatch = text.match(/(\d+)\s*(?:photos?|fotos?)\b/i);
      return wordMatch ? Number.parseInt(wordMatch[1], 10) || 0 : 0;
    };

    while (Date.now() - start < timeoutMs) {
      const photoCount = getPhotoCounter();
      if (photoCount > 0) {
        stateLog(`Photo counter found: ${photoCount} / ${expectedCount}`);
        return true;
      }

      // Facebook renders uploaded photo thumbnails in a few different ways
      const thumbs = [
        ...document.querySelectorAll('[data-testid="media-attachment-delete-button"]'),
        ...document.querySelectorAll('img[src^="blob:"]'),
        ...document.querySelectorAll('[aria-label*="photo" i] img'),
        ...document.querySelectorAll('[aria-label*="foto" i] img'),
        ...document.querySelectorAll('[aria-label*="image" i] img'),
        ...document.querySelectorAll('[aria-label*="imagen" i] img'),
        ...document.querySelectorAll('[aria-label*="upload" i] img'),
        ...document.querySelectorAll('[aria-label*="subir" i] img'),
        ...document.querySelectorAll('[aria-label*="agregar" i] img'),
        ...document.querySelectorAll('[aria-label*="eliminar" i]'),
        ...document.querySelectorAll('[aria-label*="remove" i]'),
      ];
      // Deduplicate by filtering to unique elements
      const unique = [...new Set(thumbs)];
      if (unique.length >= 1) {
        stateLog(`Photo thumbnails found: ${unique.length} / ${expectedCount}`);
        return true;
      }
      // Also accept: any visible image that appeared inside the upload area
      const uploadArea = document.querySelector(
        [
          '[aria-label*="photo" i]',
          '[aria-label*="foto" i]',
          '[aria-label*="image" i]',
          '[aria-label*="imagen" i]',
          '[aria-label*="upload" i]',
          '[aria-label*="subir" i]',
          '[aria-label*="agregar" i]',
        ].join(", ")
      );
      if (uploadArea) {
        const imgs = uploadArea.querySelectorAll("img");
        if (imgs.length >= 1) return true;
      }
      // Emit progress messages — thresholds tuned for the 20 s budget
      const elapsed = Date.now() - start;
      if (elapsed > 5000 && lastMsg < 5000) {
        setStatus("Facebook is processing thumbnails…");
        lastMsg = elapsed;
      } else if (elapsed > 12000 && lastMsg < 12000) {
        setStatus("Still waiting for Facebook thumbnails (12 s)…");
        lastMsg = elapsed;
      }
      await sleep(500);
    }
    return false;
  }

  // ── Auto-retry helper ────────────────────────────────────────────────────────
  // On first failure: fails the job, resets it to Queued on the backend, then
  // navigates back to the Marketplace create page so the content script picks
  // it up fresh. On second+ failure: returns false so the caller renders review.

  async function handleAutoRetry(job, reason, extras) {
    const retryCount = job._retryCount ?? 0;
    if (retryCount >= 1) {
      // Already retried once — do a final fail and let caller render review
      await send({ type: "FAIL_JOB", jobId: job.id, reason });
      await chrome.storage.local.remove("activeJob");
      return false;
    }

    stateLog(`Auto-retry: first failure — "${reason}" — will retry job #${job.id}`);
    setStatus("First attempt failed — auto-retrying in 4 s…", "err");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_retry_pending", details: reason }).catch(() => { });

    try {
      await send({ type: "FAIL_JOB", jobId: job.id, reason: `${reason} [auto-retry pending]` });
      const retryRes = await send({ type: "RETRY_JOB", jobId: job.id });
      if (!retryRes || !retryRes.ok) throw new Error(retryRes?.error ?? "Retry API call failed");

      // Persist incremented retry count; clear prefetched payload so next run fetches fresh data
      await chrome.storage.local.set({
        activeJob: { ...job, _retryCount: retryCount + 1, _prefetchedPayload: undefined },
      });

      setStatus("Auto-retry: reopening Marketplace in 4 s…");
      await sleep(4000);
      window.location.href = "https://www.facebook.com/marketplace/create/vehicle";
    } catch (e) {
      console.error("[AUTO-RETRY] Setup failed:", e);
      await chrome.storage.local.remove("activeJob");
      return false; // caller should render review
    }

    return true; // navigating away — caller must NOT call renderReview
  }

  // ── Controlled-mode: auto-click Next → Publish ─────────────────────────────

  async function autoPublishFlow(job, { filled, missed, warnings }) {
    stateLog("Auto-publish: starting");
    setStatus("Auto-publishing — validating form before clicking Next…");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_starting" }).catch(() => { });

    await sleep(300);

    // ---- Pre-Next validation ----
    // Ensure the form is ready before we click Next. If the Next button is
    // disabled or missing required fields, detect the exact reason instead
    // of reporting a generic "Publish button not found" error.
    const validation = await validateBeforeNext(missed, warnings);
    if (!validation.ok) {
      stateError("Pre-Next validation failed", new Error(validation.reason));
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: validation.reason }).catch(() => { });
      const retried = await handleAutoRetry(job, validation.reason);
      if (!retried) {
        setStatus(validation.reason, "err");
        renderReview(job, { filled, missed, warnings });
      }
      return;
    }

    setStatus("Auto-publishing — clicking Next…");
    const nextClicked = await clickEnabledButtonByText(["next", "continue", "next step", "siguiente", "continuar"], 10000);
    if (!nextClicked) {
      const fbErrors = scrapeFacebookErrors();
      const reason = fbErrors
        ? `Next button blocked: ${fbErrors}`
        : "Could not find an enabled Next button — check the form for errors";
      stateError("Auto-publish: Next not found/enabled", new Error(reason));
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => { });
      const retried = await handleAutoRetry(job, reason);
      if (!retried) {
        setStatus(reason, "err");
        renderReview(job, { filled, missed, warnings });
      }
      return;
    }

    stateLog("Auto-publish: Next clicked, waiting for Publish button…");
    setStatus("Auto-publishing — waiting for Publish button…");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "next_clicked" }).catch(() => { });
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "clicking_next" }).catch(() => { });
    await sleep(500);

    const publishOutcome = await clickPublishUntilListingUrl(job);
    const listingUrl = publishOutcome.listingUrl;
    if (!listingUrl) {
      const reason = publishOutcome.blockReason
        ? `Facebook blocked publishing: ${publishOutcome.blockReason}`
        : "Publish was clicked, but DealerPilot could not confirm a live Marketplace listing URL. " +
        "Facebook may require one more Publish click or manual review.";
      stateError("Auto-publish: live listing not confirmed", new Error(reason));
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => { });
      const failResult = await send({ type: "FAIL_JOB", jobId: job.id, reason });
      await chrome.storage.local.remove("activeJob");
      if (!failResult || !failResult.ok) {
        setStatus("Auto-publish failed and backend fail-sync failed: " + (failResult && failResult.error), "err");
      } else {
        setStatus(reason, "err");
      }
      return;
    }

    stateLog("Auto-publish: complete - " + listingUrl);
    send({
      type: "SEND_JOB_EVENT", jobId: job.id, event: "listing_url_captured",
      details: listingUrl
    }).catch(() => { });

    // Wait a moment to ensure Facebook has finalized the post before notifying the backend
await new Promise((resolve) => setTimeout(resolve, 2000));
const r = await send({ type: "COMPLETE_JOB", jobId: job.id, listingUrl });

    // Always clear activeJob — Facebook published, so the slot is done regardless of
    // whether the backend acknowledged it cleanly. A 409/500 here must never leave
    // the extension stuck with a ghost activeJob that blocks the next vehicle.
    await chrome.storage.local.remove("activeJob");

    if (!r || !r.ok) {
      if (r?.error === CTXI) return;
      setStatus(
        "✓ Published on Facebook — backend sync issue (moved to Needs Review). " +
        "Open the popup to claim the next job.",
        "err",
      );
      return;
    }

    setTimeout(() => {
      send({ type: "POLL_NOW" }).catch(() => { });
    }, 1500);

    setStatus("✓ Published successfully!" + (listingUrl ? " Listing is live." : ""), "ok");
    clearOutput();
    jobBoxEl.innerHTML = `
      <div class="mai-job">
        <div class="mai-job-title">Published ✓</div>
        <div class="mai-job-meta">Job #${escapeHtml(String(job.id))} complete.${listingUrl ? ` <a href="${escapeHtml(listingUrl)}" target="_blank" style="color:#4ade80">View listing ↗</a>` : ""}</div>
        <div class="mai-job-meta">Checking the queue for the next eligible job.</div>
      </div>`;
    log("Auto-publish complete", { job, filled, missed, warnings, listingUrl });
  }

  // clickEnabledButtonByText — only clicks buttons that are NOT disabled.
  async function clickPublishUntilListingUrl(job) {
    const publishTexts = ["publish listing", "publish", "post listing", "post", "publicar", "publicar anuncio"];
    for (let attempt = 1; attempt <= 2; attempt++) {
      setStatus(attempt === 1
        ? "Auto-publishing - clicking Publish..."
        : "Auto-publishing - confirming final Publish...");
      const clicked = await clickButtonByText(publishTexts, attempt === 1 ? 15000 : 7000);
      if (!clicked) return null;

      stateLog(`Auto-publish: Publish click ${attempt}, waiting for Marketplace confirmation...`);
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "publish_clicked" }).catch(() => { });
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "clicking_publish" }).catch(() => { });
      await sleep(900);

      const outcome = await waitForPublishOutcome(attempt === 1 ? 12000 : 22000);
      if (outcome.listingUrl || outcome.blockReason) return outcome;

      // Some Facebook sessions show a final confirmation dialog with another
      // Publish/Post button. Try once more only when that button is still visible.
      if (!findEnabledButtonByText(publishTexts)) return outcome;
    }
    return { listingUrl: null, blockReason: null };
  }

  function findEnabledButtonByText(textOptions) {
    const candidates = Array.from(
      document.querySelectorAll('div[role="button"], button, [role="button"]'),
    );
    const normalizedOptions = textOptions.map(normalizeText);
    for (const el of candidates) {
      if (
        el.disabled ||
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("disabled")
      ) continue;
      const text = normalizeText(el.innerText || el.textContent || "");
      if (textOptions.some((t) => text === t || text === t + " ")) return el;
      if (normalizedOptions.some((t) => text === t || text === t + " ")) return el;
    }
    return null;
  }

  async function clickEnabledButtonByText(textOptions, timeoutMs) {
    const start = Date.now();
    const normalizedOptions = textOptions.map(normalizeText);
    while (Date.now() - start < timeoutMs) {
      const candidates = Array.from(
        document.querySelectorAll('div[role="button"], button, [role="button"]'),
      );
      for (const el of candidates) {
        // Skip disabled buttons
        if (
          el.disabled ||
          el.getAttribute("aria-disabled") === "true" ||
          el.hasAttribute("disabled")
        ) continue;
        const text = normalizeText(el.innerText || el.textContent || "");
        if (normalizedOptions.some((t) => text === t || text === t + " ")) {
          log("Auto-publish clicking:", text);
          el.click();
          return true;
        }
      }
      await sleep(400);
    }
    return false;
  }

  // clickButtonByText — legacy alias (used outside autoPublishFlow; keeps original behaviour)
  async function clickButtonByText(textOptions, timeoutMs) {
    return clickEnabledButtonByText(textOptions, timeoutMs);
  }

  // validateBeforeNext — checks the form has the minimum required data before
  // we try to click Next. Returns { ok, reason }.
  async function validateBeforeNext(missed = [], warnings = []) {
    // 1. Confirm at least one photo thumbnail is visible.
    //
    //    If uploadPhotos already confirmed thumbnails (via waitForPhotoThumbnails),
    //    skip the re-scan entirely — we trust the earlier result.  This prevents
    //    the false "0 photos" failure that fires when Facebook renders thumbnails
    //    in a way that only the earlier, broader scan detects.
    //
    //    If _photosConfirmed is false (e.g. upload was skipped or thumbnails timed
    //    out), run our own expanded scan with a short 15 s window.
    let hasPhoto = _photosConfirmed;

    if (!hasPhoto) {
      const PHOTO_POLL_MS = 15000;
      const photoStart = Date.now();
      // Expanded selector list — Facebook uses many different DOM patterns for
      // uploaded photo thumbnails and preview tiles.
      const THUMB_SELECTORS = [
        'img[src^="blob:"]',
        '[data-testid="media-attachment-delete-button"]',
        '[data-testid="media-attachment-preview"]',
        '[data-imagelocation]',
        '[data-visualcompletion*="media"]',
        '[aria-label*="photo" i] img',
        '[aria-label*="image" i] img',
        '[aria-label*="upload" i] img',
        'img[style*="object-fit"]',
        '[role="presentation"] img[src^="blob:"]',
      ];
      while (Date.now() - photoStart < PHOTO_POLL_MS) {
        // Collect all matching DOM thumbnail elements, deduped
        const thumbs = [
          ...new Set(THUMB_SELECTORS.flatMap((sel) => [...document.querySelectorAll(sel)])),
        ];
        if (thumbs.length > 0) { hasPhoto = true; break; }
        // Also accept Facebook's text counter ("1 photo", "3 photos", "Fotos · 7/20")
        const pageText = document.body.innerText || "";
        const countText =
          pageText.match(/(?:photos?|fotos?)\s*[·:\-]?\s*(\d+)\s*\/\s*\d+/i) ||
          pageText.match(/(\d+)\s*(?:photos?|fotos?)\b/i);
        if (countText && parseInt(countText[1], 10) > 0) { hasPhoto = true; break; }
        // Accept any naturally loaded image inside a photo container
        const uploadZone = document.querySelector(
          [
            '[aria-label*="photo" i]',
            '[aria-label*="foto" i]',
            '[aria-label*="image" i]',
            '[aria-label*="imagen" i]',
            '[aria-label*="upload" i]',
            '[aria-label*="subir" i]',
            '[aria-label*="agregar" i]',
          ].join(", "),
        );
        if (uploadZone) {
          const loaded = [...uploadZone.querySelectorAll("img")].filter(
            (img) => img.naturalWidth > 0 || img.src,
          );
          if (loaded.length > 0) { hasPhoto = true; break; }
        }
        await sleep(600);
      }
    }
    // Some localized Marketplace forms omit certain optional fields
    // entirely (no combobox / input rendered).  If a "missed" field
    // refers to a color field that does not exist in the current DOM,
    // treat it as non-blocking for the pre-Next validation. This prevents
    // blocking auto-publish when Facebook's form variant simply doesn't
    // render exterior/interior color controls.
    function fieldPresentOnPage(fieldName) {
      const lname = String(fieldName || "").toLowerCase();
      if (lname.includes("exterior") || lname.includes("interior") || lname.includes("color")) {
        // Check for any matching combobox or text input/label
        const cb = findCombobox(["exterior color", "exterior", "color", "color exterior", "interior color", "interior", "color interior"]);
        if (cb) return true;
        const txt = findField(["exterior color", "exterior", "color", "color exterior", "interior color", "interior", "color interior"]);
        if (txt) return true;
        // Finally, do a loose label scan for visible text
        const bodyText = (document.body && (document.body.innerText || document.body.textContent || "") || "").toLowerCase();
        if (bodyText.includes("color exterior") || bodyText.includes("color interior") || bodyText.includes("color")) return true;
        return false;
      }
      return true;
    }

    const effectiveMissed = missed.filter((m) => fieldPresentOnPage(m));

    if (!hasPhoto) {
      return {
        ok: false,
        reason: "Photo upload not confirmed by Facebook - refusing to continue to Next/Publish",
      };
    }

    // 2. Check Next button exists and is not disabled
    const NEXT_TEXTS = ["next", "continue", "next step", "siguiente", "continuar"];
    const NORMALIZED_NEXT_TEXTS = NEXT_TEXTS.map(normalizeText);
    const allButtons = Array.from(
      document.querySelectorAll('div[role="button"], button, [role="button"]'),
    );
    const nextBtn = allButtons.find((el) => {
      const t = normalizeText(el.innerText || el.textContent || "");
      return NORMALIZED_NEXT_TEXTS.some((n) => t === n || t === n + " ");
    });

    if (!nextBtn) {
      const fbErrors = scrapeFacebookErrors();
      return {
        ok: false,
        reason: fbErrors
          ? `Form not ready for Next: ${fbErrors}`
          : "Next button not found on page — form may not have loaded correctly",
      };
    }

    const isDisabled =
      nextBtn.disabled ||
      nextBtn.getAttribute("aria-disabled") === "true" ||
      nextBtn.hasAttribute("disabled");

    if (isDisabled) {
      const fbErrors = scrapeFacebookErrors();
      return {
        ok: false,
        reason: fbErrors
          ? `Next button is disabled: ${fbErrors}`
          : effectiveMissed.length > 0
            ? `Next button is disabled — required fields not selected: ${effectiveMissed.join(", ")}. Check those fields on the form.`
            : "Next button is disabled — Year and Make may not have been selected. Check those fields on the form.",
      };
    }

    return { ok: true };
  }

  // scrapeFacebookErrors — collect visible validation error messages from the form.
  function scrapeFacebookErrors() {
    const errorSelectors = [
      '[data-testid*="error" i]',
      '[aria-describedby*="error" i]',
      ".errorMessage",
      '[role="alert"]',
    ];
    const errors = [];
    for (const sel of errorSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const t = (el.innerText || el.textContent || "").trim();
        if (t && t.length < 200) errors.push(t);
      });
    }
    // Deduplicate
    return [...new Set(errors)].join("; ") || null;
  }

  function normalizePublishText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function visibleTextFrom(el) {
    const text = (el.innerText || el.textContent || "").trim();
    if (!text || text.length > 500) return null;
    const rect = el.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return null;
    return text;
  }

  function detectMarketplacePublishBlock() {
    const selectors = [
      '[role="alert"]',
      '[aria-live]',
      '[data-testid*="error" i]',
      '[data-testid*="toast" i]',
      '[aria-label*="error" i]',
      '[aria-label*="warning" i]',
      'div[role="dialog"]',
    ];
    const sourceTexts = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        const text = visibleTextFrom(el);
        if (text) sourceTexts.push(text);
      });
    }

    const formErrors = scrapeFacebookErrors();
    if (formErrors) sourceTexts.push(formErrors);

    const bodyText = (document.body?.innerText || "").slice(0, 12000);
    if (bodyText) sourceTexts.push(bodyText);

    const combined = normalizePublishText([...new Set(sourceTexts)].join(" "));
    if (!combined) return null;

    const checks = [
      {
        pattern: /(posting|listing|marketplace).{0,80}(limit|limited|too many)|you (have )?(reached|hit).{0,80}(limit|maximum)|limite.{0,80}(publicaciones|anuncios|marketplace)|demasiad[ao]s.{0,80}(publicaciones|anuncios)/,
        reason: "Facebook says this account reached a Marketplace posting/listing limit.",
      },
      {
        pattern: /(temporarily|temporary).{0,80}(blocked|restricted|limited)|blocked from (posting|listing)|restricted from (posting|listing)|bloquead[ao].{0,80}temporal|temporalmente.{0,80}(bloquead[ao]|restringid[ao]|limitad[ao])/,
        reason: "Facebook says this account or session is temporarily blocked/restricted from publishing.",
      },
      {
        pattern: /(can't|cannot|can not|couldn't|could not).{0,80}(publish|post|list)|not allowed.{0,80}(publish|post|list)|no (puedes|puede).{0,80}(publicar|crear)|no se pudo.{0,80}(publicar|crear)|no pudimos.{0,80}(publicar|crear)/,
        reason: "Facebook refused the publish action for this account/session.",
      },
      {
        pattern: /(marketplace access|access to marketplace).{0,80}(restricted|removed|limited|unavailable)|not eligible.{0,80}marketplace|acceso.{0,80}marketplace.{0,80}(restringid[ao]|limitad[ao]|no disponible)/,
        reason: "Facebook says Marketplace access is restricted or unavailable for this account.",
      },
      {
        pattern: /(duplicate|already posted|already listed|similar listing|listing already exists)|duplicad[ao]|ya (publicad[ao]|existe|listad[ao])/,
        reason: "Facebook rejected the listing as duplicate or already posted.",
      },
      {
        pattern: /(try again later|something went wrong|we're reviewing|under review|intenta(l[oa])? mas tarde|algo salio mal|en revision|estamos revisando)/,
        reason: "Facebook did not publish immediately and is asking to retry later or review the listing.",
      },
    ];

    for (const check of checks) {
      if (check.pattern.test(combined)) return check.reason;
    }

    return null;
  }

  async function waitForPublishOutcome(timeoutMs) {
    const startUrl = window.location.href;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cur = window.location.href;
      if (cur !== startUrl && cur.includes("/marketplace/item/")) {
        return { listingUrl: cur, blockReason: null };
      }
      const successEl =
        document.querySelector('[aria-label*="listed" i]') ||
        document.querySelector('[data-testid*="success" i]');
      if (successEl && window.location.href.includes("/marketplace/item/")) {
        return { listingUrl: window.location.href, blockReason: null };
      }
      const blockReason = detectMarketplacePublishBlock();
      if (blockReason) return { listingUrl: null, blockReason };
      await sleep(500);
    }
    const final = window.location.href;
    if (final !== startUrl && final.includes("/marketplace/item/")) {
      return { listingUrl: final, blockReason: null };
    }
    return { listingUrl: null, blockReason: detectMarketplacePublishBlock() };
  }

  function chips(items, cls) {
    if (!items.length) return '<span class="mai-chip">none</span>';
    return items.map((i) => `<span class="mai-chip ${cls}">${escapeHtml(i)}</span>`).join("");
  }

  function renderReview(job, result) {
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "ready_for_review" }).catch(() => { });
    showOutput(`
      <div class="mai-section-label">Filled successfully</div>
      <div class="mai-chips">${chips(result.filled, "ok")}</div>
      <div class="mai-section-label">Fields missing on page</div>
      <div class="mai-chips">${chips(result.missed, "miss")}</div>
      <div class="mai-section-label">Warnings</div>
      <div class="mai-chips">${chips(result.warnings, "warn")}</div>
      <div id="mai-review-actions" style="margin-top:12px"></div>
    `);
    const reviewActions = outputEl.querySelector("#mai-review-actions");

    reviewActions.appendChild(
      button("Mark Published", async () => {
        const listingUrl = window.prompt(
          "Paste the live Marketplace listing URL:",
          "",
        );
        if (listingUrl === null) return;
        if (!listingUrl.trim()) {
          setStatus("A Marketplace listing URL is required to mark this job Published.", "err");
          return;
        }
        setStatus("Marking job as published…");
        const r = await send({
          type: "COMPLETE_JOB",
          jobId: job.id,
          listingUrl: listingUrl.trim(),
        });
        if (!r || !r.ok) {
          if (r?.error === CTXI) return;
          setStatus("Failed to complete job: " + (r && r.error), "err");
          return;
        }
        await chrome.storage.local.remove("activeJob");
        setTimeout(() => {
          send({ type: "POLL_NOW" }).catch(() => { });
        }, 1500);
        setStatus("Job marked Published. Listing updated to Published. Claiming the next eligible job.", "ok");
        clearOutput();
        jobBoxEl.innerHTML = `<div class="mai-job"><div class="mai-job-title">Done ✓</div><div class="mai-job-meta">Job #${escapeHtml(
          String(job.id),
        )} published. Checking the queue for the next eligible job.</div></div>`;
      }),
    );

    reviewActions.appendChild(
      button(
        "Mark Failed",
        async () => {
          const reason = window.prompt("What went wrong? (failure reason)", "");
          if (reason === null) return;
          if (!reason.trim()) {
            setStatus("A failure reason is required.", "err");
            return;
          }
          setStatus("Marking job as failed…");
          const r = await send({ type: "FAIL_JOB", jobId: job.id, reason: reason.trim() });
          if (!r || !r.ok) {
            if (r?.error === CTXI) return;
            setStatus("Failed to update job: " + (r && r.error), "err");
            return;
          }
          await chrome.storage.local.remove("activeJob");
          setStatus("Job marked Failed. Reason saved.", "err");
          clearOutput();
          jobBoxEl.innerHTML = `<div class="mai-job"><div class="mai-job-title">Marked failed</div><div class="mai-job-meta">Job #${escapeHtml(
            String(job.id),
          )} · reason recorded.</div></div>`;
        },
        "mai-btn-secondary",
      ),
    );
  }

  // ==================================================================
  // Marketplace create page — job flow + debug button
  // ==================================================================
  if (isMarketplaceCreate) {
    chrome.storage.local.get("activeJob").then(async ({ activeJob }) => {
      if (activeJob) {
        // ── SAFETY: Validate activeJob against backend before auto-running ──
        // A stale/terminal job in chrome.storage.local must never trigger publishing.
        let jobIsActive = false;
        let jobStatus = null;
        try {
          const valRes = await send({ type: "VALIDATE_JOB", jobId: activeJob.id });
          if (valRes && valRes.ok && valRes.data) {
            jobStatus = valRes.data.status;
            const ACTIVE_STATUSES = [
              "Queued",
              "Scheduled",
              "Assigned",
              "Claimed",
              "Publishing",
              "Opening Facebook",
              "Filling Form",
              "Auto Publishing",
              "Ready for Review",
              "Retry",
            ];
            jobIsActive = ACTIVE_STATUSES.includes(jobStatus);
          }
          console.log(`[DealerPilot AI] [AUDIT] activeJob #${activeJob.id} validation: status=${jobStatus}, active=${jobIsActive}`);
        } catch (e) {
          console.warn("[DealerPilot AI] Could not validate activeJob against backend — aborting auto-start:", e);
        }

        if (!jobIsActive) {
          console.warn(
            `[DealerPilot AI] [AUDIT] Stale/invalid activeJob #${activeJob.id} (status=${jobStatus}) — cleared, auto-start blocked`,
          );
          await chrome.storage.local.remove("activeJob");
          // Fall through to else branch — show test listing button instead
          actionsEl.appendChild(
            button("Fill Test Listing (job cleared)", () => { }),
          );
          return;
        }

        // Job is confirmed active on backend — safe to auto-start
        console.log(`[DealerPilot AI] [AUDIT] activeJob #${activeJob.id} confirmed active (${jobStatus}) — auto-starting flow`);
        actionsEl.appendChild(
          button("Fill Marketplace Fields", () => runPublishingFlow(activeJob)),
        );
        setTimeout(() => runPublishingFlow(activeJob), 1200);
      } else {
        actionsEl.appendChild(
          button("Fill Test Listing", async () => {
            setStatus("Loading test listing…");

            const res = await send({ type: "GET_TEST_LISTING" });
            if (!res || !res.ok) {
              if (res?.error === CTXI) return;
              setStatus("Failed to fetch test listing: " + (res && res.error), "err");
              return;
            }

            const listing = res.data;
            const fill = {
              vehicleType: listing.vehicleType || "Car/Truck",
              year: listing.year ?? null,
              make: listing.make ?? "",
              model: listing.model ?? "",
              mileage: listing.mileage != null ? String(listing.mileage) : null,
              price: listing.price != null ? String(listing.price) : null,
              title: listing.title ?? "",
              description: listing.description ?? "",
              location: listing.location ?? null,
              condition: listing.condition ?? null,
              transmission: listing.transmission ?? null,
              fuelType: listing.fuelType ?? null,
              color: listing.color ?? null,
              bodyStyle: listing.bodyStyle ?? null,
              exteriorColor: listing.exteriorColor ?? listing.color ?? null,
              interiorColor: listing.interiorColor ?? null,
            };

            const syntheticJob = {
              id: 0,
              listingTitle: listing.title || "Test Listing",
              vehicleLabel: `${listing.year || ""} ${listing.make || ""} ${listing.model || ""}`.trim(),
              dealerName: "Test Mode",
              _prefetchedPayload: { fill, images: [] },
            };

            await runPublishingFlow(syntheticJob);
          }),
        );
      }

      // Debug button — always visible on create page
      const dbgBtn = button("🔍 DEBUG: Vehicle Type only", () => debugVehicleType(), "mai-btn-secondary");
      dbgBtn.title = "Selects Vehicle Type = Car/Truck then stops. Use Fill Marketplace Fields for the full workflow.";
      dbgBtn.style.cssText += ";margin-top:6px;border:2px dashed #e74c3c;color:#e74c3c;font-weight:700;font-size:10px;";
      actionsEl.appendChild(dbgBtn);
    });
  }

  // ==================================================================
  // Messenger AI — improved chat scraping + structured reply
  // ==================================================================
  if (isMessenger) {
    let lastReply = "";

    // ---- Structured chat scraping ----
    // Extracts individual messages with speaker attribution instead of raw innerText.
    function scrapeConversation() {
      const main = document.querySelector('[role="main"]') || document.body;

      // Try to detect buyer name from page heading
      let buyerName = "";
      const heading = main.querySelector('h1, [role="heading"]');
      if (heading) buyerName = (heading.textContent || "").trim().slice(0, 120);

      // Try structured message rows — Messenger renders each message in a [role="row"] or similar
      const messageEls = Array.from(
        main.querySelectorAll('[data-testid="message-container"], [class*="message"], [role="row"]')
      ).filter((el) => el.offsetParent !== null);

      let messages = [];

      if (messageEls.length > 4) {
        // Structured extraction: detect sent (you) vs received (buyer)
        for (const el of messageEls.slice(-40)) {
          const text = (el.innerText || el.textContent || "").trim();
          if (!text || text.length < 2) continue;

          // Heuristic: elements with aria-label containing "you" or sent indicators
          const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
          const isSent = ariaLabel.includes("you") || el.querySelector('[data-testid*="outgoing" i]');

          messages.push({
            speaker: isSent ? "Dealer" : (buyerName || "Buyer"),
            text: text.slice(0, 500),
          });
        }
      }

      // Fallback: raw text from [role="main"]
      if (messages.length < 2) {
        const rawText = (main.innerText || "").trim().slice(-4000);
        return { buyerName, rawText, messages: [] };
      }

      // Deduplicate consecutive identical messages
      const deduped = messages.filter((m, i) =>
        i === 0 || m.text !== messages[i - 1].text
      );

      return { buyerName, messages: deduped.slice(-30), rawText: "" };
    }

    // Detect listing context from the page (vehicle title, price, etc.)
    function detectListingContext() {
      const bodyText = (document.body.innerText || "").toLowerCase();
      const urlMatch = document.querySelectorAll('a[href*="/marketplace/item/"]');
      const listingUrl = urlMatch.length > 0 ? urlMatch[0].href : null;

      // Look for price patterns like $12,500 or $12500
      const priceMatch = bodyText.match(/\$[\d,]+/);
      const price = priceMatch ? priceMatch[0] : null;

      // Look for down payment pattern
      const downMatch = bodyText.match(/\$[\d,]+\s*(?:down|\/mo|per month)/i);
      const downPayment = downMatch ? downMatch[0] : null;

      // Vehicle title — look for pattern like "2020 Toyota Camry" in headings or links
      let vehicleTitle = null;
      const headings = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'));
      for (const h of headings) {
        const t = (h.textContent || "").trim();
        if (/\b(19|20)\d{2}\b/.test(t) && t.length > 8 && t.length < 120) {
          vehicleTitle = t;
          break;
        }
      }

      return { listingUrl, vehicleTitle, price, downPayment };
    }

    const readBtn = button("Read Chat & Suggest Reply", async () => {
      setStatus("Reading conversation…");

      const { buyerName, messages, rawText } = scrapeConversation();
      const context = detectListingContext();

      if (!messages.length && !rawText) {
        setStatus("No conversation text found.", "err");
        return;
      }

      // Build the payload — structured messages preferred over rawText
      const payload = {
        sourceUrl: href,
        buyerName: buyerName || undefined,
        detectedVehicleTitle: context.vehicleTitle || undefined,
        detectedMarketplaceListingUrl: context.listingUrl || undefined,
        marketplaceAskingPrice: context.price || undefined,
        marketplaceDownPayment: context.downPayment || undefined,
      };

      if (messages.length >= 2) {
        // Send structured messages
        payload.visibleMessages = messages.map((m) => `${m.speaker}: ${m.text}`);
        payload.chatText = messages.map((m) => `${m.speaker}: ${m.text}`).join("\n").slice(-4000);
      } else {
        payload.chatText = rawText;
      }

      const res = await send({ type: "SEND_MESSAGE_CONTEXT", payload });
      if (!res || !res.ok) {
        if (res?.error === CTXI) return;
        setStatus("Failed: " + (res && res.error), "err");
        return;
      }

      lastReply = res.data.suggestedReply;
      const msgCount = messages.length || "?";
      setStatus(`Reply ready (${msgCount} messages read). Lead saved to CRM.`, "ok");

      showOutput(
        `<div class="mai-line"><strong>Suggested reply:</strong></div>` +
        `<div class="mai-reply">${escapeHtml(lastReply)}</div>` +
        `${context.vehicleTitle ? `<div class="mai-line" style="opacity:.7;font-size:11px;margin-top:4px;">Vehicle: ${escapeHtml(context.vehicleTitle)}</div>` : ""}` +
        `<button class="mai-btn mai-btn-secondary" id="mai-insert">Insert Reply</button>` +
        `<button class="mai-btn mai-btn-secondary" id="mai-copy" style="margin-top:4px;">Copy Reply</button>`,
      );

      outputEl.querySelector("#mai-insert").addEventListener("click", () => insertReply(lastReply));
      outputEl.querySelector("#mai-copy").addEventListener("click", () => {
        navigator.clipboard.writeText(lastReply).then(() => {
          setStatus("Reply copied to clipboard.", "ok");
        }).catch(() => {
          setStatus("Could not copy — use the Insert Reply button instead.", "err");
        });
      });
    });

    actionsEl.appendChild(readBtn);
  }

  function insertReply(text) {
    // Try contenteditable first (Messenger's message box)
    const box =
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"][aria-label*="Message" i]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea[aria-label*="Message" i]') ||
      document.querySelector('textarea');

    if (!box) {
      setStatus("Could not find the message box.", "err");
      return;
    }

    if (box.tagName === "TEXTAREA") {
      box.focus();
      setNativeValue(box, text);
    } else {
      // contenteditable — use execCommand for reliable React compatibility
      box.focus();
      // Select all existing content first (handles any placeholder text)
      document.execCommand("selectAll", false, undefined);
      document.execCommand("insertText", false, text);
    }
    setStatus("Reply inserted. Review it before sending — Send was NOT clicked.", "ok");
  }

  // ==================================================================
  // DEBUG: Vehicle Type only — probes all 7 strategies and reports
  // which one works, or shows the operator exactly what the DOM contains.
  // ==================================================================
  async function debugVehicleType() {
    const VT_KWS = ["vehicle type", "tipo de veh", "category", "tipo"];

    // ── Step 1: Inventory of all comboboxes ───────────────────────────
    setStatus('[DEBUG] Step 1: inventorying [role="combobox"] elements…');
    await sleep(400);

    const allBoxes = Array.from(document.querySelectorAll('[role="combobox"]'));
    console.log(`[VT-DEBUG] Total [role="combobox"] found: ${allBoxes.length}`);
    allBoxes.forEach((el, i) => {
      const labelledBy = el.getAttribute("aria-labelledby") || "";
      let resolvedLabel = "";
      if (labelledBy) {
        const lbEl = document.getElementById(labelledBy);
        if (lbEl) resolvedLabel = (lbEl.innerText || lbEl.textContent || "").trim();
      }
      const info =
        `  [${i}]` +
        ` text="${(el.innerText || el.textContent || "").trim().slice(0, 60)}"` +
        ` aria-label="${el.getAttribute("aria-label") || ""}"` +
        ` labelledby="${labelledBy}" → "${resolvedLabel}"` +
        ` expanded="${el.getAttribute("aria-expanded") || ""}"` +
        ` owns="${el.getAttribute("aria-owns") || ""}"` +
        ` controls="${el.getAttribute("aria-controls") || ""}"`;
      console.log(info);
      el.style.outline = "2px dashed orange";
    });

    // ── Step 2: Locate the vehicle-type combobox ──────────────────────
    setStatus('[DEBUG] Step 2: finding Vehicle Type combobox by keywords…');
    const targetEl = findCombobox(VT_KWS);
    if (!targetEl) {
      console.log("[VT-DEBUG] Vehicle Type combobox NOT found by keywords — will try first visible");
      setStatus("[DEBUG] No keyword-match combobox. Trying first visible combobox…");
    } else {
      console.log("[VT-DEBUG] Vehicle Type combobox FOUND:", targetEl);
      targetEl.style.outline = "4px solid red";
      targetEl.style.outlineOffset = "2px";
      setStatus("[DEBUG] Step 2: combobox highlighted RED");
    }

    const cb = targetEl || Array.from(document.querySelectorAll('[role="combobox"]')).find((el) => el.offsetParent);

    if (!cb) {
      setStatus("[DEBUG] No combobox found at all — check console (F12).", "err");
      return;
    }

    // ── Step 3: Click and probe with all option-role variants ─────────
    setStatus("[DEBUG] Step 3: clicking combobox and scanning for options…");
    cb.click();
    await sleep(400);

    // Collect all candidate option elements across roles
    const roleSelectors = [
      '[role="option"]',
      '[role="menuitem"]',
      '[role="listitem"]',
    ];
    let allOpts = [];
    for (const sel of roleSelectors) {
      const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (els.length) {
        console.log(`[VT-DEBUG] Found ${els.length} visible ${sel} elements`);
        allOpts = allOpts.concat(els);
      }
    }
    // Also check listbox / dialog portals
    const popup =
      document.querySelector('[role="listbox"]') ||
      document.querySelector('[role="dialog"][aria-modal="true"]') ||
      document.querySelector('[aria-modal="true"]');
    if (popup) {
      const liEls = Array.from(popup.querySelectorAll('li, [data-value]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (liEls.length) {
        console.log(`[VT-DEBUG] Found ${liEls.length} li/data-value elements in popup`);
        allOpts = allOpts.concat(liEls);
      }
    }

    // Wait up to 8 s for delayed options
    if (!allOpts.length) {
      console.log("[VT-DEBUG] No options yet — waiting up to 8 s…");
      setStatus("[DEBUG] Waiting for options to appear…");
      allOpts = await scanForAnyOptions(8000, "debug");
    }

    console.log(`[VT-DEBUG] Final option count: ${allOpts.length}`);
    allOpts.forEach((o, i) =>
      console.log(`  [${i}] role="${o.getAttribute("role") || o.tagName}" text="${(o.innerText || o.textContent || "").trim().slice(0, 80)}"`)
    );

    if (!allOpts.length) {
      // Show aria attributes to help diagnose
      const ariaOwns = cb.getAttribute("aria-owns");
      const ariaCtrl = cb.getAttribute("aria-controls");
      const expanded = cb.getAttribute("aria-expanded");
      console.log(`[VT-DEBUG] aria-expanded=${expanded} aria-owns=${ariaOwns} aria-controls=${ariaCtrl}`);
      setStatus(
        `[DEBUG] No options appeared (expanded=${expanded}, owns=${ariaOwns || "—"}). ` +
        "Check console (F12) for DOM details.",
        "err",
      );
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return;
    }

    // ── Step 4: Try to pick "Car/Truck" or first available option ─────
    const VT_TARGET = "Car/Truck";
    const getText = (o) => (o.innerText || o.textContent || "").toLowerCase().trim();
    const needle = VT_TARGET.toLowerCase();
    const ALIASES = ["car/truck", "cars & trucks", "cars and trucks", "vehicle", "automobile"];
    const pick =
      allOpts.find((o) => getText(o) === needle) ||
      allOpts.find((o) => getText(o).includes(needle)) ||
      allOpts.find((o) => needle.includes(getText(o)) && getText(o).length > 2) ||
      allOpts.find((o) => ALIASES.some((a) => getText(o).includes(a))) ||
      allOpts[0];

    const pickedText = (pick.innerText || pick.textContent || "").trim();
    console.log(`[VT-DEBUG] Selecting: "${pickedText}"`);
    setStatus(`[DEBUG] Clicking "${pickedText}"…`);
    pick.click();
    await sleep(400);

    setStatus(
      `[DEBUG] ✓ Selected "${pickedText}". ` +
      `Watch if Year / Make / Model dropdowns appear. WORKFLOW STOPPED.`,
      "ok",
    );
    console.log(
      `[VT-DEBUG] Done — clicked "${pickedText}". ` +
      `Combobox count was ${allBoxes.length}. ` +
      `All option texts: ${allOpts.map((o) => `"${getText(o)}"`).join(", ")}`,
    );
  }

  log("Panel loaded v1.3.9", { isMessenger, isMarketplaceCreate });
})();
