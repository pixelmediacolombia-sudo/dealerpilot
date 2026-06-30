(function () {
  if (window.__marketplaceAiPanelLoaded) return;
  window.__marketplaceAiPanelLoaded = true;

  const log = (...args) => console.log("[DealerPilot AI]", ...args);

  // ---- Workflow step instrumentation ----
  // Logs [STATE] / [ERROR] to the console and writes the current step to
  // chrome.storage.local so Debug Mode in the popup shows it in real time.
  function stateLog(msg) {
    console.log(`[DealerPilot AI][STATE] ${msg}`);
    chrome.storage.local
      .set({ workflowStep: msg, workflowStepAt: new Date().toISOString() })
      .catch(() => {});
  }

  function stateError(context, err) {
    const detail = err ? `: ${err.message || String(err)}` : "";
    console.error(`[DealerPilot AI][ERROR] ${context}${detail}`, err || "");
    chrome.storage.local
      .set({ workflowStep: `\u274C ${context}`, workflowStepAt: new Date().toISOString() })
      .catch(() => {});
  }

  // ---- Safe runtime communication ----
  // Sentinel returned (never thrown) when Chrome invalidates the extension context.
  const CTXI = "EXTENSION_CONTEXT_INVALIDATED";
  const BUILD_LABEL = "APP_CONTROLLED_PUBLISHING_1.0.8";

  function _runtimeAlive() {
    try {
      const id = (typeof chrome !== "undefined") && chrome.runtime && chrome.runtime.id;
      console.log(`[DealerPilot] Runtime ID: ${id || "missing"}`);
      return !!id;
    } catch (_) {
      console.log("[DealerPilot] Runtime ID: missing (threw during check)");
      return false;
    }
  }

  function showContextInvalidated() {
    console.log("[DealerPilot] Extension context invalidated. Refresh Facebook tab.");
    // Update the floating panel status if it is already in the DOM.
    try {
      setStatus(
        "DealerPilot extension was updated. Please fully refresh this Facebook tab and try again.",
        "err",
      );
    } catch (_) {}
    // Inject a persistent top-of-page banner so the user cannot miss it.
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
    } catch (_) {}
  }

  // Every chrome.runtime.sendMessage call in this script goes through here.
  // It NEVER throws — always resolves, so callers can simply check res.ok.
  function send(message) {
    if (!_runtimeAlive()) {
      showContextInvalidated();
      return Promise.resolve({ ok: false, error: CTXI });
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          // Must read lastError synchronously inside the callback.
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            const msg = lastErr.message || "";
            console.log(`[DealerPilot] sendMessage lastError: ${msg}`);
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
        console.log(`[DealerPilot] sendMessage threw: ${msg}`);
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
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
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
    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function findField(keywords) {
    const fields = Array.from(
      document.querySelectorAll(
        'input[type="text"], input:not([type]), input[type="number"], textarea',
      ),
    ).filter((el) => el.offsetParent !== null);
    for (const kw of keywords) {
      const match = fields.find((el) => labelText(el).includes(kw));
      if (match) return match;
    }
    return null;
  }

  // Wait for a field to appear in the DOM (React may render it after the initial
  // page settle). Polls every 300 ms for up to maxWaitMs before giving up.
  function waitForField(keywords, maxWaitMs = 5000) {
    return new Promise((resolve) => {
      const interval = 300;
      let elapsed = 0;
      const tick = () => {
        const field = findField(keywords);
        if (field) { resolve(field); return; }
        elapsed += interval;
        if (elapsed >= maxWaitMs) { resolve(null); return; }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  // ---- Select-field helpers (Facebook progressive dropdowns) ----

  // Simple delay — used between state-machine steps.
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Pause for React to commit its state update and re-render new fields.
  function waitForReactRender(ms) { return sleep(ms === undefined ? 900 : ms); }

  // ---- ARIA combobox helpers ----
  // Facebook Marketplace renders dropdowns as [role="combobox"], NOT <select>.
  // All dropdown interaction goes through these helpers exclusively.

  // Find a visible [role="combobox"] whose innerText, aria-label, or resolved
  // aria-labelledby label text contains any of the given keywords.
  function findCombobox(keywords) {
    const boxes = Array.from(document.querySelectorAll('[role="combobox"]'))
      .filter((el) => el.offsetParent !== null);
    for (const el of boxes) {
      const inner      = (el.innerText || el.textContent || "").toLowerCase().trim();
      const ariaLabel  = (el.getAttribute("aria-label") || "").toLowerCase();
      const labelledBy = el.getAttribute("aria-labelledby");
      let   labelTxt   = "";
      if (labelledBy) {
        const lbEl = document.getElementById(labelledBy);
        if (lbEl) labelTxt = (lbEl.innerText || lbEl.textContent || "").toLowerCase().trim();
      }
      const combined = `${inner} ${labelTxt} ${ariaLabel}`;
      if (keywords.some((k) => combined.includes(k.toLowerCase()))) return el;
    }
    return null;
  }

  // Poll until a matching [role="combobox"] appears in the DOM.
  // Logs every poll cycle and every timeout.
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

  // After clicking a combobox, poll until [role="option"] items appear.
  // stepLabel is used only for logging. Signature kept at (maxWaitMs) to match v1.0.4
  // call convention — stepLabel is an optional second argument for log context only.
  function waitForOptions(maxWaitMs, stepLabel) {
    const limit = maxWaitMs === undefined ? 8000 : maxWaitMs;
    const tag   = stepLabel || "options";
    return new Promise((resolve) => {
      const interval = 150;
      let elapsed = 0;
      const tick = () => {
        const opts = Array.from(document.querySelectorAll('[role="option"]'))
          .filter((el) => el.offsetParent !== null);
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
          // Dump popup container HTML to help diagnose Facebook DOM changes
          const popup =
            document.querySelector('[role="listbox"]') ||
            document.querySelector('[role="dialog"]')  ||
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

  // Restore generic combobox-count wait (v1.0.4 cascade signal for Vehicle Type / Year).
  // Polls until the combobox count increases, indicating React rendered a new dropdown.
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

  // After selecting Make: DOM-poll until the Model combobox specifically appears.
  // Polls every 250 ms, times out after 20 s. Logs every cycle.
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

  // After selecting Model: DOM-poll until a specific text input appears.
  // Polls every 250 ms, times out after 20 s. Logs every cycle.
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
  //
  // Facebook is a single-page app. The content script only loads once per tab
  // even as the user navigates to /marketplace, /marketplace/create/vehicle, etc.
  // We must re-check the URL on every navigation event and persist the result.

  function detectPageState() {
    const hostname = location.hostname;
    const pathname = location.pathname;
    const href     = location.href;
    const now      = new Date().toISOString();

    // Marketplace: any facebook.com URL containing /marketplace in the path
    const isMarketplaceNow =
      hostname.includes("facebook.com") && pathname.includes("/marketplace");

    // Messenger: messenger.com host OR facebook.com/messages
    const isMessengerNow =
      hostname.includes("messenger.com") || /\/messages\b/.test(pathname);

    chrome.storage.local
      .set({
        marketplaceDetected:   isMarketplaceNow,
        marketplacePath:       isMarketplaceNow ? pathname : null,
        marketplaceUrl:        isMarketplaceNow ? href : null,
        marketplaceDetectedAt: now,
        messengerDetected:     isMessengerNow,
      })
      .catch(() => {});

    log("Marketplace detection updated:", isMarketplaceNow, "|", href);

    return { isMarketplaceNow, isMessengerNow };
  }

  // Run immediately, then again at delays to catch late SPA renders
  const _initial = detectPageState();
  [500, 1500, 3000].forEach((ms) => setTimeout(detectPageState, ms));

  // Patch history API so pushState/replaceState SPA navigation is caught
  (function patchHistory() {
    function wrap(origFn) {
      return function (...args) {
        const result = origFn.apply(this, args);
        setTimeout(detectPageState, 0);
        return result;
      };
    }
    history.pushState    = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
  })();
  window.addEventListener("popstate", detectPageState);

  // MutationObserver fallback: catches URL changes that bypass history API
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      detectPageState();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  // Stable variables used by the rest of this script (evaluated once at load time)
  const href        = location.href;
  const isMessenger = _initial.isMessengerNow;
  // Show the fill/publish panel only on the create form, not on browse pages
  const isMarketplaceCreate = /\/marketplace\/create/.test(location.pathname);

  // ---- Panel UI ----
  const panel = document.createElement("div");
  panel.id = "mai-panel";
  panel.innerHTML = `
    <div id="mai-header">
      <span id="mai-dot"></span>
      <span id="mai-title">DealerPilot AI</span>
      <span style="font-size:9px;opacity:.55;margin-left:4px;letter-spacing:.02em;">BUILD: ${BUILD_LABEL}</span>
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
    if (res && res.error === CTXI) return; // context invalidated — banner already shown
    if (res && res.ok) {
      dotEl.classList.add("mai-on");
      setStatus("Connected to backend", "ok");
    } else {
      dotEl.classList.add("mai-off");
      setStatus("Backend unreachable. Set the URL in the extension popup.", "err");
    }
  });

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

    jobBoxEl.innerHTML = `
      <div class="mai-job">
        <div class="mai-job-title">${escapeHtml(job.listingTitle || "Publishing job")}</div>
        <div class="mai-job-meta">${escapeHtml(job.vehicleLabel || "")}${
          job.dealerName ? " · " + escapeHtml(job.dealerName) : ""
        } · Job #${escapeHtml(String(job.id))}</div>
      </div>`;

    let fill, images;
    if (job._prefetchedPayload) {
      // Pre-fetched path: called from "Fill Test Listing" with data already in hand
      fill   = job._prefetchedPayload.fill;
      images = job._prefetchedPayload.images ?? [];
    } else {
      setStatus("Loading listing data…");
      const res = await send({ type: "GET_JOB_PAYLOAD", jobId: job.id });
      if (!res || !res.ok) {
        if (res?.error === CTXI) return; // context invalidated — do not continue workflow
        // Job was deleted from the backend (e.g. operator cleared the queue).
        // Auto-clear the stale activeJob so the extension can pick up a fresh job.
        const is404 = res && typeof res.error === "string" && res.error.includes("404");
        if (is404) {
          await chrome.storage.local.remove(["activeJob", "lastClaimedJob"]);
          setStatus("Job #" + job.id + " no longer exists — queue was cleared. Reopen the extension popup to start a new job.", "err");
        } else {
          setStatus("Could not load job data: " + (res && res.error), "err");
        }
        return;
      }
      fill   = res.data.fill;
      images = res.data.images;
    }

    const filled   = [];
    const missed   = [];
    const warnings = [];

    // ------------------------------------------------------------------
    // selectComboboxStep — interact with a Facebook [role="combobox"].
    //
    // afterWait controls what happens after an option is clicked:
    //   'generic'              → waitForMoreComboboxes(countBefore, 6000)
    //                            (v1.0.4 behaviour — used for Vehicle Type and Year)
    //   { label, keywords }    → waitForNamedCombobox(label, keywords, 20000)
    //                            (DOM-poll for a specific next combobox — used for Make)
    //   false / null           → sleep(400)  (no cascade expected — used for Model)
    // ------------------------------------------------------------------
    async function selectComboboxStep(label, keywords, targetValue, afterWait) {
      console.log(`[STEP] ${label}`);
      stateLog(`Step: ${label}`);

      if (targetValue === null || targetValue === undefined || targetValue === "") {
        stateLog(`Skipping "${label}" — no value in listing data`);
        warnings.push(`${label}: no value in listing data — skipped`);
        return false;
      }

      setStatus(`Waiting for "${label}" combobox…`);
      const combobox = await waitForCombobox(keywords);
      if (!combobox) {
        stateError(`Could not find ${label} combobox`);
        missed.push(label);
        warnings.push(`${label}: combobox did not appear`);
        return false;
      }
      console.log(`[FOUND] ${label} combobox`, combobox);
      stateLog(`${label} combobox found`);

      // Track combobox count before click (used by 'generic' afterWait).
      const countBefore = document.querySelectorAll('[role="combobox"]').length;

      console.log(`[CLICK] ${label} combobox (countBefore=${countBefore})`);
      combobox.click();
      console.log(`[ACTIVE] activeElement after combobox click:`, document.activeElement);
      stateLog(`${label} — combobox clicked, waiting for options`);
      setStatus(`Opened "${label}" — waiting for options…`);

      // waitForOptions uses the original v1.0.4 no-argument convention.
      // stepLabel is passed as the optional 2nd arg for log context only.
      const options = await waitForOptions(undefined, label);
      if (!options.length) {
        stateError(`No [role="option"] elements appeared for ${label}`);
        missed.push(label);
        warnings.push(`${label}: no options appeared after clicking combobox`);
        return false;
      }

      // ---- Fuzzy option matching ----
      // Facebook changes dropdown labels frequently. Try multiple strategies
      // before falling back to the first available option.
      const needle   = String(targetValue).toLowerCase().trim();
      const getText  = (o) => (o.innerText || o.textContent || "").toLowerCase().trim();
      // Strip all non-alphanumeric characters for normalised comparison
      const norm     = (s) => s.replace(/[^a-z0-9]/g, "");

      // Vehicle-type alias set — Facebook has used many different labels
      const VT_ALIASES = [
        "car/truck", "cars & trucks", "cars and trucks",
        "vehicle", "car", "truck", "automobile", "cars", "trucks",
      ];

      let pick =
        // 1. Exact text match
        options.find((o) => getText(o) === needle) ||
        // 2. Option text contains needle
        options.find((o) => getText(o).includes(needle)) ||
        // 3. Needle contains option text (short label inside longer target)
        options.find((o) => needle.includes(getText(o)) && getText(o).length > 2) ||
        // 4. Normalised exact match (ignores punctuation / spacing)
        options.find((o) => norm(getText(o)) === norm(needle)) ||
        // 5. Vehicle-type aliases (Facebook UI label varies by locale/experiment)
        (label === "vehicle type"
          ? options.find((o) => VT_ALIASES.some((a) => getText(o).includes(a)))
          : undefined);

      if (!pick) {
        // 6. Fallback: select first available option so the cascade can continue.
        //    Logs a clear warning so the operator knows a guess was made.
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
      console.log(`[ACTIVE] activeElement after option click:`, document.activeElement);
      filled.push(label);
      log(`${label} → "${pickedText}"`);

      // ---- Post-selection wait ----
      if (afterWait === "generic") {
        // v1.0.4 behaviour: wait for the combobox count to increase (React cascade).
        stateLog(`Waiting for next combobox after ${label} (generic count wait)`);
        const appeared = await waitForMoreComboboxes(countBefore, 6000);
        if (!appeared) {
          console.log(`[WARN] combobox count did not increase after selecting ${label}`);
        }
      } else if (afterWait && typeof afterWait === "object" && afterWait.keywords) {
        // Specific named-combobox DOM-poll (Make → Model).
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
    // fillStep — wait for a text input / textarea, write the value, and
    // fire the full event trio so React validates the field.
    // ------------------------------------------------------------------
    async function fillStep(label, keywords, value) {
      if (value === null || value === undefined || value === "") {
        stateLog(`Skipping "${label}" — no value in listing data`);
        warnings.push(`${label}: no value in listing data — skipped`);
        return;
      }
      stateLog(`Filling ${label}`);
      const el = await waitForField(keywords, 6000);
      if (el) {
        setNativeValue(el, String(value));
        filled.push(label);
        log(`${label} filled`);
      } else {
        stateError(`Could not find ${label} field`);
        missed.push(label);
      }
    }

    // ==================================================================
    // STATE MACHINE — sequential progressive form fill
    //
    // Phase 1: Dropdown cascade.  Facebook only renders Year after Vehicle
    // Type is chosen, Make after Year, Model after Make, and the remaining
    // text fields only after Model.  Never proceed to the next step until
    // the current one resolves.
    //
    // Phase 2: Text fields that appear after the dropdown cascade.
    //
    // Phase 3: Optional dropdowns (may or may not appear).
    // ==================================================================

    try {

      // ---- Phase 1: Dropdown cascade ----

      stateLog("Phase 1 starting — dropdown cascade");

      // Vehicle Type — use generic count-based wait (v1.0.4 behaviour).
      // Facebook renders Year only after Vehicle Type is committed.
      setStatus("Step 1 of 4: Selecting vehicle type…");
      await selectComboboxStep(
        "vehicle type",
        ["vehicle type", "type of vehicle", "category"],
        fill.vehicleType || "Car/Truck",
        "generic", // waitForMoreComboboxes — restored v1.0.4 behaviour
      );

      // Year — generic count-based wait; Make appears after Year is committed.
      setStatus("Step 2 of 4: Selecting year…");
      await selectComboboxStep(
        "year",
        ["year"],
        fill.year ? String(fill.year) : null,
        "generic", // waitForMoreComboboxes — restored v1.0.4 behaviour
      );

      // Make — generic count-based wait (same as Vehicle Type / Year).
      // Model is a plain text input — NOT a combobox — so we do NOT poll for
      // a model combobox here.  The generic wait lets React settle after Make.
      setStatus("Step 3 of 4: Selecting make…");
      await selectComboboxStep(
        "make",
        ["make"],
        fill.make,
        "generic", // waitForMoreComboboxes — v1.0.4 behaviour restored for Make
      );

      // Model — Facebook renders this as a plain <input type="text"> inside a
      // <label><span>Model</span><input …></label>, NOT a [role="combobox"].
      // Poll for that input (up to 20 s, 250 ms ticks) then fill it with the
      // React-safe native setter so React's onChange fires correctly.
      setStatus("Step 4 of 4: Filling model…");
      console.log("[STEP] Model (text input — not a combobox)");
      stateLog("Waiting for Model text input");
      const modelInput = await waitForNamedField(
        "model",
        ["model"],
        20000,
      );
      if (modelInput) {
        console.log("[FOUND] Model text input", modelInput);
        setNativeValue(modelInput, String(fill.model || ""));
        modelInput.dispatchEvent(new Event("input",  { bubbles: true }));
        modelInput.dispatchEvent(new Event("change", { bubbles: true }));
        modelInput.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        filled.push("model");
        log(`model → "${fill.model}"`);
      } else {
        console.log("[WARN] Model text input did not appear within 20 s");
        missed.push("model");
        warnings.push("model: text input did not appear after Make selection");
      }

      // ---- Phase 2: Text fields ----

      stateLog("Phase 2 starting — text fields");
      setStatus("Filling mileage, price, title, description…");

      await fillStep("mileage", [
        "mileage", "odometer", "miles", "vehicle mileage",
        "number of miles", "mileage (optional)", "odometer reading",
      ], fill.mileage);

      // Price field: always use fill.price (= marketplaceDisplayedPrice from the server).
      // For DOWN_PAYMENT vehicles this is the down payment, NOT the full vehicle price.
      if (fill.priceMode === "DOWN_PAYMENT") {
        log(`pricing mode: DOWN_PAYMENT — posting $${fill.marketplaceDisplayedPrice ?? fill.price} (down payment), NOT full price $${fill.actualVehiclePrice ?? "?"}`);
      } else {
        log(`pricing mode: FULL_PRICE — posting $${fill.price}`);
      }
      await fillStep("price", [
        "price", "listing price", "asking price",
      ], fill.price);

      // Title — Facebook may auto-generate it from Year/Make/Model.
      // Try to find a writable title input; if absent, check for a read-only
      // preview/auto-generated title and mark accordingly rather than "missed".
      {
        const TITLE_KWS = [
          "title", "listing title", "what are you selling",
          "vehicle name", "add a title", "item title",
        ];
        console.log("[STEP] Title");
        stateLog("Checking for title field");
        const titleEl = await waitForField(TITLE_KWS, 8000);
        if (titleEl) {
          console.log("[FOUND] Title input", titleEl);
          if (fill.title) {
            setNativeValue(titleEl, String(fill.title));
            titleEl.dispatchEvent(new Event("input",  { bubbles: true }));
            titleEl.dispatchEvent(new Event("change", { bubbles: true }));
            titleEl.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
            filled.push("title");
            log(`title → "${fill.title}"`);
          } else {
            stateLog("title field found but no value in listing data — skipped");
            warnings.push("title: field exists but no value in listing data");
          }
        } else {
          // No writable title input — Facebook likely auto-generated the title
          // from the Year/Make/Model selections.  This is normal behaviour on
          // the vehicle listing form.  Do NOT add to missed[].
          console.log("[INFO] Title input not found — Facebook may have auto-generated it from Year/Make/Model");
          stateLog("title auto generated by Facebook");
          filled.push("title (auto generated)");
          log("title: auto generated by Facebook from Year/Make/Model");
        }
      }

      await fillStep("description", [
        "description", "describe", "details",
      ], fill.description);

      await fillStep("vin", [
        "vin", "vin number", "vehicle identification number",
      ], fill.vin);

      await fillStep("location", [
        "location", "city", "where",
      ], fill.location);

      // ---- Phase 3: Optional dropdowns (silently skip if no data or field absent) ----

      stateLog("Phase 3 starting — optional dropdowns");
      await selectComboboxStep("condition",    ["condition"],    fill.condition,    false);
      await selectComboboxStep("transmission", ["transmission"], fill.transmission, false);
      await selectComboboxStep("fuel type",    ["fuel"],         fill.fuelType,     false);
      await selectComboboxStep("color",        ["color"],        fill.color,        false);
      await selectComboboxStep("body style",   ["body style"],   fill.bodyStyle,    false);

      stateLog("Workflow Complete");

    } catch (err) {
      stateError("Unexpected error in publishing workflow", err);
      setStatus("Workflow error: " + ((err && err.message) || String(err)), "err");
      log("Publishing flow crashed", err);
    }

    // ---- Done ----

    if (images && images.length) {
      warnings.push(
        `${images.length} photo(s) available — add them manually (drag-drop not automated).`,
      );
    }

    setStatus("Fields filled. Review, then mark the result. Publish was NOT clicked.", "ok");
    renderReview(job, { filled, missed, warnings });
    log("Publishing fill complete", { job, filled, missed, warnings });
  }

  function chips(items, cls) {
    if (!items.length) return '<span class="mai-chip">none</span>';
    return items.map((i) => `<span class="mai-chip ${cls}">${escapeHtml(i)}</span>`).join("");
  }

  function renderReview(job, result) {
    // Signal the backend that form filling is complete and operator review is needed.
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "ready_for_review" }).catch(() => {});
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
          "Paste the Marketplace listing URL (optional, leave blank to skip):",
          "",
        );
        if (listingUrl === null) return;
        setStatus("Marking job as published…");
        const r = await send({
          type: "COMPLETE_JOB",
          jobId: job.id,
          listingUrl: listingUrl.trim() || undefined,
        });
        if (!r || !r.ok) {
          if (r?.error === CTXI) return;
          setStatus("Failed to complete job: " + (r && r.error), "err");
          return;
        }
        await chrome.storage.local.remove("activeJob");
        setStatus("Job marked Published. Listing updated to Published.", "ok");
        clearOutput();
        jobBoxEl.innerHTML = `<div class="mai-job"><div class="mai-job-title">Done ✓</div><div class="mai-job-meta">Job #${escapeHtml(
          String(job.id),
        )} published. Open the popup to claim the next job.</div></div>`;
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
  // DEBUG: Vehicle Type only — stops after selecting Vehicle Type.
  // Logs every step and every dropdown found on the page.
  // ==================================================================
  async function debugVehicleType() {
    const TARGET_VALUE = "Car/Truck";

    // ── STEP 1: enumerate every [role="combobox"] on the page ──────────
    console.log("[STEP 1] Waiting for Vehicle Type dropdown");
    setStatus("[DEBUG] Step 1: Scanning for [role=\"combobox\"] elements…");
    await sleep(400);

    const allBoxes = Array.from(document.querySelectorAll('[role="combobox"]'));
    console.log(`[STEP 1] Total [role="combobox"] found: ${allBoxes.length}`);
    allBoxes.forEach((el, i) => {
      const labelledBy = el.getAttribute("aria-labelledby");
      let resolvedLabel = "";
      if (labelledBy) {
        const lbEl = document.getElementById(labelledBy);
        if (lbEl) resolvedLabel = (lbEl.innerText || lbEl.textContent || "").trim();
      }
      console.log(
        `  [${i}]` +
        ` text="${(el.innerText || el.textContent || "").trim().slice(0, 60)}"` +
        ` aria-label="${el.getAttribute("aria-label") || ""}"` +
        ` aria-labelledby="${labelledBy || ""}" → "${resolvedLabel}"` +
        ` placeholder="${el.getAttribute("placeholder") || ""}"` +
        ` role="${el.getAttribute("role") || ""}"` +
        ` aria-expanded="${el.getAttribute("aria-expanded") || ""}"`,
      );
      el.style.outline = "2px dashed orange";
    });

    // ── STEP 2: locate the Vehicle Type combobox ────────────────────────
    const VT_KEYWORDS = ["vehicle type", "type of vehicle", "category"];
    const targetEl = findCombobox(VT_KEYWORDS);

    if (!targetEl) {
      console.log("[ERROR] [STEP 2] Vehicle Type combobox NOT FOUND");
      console.log("[DEBUG] All combobox texts:", allBoxes.map((el) =>
        (el.innerText || el.textContent || "").trim().slice(0, 60)
      ));
      setStatus("[ERROR] Vehicle Type combobox NOT FOUND. Check console (F12).", "err");
      return;
    }

    console.log("[STEP 2] Vehicle Type combobox FOUND:", targetEl);
    targetEl.style.outline      = "4px solid red";
    targetEl.style.outlineOffset = "2px";
    setStatus("[DEBUG] Step 2: Combobox found — highlighted RED");

    // ── STEP 3: click to open ───────────────────────────────────────────
    console.log("[STEP 3] Opening combobox — calling .click()");
    setStatus("[DEBUG] Step 3: Opening combobox…");
    targetEl.click();

    // ── STEP 4: wait for [role="option"] to appear ──────────────────────
    const options = await waitForOptions(8000);
    console.log(`[STEP 4] Available options (${options.length}):`);
    options.forEach((o, i) =>
      console.log(`  [${i}] "${(o.innerText || o.textContent || "").trim()}"`)
    );

    if (!options.length) {
      console.log("[ERROR] [STEP 4] No [role=\"option\"] appeared after clicking");
      setStatus("[ERROR] No options appeared. Combobox may use a different interaction.", "err");
      return;
    }

    // ── STEP 5: find and click Car/Truck ────────────────────────────────
    const needle  = TARGET_VALUE.toLowerCase().trim();
    const getText = (o) => (o.innerText || o.textContent || "").toLowerCase().trim();
    const pick =
      options.find((o) => getText(o) === needle) ||
      options.find((o) => getText(o).includes(needle)) ||
      options.find((o) => needle.includes(getText(o)) && getText(o).length > 2);

    if (!pick) {
      console.log(`[ERROR] [STEP 5] No option matching "${TARGET_VALUE}"`);
      console.log("[DEBUG] Option texts:", options.map((o) => (o.innerText || o.textContent || "").trim()));
      setStatus(`[ERROR] No match for "${TARGET_VALUE}". Check console for actual option texts.`, "err");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return;
    }

    const pickedText = (pick.innerText || pick.textContent || "").trim();
    console.log(`[STEP 5] Selecting: ${pickedText}`);
    setStatus(`[DEBUG] Step 5: Clicking "${pickedText}"…`);
    pick.click();

    // ── STEP 6: confirm ─────────────────────────────────────────────────
    console.log(`[STEP 6] Selection success — clicked "${pickedText}"`);
    setStatus(
      `[DEBUG] Step 6: Selected "${pickedText}". ` +
      `Watch if Year / Make / Model appear. WORKFLOW STOPPED.`,
      "ok",
    );
    // STOP — do not continue to Year, Make, Model, or any other field.
  }

  if (isMarketplaceCreate) {
    chrome.storage.local.get("activeJob").then(({ activeJob }) => {
      if (activeJob) {
        actionsEl.appendChild(
          button("Fill Marketplace Fields", () => runPublishingFlow(activeJob)),
        );
        setTimeout(() => runPublishingFlow(activeJob), 1200);
      } else {
        actionsEl.appendChild(
          button("Fill Test Listing", async () => {
            console.log("[DealerPilot] Fill button clicked — starting state machine");
            setStatus("State Machine Running...");

            const res = await send({ type: "GET_TEST_LISTING" });
            if (!res || !res.ok) {
              if (res?.error === CTXI) return;
              setStatus("Failed to fetch test listing: " + (res && res.error), "err");
              return;
            }

            const listing = res.data;
            console.log("[DealerPilot] Test listing received:", listing);

            // Shape the flat test-listing into the fill envelope the state machine expects
            const fill = {
              vehicleType: listing.vehicleType || "Car/Truck",
              year:         listing.year        ?? null,
              make:         listing.make        ?? "",
              model:        listing.model       ?? "",
              mileage:      listing.mileage     != null ? String(listing.mileage) : null,
              price:        listing.price       != null ? String(listing.price)   : null,
              title:        listing.title       ?? "",
              description:  listing.description ?? "",
              location:     listing.location    ?? null,
              condition:    listing.condition   ?? null,
              transmission: listing.transmission ?? null,
              fuelType:     listing.fuelType    ?? null,
              color:        listing.color       ?? null,
              bodyStyle:    listing.bodyStyle   ?? null,
            };

            // Synthetic job that carries the pre-fetched payload
            const syntheticJob = {
              id:            0,
              listingTitle:  listing.title || "Test Listing",
              vehicleLabel:  `${listing.year || ""} ${listing.make || ""} ${listing.model || ""}`.trim(),
              dealerName:    "Test Mode",
              _prefetchedPayload: { fill, images: [] },
            };

            await runPublishingFlow(syntheticJob);
          }),
        );
      }

      // ---- Always-visible debug button (Vehicle Type only) ----
      const dbgBtn = button("🔍 DEBUG VEHICLE TYPE", () => debugVehicleType(), "mai-btn-secondary");
      dbgBtn.style.cssText += ";margin-top:6px;border:2px dashed #e74c3c;color:#e74c3c;font-weight:700;";
      actionsEl.appendChild(dbgBtn);
    });
  }

  if (isMessenger) {
    let lastReply = "";

    const readBtn = button("Read Chat & Suggest Reply", async () => {
      setStatus("Reading conversation…");
      const main = document.querySelector('[role="main"]') || document.body;
      const chatText = (main.innerText || "").trim().slice(-4000);
      if (!chatText) {
        setStatus("No conversation text found.", "err");
        return;
      }
      let buyerName = "";
      const heading = document.querySelector('[role="main"] h1, [role="main"] [role="heading"]');
      if (heading) buyerName = (heading.textContent || "").trim().slice(0, 120);

      const res = await send({
        type: "SEND_MESSAGE_CONTEXT",
        payload: { chatText, buyerName: buyerName || undefined, sourceUrl: href },
      });
      if (!res || !res.ok) {
        if (res?.error === CTXI) return;
        setStatus("Failed: " + (res && res.error), "err");
        return;
      }
      lastReply = res.data.suggestedReply;
      setStatus("Suggested reply ready. Lead saved to CRM.", "ok");
      showOutput(
        `<div class="mai-line"><strong>Suggested reply:</strong></div>` +
        `<div class="mai-reply">${escapeHtml(lastReply)}</div>` +
        `<button class="mai-btn mai-btn-secondary" id="mai-insert">Insert Reply</button>`,
      );
      const insertBtn = outputEl.querySelector("#mai-insert");
      insertBtn.addEventListener("click", () => insertReply(lastReply));
    });
    actionsEl.appendChild(readBtn);
  }

  function insertReply(text) {
    const box =
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea[aria-label*="Message" i]');
    if (!box) {
      setStatus("Could not find the message box.", "err");
      return;
    }
    if (box.tagName === "TEXTAREA") {
      box.focus();
      setNativeValue(box, text);
    } else {
      box.focus();
      document.execCommand("selectAll", false, undefined);
      document.execCommand("insertText", false, text);
    }
    setStatus("Reply inserted. Send was NOT clicked.", "ok");
  }

  log("Panel loaded", { isMessenger, isMarketplaceCreate });
})();
