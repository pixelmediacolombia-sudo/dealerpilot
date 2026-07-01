(function () {
  if (window.__marketplaceAiPanelLoaded) return;
  window.__marketplaceAiPanelLoaded = true;

  const log = (...args) => console.log("[DealerPilot AI]", ...args);

  // ---- Workflow step instrumentation ----
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
  const CTXI = "EXTENSION_CONTEXT_INVALIDATED";
  const BUILD_LABEL = "APP_CONTROLLED_PUBLISHING_1.2.4";

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
    } catch (_) {}
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

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function waitForReactRender(ms) { return sleep(ms === undefined ? 900 : ms); }

  // ---- ARIA combobox helpers ----

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
    const href     = location.href;
    const now      = new Date().toISOString();

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
        marketplaceDetected:   isMarketplaceNow,
        marketplacePath:       isMarketplaceNow ? pathname : null,
        marketplaceUrl:        isMarketplaceNow ? href : null,
        marketplaceDetectedAt: now,
        messengerDetected:     isMessengerNow,
        fbLoggedIn,
        marketplaceConnected,
      })
      .catch(() => {});

    if (hostname.includes("facebook.com")) {
      try {
        chrome.runtime.sendMessage({
          type: "FB_SESSION_REPORT",
          fbLoggedIn,
          marketplaceConnected,
        });
      } catch (_e) {}
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
    history.pushState    = wrap(history.pushState);
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

  const href        = location.href;
  const isMessenger = _initial.isMessengerNow;
  const isMarketplaceCreate = /\/marketplace\/create/.test(location.pathname);

  // ---- Panel UI ----
  const panel = document.createElement("div");
  panel.id = "mai-panel";
  panel.innerHTML = `
    <div id="mai-header">
      <span id="mai-dot"></span>
      <span id="mai-title">DealerPilot AI</span>
      <span style="font-size:9px;opacity:.55;margin-left:4px;letter-spacing:.02em;">v1.2</span>
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

  const statusEl  = panel.querySelector("#mai-status");
  const actionsEl = panel.querySelector("#mai-actions");
  const outputEl  = panel.querySelector("#mai-output");
  const jobBoxEl  = panel.querySelector("#mai-job-box");
  const dotEl     = panel.querySelector("#mai-dot");
  const bodyEl    = panel.querySelector("#mai-body");

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
      fill   = job._prefetchedPayload.fill;
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
      fill   = res.data.fill;
      images = res.data.images;
    }

    const filled   = [];
    const missed   = [];
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
      const combobox = await waitForCombobox(keywords);
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

      const options = await waitForOptions(undefined, label);
      if (!options.length) {
        stateError(`No [role="option"] elements appeared for ${label}`);
        missed.push(label);
        warnings.push(`${label}: no options appeared after clicking combobox`);
        return false;
      }

      // ---- Fuzzy option matching ----
      const needle   = String(targetValue).toLowerCase().trim();
      const getText  = (o) => (o.innerText || o.textContent || "").toLowerCase().trim();
      const norm     = (s) => s.replace(/[^a-z0-9]/g, "");

      // Vehicle-type alias set — Facebook has used many different labels
      const VT_ALIASES = [
        "car/truck", "cars & trucks", "cars and trucks",
        "vehicle", "car", "truck", "automobile", "cars", "trucks",
      ];

      // Color normalization map — handle Facebook label variants
      const COLOR_MAP = {
        "beige":  ["beige", "tan"],
        "black":  ["black"],
        "blue":   ["blue", "navy", "dark blue", "light blue"],
        "brown":  ["brown", "burgundy", "maroon", "wine"],
        "gold":   ["gold", "champagne", "bronze", "copper"],
        "gray":   ["gray", "grey", "silver", "charcoal", "dark gray", "light gray"],
        "green":  ["green", "olive", "dark green", "light green"],
        "orange": ["orange"],
        "purple": ["purple", "violet", "lavender"],
        "red":    ["red", "dark red"],
        "white":  ["white", "pearl", "cream", "ivory", "off-white"],
        "yellow": ["yellow"],
        "other":  ["other"],
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
        // Color mapping — normalize common color names to Facebook's labels
        (label === "color"
          ? (() => {
              for (const [canonical, aliases] of Object.entries(COLOR_MAP)) {
                if (aliases.some((a) => needle.includes(a) || a.includes(needle))) {
                  const found = options.find((o) => getText(o).includes(canonical));
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
    // fillStep — wait for a text input / textarea and write the value.
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
    // STATE MACHINE — Phase 0: Photos first → required → optional
    // Priority: photos + required fields. Optional fields skip on no match.
    // ==================================================================

    try {

      // ---- Phase 0: Upload photos FIRST ----
      // Must happen before filling any text — Facebook requires at least
      // one photo before the Next button becomes active.
      stateLog("Phase 0: uploading photos first");
      setStatus("Uploading photos…");

      if (images && images.length) {
        const photoResult = await uploadPhotos(images, job.id, warnings);
        if (photoResult.failed) {
          if (job.mode === "Controlled") {
            const reason = photoResult.reason || "Photo upload failed";
            stateError("Photo upload failed — aborting", new Error(reason));
            setStatus(reason, "err");
            send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => {});
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
      stateLog("Phase 1: vehicle type (required)");
      setStatus("Selecting vehicle type…");
      await selectComboboxStep(
        "vehicle type",
        ["vehicle type", "type of vehicle", "category"],
        fill.vehicleType || "Car/Truck",
        "generic",
        true,   // required — fallback to first option if no exact match
      );

      // ---- Phase 2: Year / Make / Model (optional — skip if no exact match) ----
      stateLog("Phase 2: year / make / model (optional)");

      setStatus("Selecting year…");
      await selectComboboxStep(
        "year",
        ["year"],
        fill.year ? String(fill.year) : null,
        "generic",
        false,  // optional
      );

      setStatus("Selecting make…");
      await selectComboboxStep(
        "make",
        ["make"],
        fill.make,
        "generic",
        false,
      );

      // Model — text input that appears after Make cascade
      setStatus("Filling model…");
      stateLog("Waiting for Model text input");
      const modelInput = await waitForNamedField("model", ["model"], 10000);
      if (modelInput && fill.model) {
        setNativeValue(modelInput, String(fill.model));
        modelInput.dispatchEvent(new Event("input",  { bubbles: true }));
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
      await fillStep("price", ["price", "listing price", "asking price"], fill.price);

      // Title — may be auto-generated by Facebook from Year/Make/Model
      {
        const TITLE_KWS = [
          "title", "listing title", "what are you selling",
          "vehicle name", "add a title", "item title",
        ];
        stateLog("Checking for title field");
        const titleEl = await waitForField(TITLE_KWS, 8000);
        if (titleEl) {
          if (fill.title) {
            setNativeValue(titleEl, String(fill.title));
            titleEl.dispatchEvent(new Event("input",  { bubbles: true }));
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

      await fillStep("description", ["description", "describe", "details"], fill.description);
      await fillStep("location", ["location", "city", "where"], fill.location);

      // ---- Phase 4: Optional text fields — mileage, VIN ----
      stateLog("Phase 4: optional text fields (mileage, VIN)");
      await fillStep("mileage", [
        "mileage", "odometer", "miles", "vehicle mileage",
        "number of miles", "mileage (optional)", "odometer reading",
      ], fill.mileage);
      await fillStep("vin", ["vin", "vin number", "vehicle identification number"], fill.vin);

      // ---- Phase 5: Optional dropdowns — strict match only, no first-option fallback ----
      stateLog("Phase 5: optional dropdowns (strict — skip if no exact match)");
      await selectComboboxStep("condition",    ["condition"],    fill.condition,    false, false);
      await selectComboboxStep("transmission", ["transmission"], fill.transmission, false, false);
      await selectComboboxStep("fuel type",    ["fuel"],         fill.fuelType,     false, false);
      await selectComboboxStep("color",        ["color", "exterior color"], fill.color, false, false);
      await selectComboboxStep("body style",   ["body style", "body type"], fill.bodyStyle, false, false);

      stateLog("Workflow Complete");

    } catch (err) {
      stateError("Unexpected error in publishing workflow", err);
      setStatus("Workflow error: " + ((err && err.message) || String(err)), "err");
      log("Publishing flow crashed", err);
    }

    if (job.mode === "Controlled") {
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
  // =====================================================================

  async function uploadPhotos(imageUrls, jobId, warnings) {
    const MAX_PHOTOS = 20;
    const toUpload = imageUrls.slice(0, MAX_PHOTOS);

    stateLog(`Photo upload: ${toUpload.length} URL(s) — locating file input`);
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

    stateLog(`Photo upload: file input found — downloading ${toUpload.length} image(s)`);
    setStatus(`Downloading ${toUpload.length} photo(s)…`);

    // Fetch each image via the background service worker (no CORS restrictions there)
    const files = [];
    for (let i = 0; i < toUpload.length; i++) {
      const url = toUpload[i];
      setStatus(`Downloading photo ${i + 1} / ${toUpload.length}…`);
      console.log(`[PHOTO] requesting image ${i + 1}/${toUpload.length} — url: "${url}" — isAbsolute: ${url.startsWith("http")}`);
      try {
        const res = await send({ type: "FETCH_IMAGE_AS_BASE64", url });
        if (!res || !res.ok) {
          console.error(`[PHOTO] background fetch FAILED for photo ${i + 1} — error:`, res?.error, "| full response:", res);
          stateLog(`Photo ${i + 1}: background fetch failed — ${res?.error}`);
          continue;
        }
        const { base64, type } = res.data;
        // Decode base64 → Uint8Array → Blob → File
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        const mimeType = type || "image/jpeg";
        const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        files.push(new File([new Blob([bytes], { type: mimeType })], `vehicle-${i + 1}.${ext}`, { type: mimeType }));
        stateLog(`Photo ${i + 1}: downloaded OK (${Math.round(bytes.length / 1024)} KB)`);
      } catch (err) {
        stateLog(`Photo ${i + 1}: error — ${err.message}`);
      }
    }

    if (files.length === 0) {
      const reason = "Photo upload failed: could not download any images from the job payload";
      stateError(reason);
      return { uploaded: 0, failed: true, reason };
    }

    stateLog(`Photo upload: injecting ${files.length} file(s) into input`);
    setStatus(`Uploading ${files.length} photo(s) to Facebook…`);

    // Inject files via DataTransfer — works in Chrome even for React-controlled inputs
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // Wait for Facebook to process the upload (thumbnails or count change)
    stateLog("Photo upload: waiting for Facebook to confirm upload…");
    setStatus(`Waiting for Facebook to process ${files.length} photo(s)…`);
    const confirmed = await waitForPhotoThumbnails(files.length, 30000);

    if (!confirmed) {
      // Not a hard failure — Facebook may have accepted without showing expected thumb count
      warnings.push(`Photo upload: injected ${files.length} file(s); thumbnails not fully confirmed — form may still proceed`);
      stateLog("Photo upload: thumbnail confirmation timed out — continuing anyway");
    } else {
      stateLog(`Photo upload: confirmed — ${files.length} photo(s) visible`);
    }

    send({ type: "SEND_JOB_EVENT", jobId, event: "photos_uploaded", details: `${files.length} photos` }).catch(() => {});
    setStatus(`Photos uploaded (${files.length}). Continuing…`);
    await sleep(800);

    return { uploaded: files.length, failed: false };
  }

  async function waitForPhotoThumbnails(expectedCount, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Facebook renders uploaded photo thumbnails in a few different ways
      const thumbs = [
        ...document.querySelectorAll('[data-testid="media-attachment-delete-button"]'),
        ...document.querySelectorAll('img[src^="blob:"]'),
      ];
      // Deduplicate by filtering to unique elements
      const unique = [...new Set(thumbs)];
      if (unique.length >= 1) {
        stateLog(`Photo thumbnails found: ${unique.length} / ${expectedCount}`);
        return true;
      }
      // Also accept: any visible image that appeared inside the upload area
      const uploadArea = document.querySelector(
        '[aria-label*="photo" i], [aria-label*="image" i], [aria-label*="upload" i]'
      );
      if (uploadArea) {
        const imgs = uploadArea.querySelectorAll("img");
        if (imgs.length >= 1) return true;
      }
      await sleep(500);
    }
    return false;
  }

  // ── Controlled-mode: auto-click Next → Publish ─────────────────────────────

  async function autoPublishFlow(job, { filled, missed, warnings }) {
    stateLog("Auto-publish: starting");
    setStatus("Auto-publishing — validating form before clicking Next…");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_starting" }).catch(() => {});

    await sleep(800);

    // ---- Pre-Next validation ----
    // Ensure the form is ready before we click Next. If the Next button is
    // disabled or missing required fields, detect the exact reason instead
    // of reporting a generic "Publish button not found" error.
    const validation = await validateBeforeNext();
    if (!validation.ok) {
      stateError("Pre-Next validation failed", new Error(validation.reason));
      setStatus(validation.reason, "err");
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: validation.reason }).catch(() => {});
      await send({ type: "FAIL_JOB", jobId: job.id, reason: validation.reason });
      await chrome.storage.local.remove("activeJob");
      renderReview(job, { filled, missed, warnings });
      return;
    }

    setStatus("Auto-publishing — clicking Next…");
    const nextClicked = await clickEnabledButtonByText(["next", "continue", "next step"], 10000);
    if (!nextClicked) {
      // Scrape whatever validation errors Facebook is showing to give a useful reason
      const fbErrors = scrapeFacebookErrors();
      const reason = fbErrors
        ? `Next button blocked: ${fbErrors}`
        : "Could not find an enabled Next button — check the form for errors";
      stateError("Auto-publish: Next not found/enabled", new Error(reason));
      setStatus(reason, "err");
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => {});
      await send({ type: "FAIL_JOB", jobId: job.id, reason });
      await chrome.storage.local.remove("activeJob");
      renderReview(job, { filled, missed, warnings });
      return;
    }

    stateLog("Auto-publish: Next clicked, waiting for Publish button…");
    setStatus("Auto-publishing — waiting for Publish button…");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "clicking_next" }).catch(() => {});
    await sleep(2000);

    const publishClicked = await clickButtonByText(
      ["publish listing", "publish", "post listing", "post"],
      15000,
    );
    if (!publishClicked) {
      const reason = "Could not find the Publish button after clicking Next";
      stateError("Auto-publish: Publish not found", new Error(reason));
      setStatus("Auto-publish failed: " + reason, "err");
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => {});
      await send({ type: "FAIL_JOB", jobId: job.id, reason });
      await chrome.storage.local.remove("activeJob");
      renderReview(job, { filled, missed, warnings });
      return;
    }

    stateLog("Auto-publish: Publish clicked, waiting for Marketplace confirmation…");
    setStatus("Auto-publishing — waiting for Marketplace to confirm…");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "clicking_publish" }).catch(() => {});
    await sleep(2500);

    const listingUrl = await waitForPublishSuccess(20000);
    stateLog("Auto-publish: complete — " + (listingUrl || "no URL detected"));

    const r = await send({ type: "COMPLETE_JOB", jobId: job.id, listingUrl: listingUrl || undefined });
    if (!r || !r.ok) {
      if (r?.error === CTXI) return;
      setStatus("Published but failed to record result: " + (r?.error ?? "unknown error"), "err");
      return;
    }

    await chrome.storage.local.remove("activeJob");
    setStatus("✓ Published successfully!" + (listingUrl ? " Listing is live." : ""), "ok");
    clearOutput();
    jobBoxEl.innerHTML = `
      <div class="mai-job">
        <div class="mai-job-title">Published ✓</div>
        <div class="mai-job-meta">Job #${escapeHtml(String(job.id))} complete.${listingUrl ? ` <a href="${escapeHtml(listingUrl)}" target="_blank" style="color:#4ade80">View listing ↗</a>` : ""}</div>
        <div class="mai-job-meta">Open the popup to claim the next job.</div>
      </div>`;
    log("Auto-publish complete", { job, filled, missed, warnings, listingUrl });
  }

  // clickEnabledButtonByText — only clicks buttons that are NOT disabled.
  async function clickEnabledButtonByText(textOptions, timeoutMs) {
    const start = Date.now();
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
        const text = (el.innerText || el.textContent || "").toLowerCase().trim();
        if (textOptions.some((t) => text === t || text === t + " ")) {
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
  async function validateBeforeNext() {
    // 1. Check at least 1 photo was uploaded (look for blob: thumbnails or FB thumb UI)
    const photoThumbs = [
      ...document.querySelectorAll('img[src^="blob:"]'),
      ...document.querySelectorAll('[data-testid="media-attachment-delete-button"]'),
    ];
    if (photoThumbs.length === 0) {
      // Also check the count indicator Facebook sometimes shows ("1 photo")
      const countText = (document.body.innerText || "").match(/(\d+)\s*photo/i);
      if (!countText || parseInt(countText[1], 10) === 0) {
        return { ok: false, reason: "Photo upload failed: Facebook shows 0 photos — upload could not be confirmed" };
      }
    }

    // 2. Check Next button exists and is not disabled
    const NEXT_TEXTS = ["next", "continue", "next step"];
    const allButtons = Array.from(
      document.querySelectorAll('div[role="button"], button, [role="button"]'),
    );
    const nextBtn = allButtons.find((el) => {
      const t = (el.innerText || el.textContent || "").toLowerCase().trim();
      return NEXT_TEXTS.some((n) => t === n || t === n + " ");
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
          : "Next button is disabled — a required field may be missing (price, title, description, or location)",
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

  async function waitForPublishSuccess(timeoutMs) {
    const startUrl = window.location.href;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cur = window.location.href;
      if (cur !== startUrl && (cur.includes("/marketplace/item/") || cur.includes("/marketplace/"))) {
        return cur;
      }
      const successEl =
        document.querySelector('[aria-label*="listed" i]') ||
        document.querySelector('[data-testid*="success" i]');
      if (successEl) return window.location.href !== startUrl ? window.location.href : null;
      await sleep(500);
    }
    const final = window.location.href;
    return final !== startUrl && final.includes("marketplace") ? final : null;
  }

  function chips(items, cls) {
    if (!items.length) return '<span class="mai-chip">none</span>';
    return items.map((i) => `<span class="mai-chip ${cls}">${escapeHtml(i)}</span>`).join("");
  }

  function renderReview(job, result) {
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
            const ACTIVE_STATUSES = ["Queued", "Claimed", "Publishing", "Retry"];
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
            button("Fill Test Listing (job cleared)", () => {}),
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
  // DEBUG: Vehicle Type only — stops after selecting Vehicle Type.
  // ==================================================================
  async function debugVehicleType() {
    const TARGET_VALUE = "Car/Truck";

    console.log("[STEP 1] Waiting for Vehicle Type dropdown");
    setStatus('[DEBUG] Step 1: Scanning for [role="combobox"] elements…');
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

    const VT_KEYWORDS = ["vehicle type", "type of vehicle", "category"];
    const targetEl = findCombobox(VT_KEYWORDS);

    if (!targetEl) {
      console.log("[ERROR] [STEP 2] Vehicle Type combobox NOT FOUND");
      setStatus('[ERROR] Vehicle Type combobox NOT FOUND. Check console (F12).', "err");
      return;
    }

    console.log("[STEP 2] Vehicle Type combobox FOUND:", targetEl);
    targetEl.style.outline = "4px solid red";
    targetEl.style.outlineOffset = "2px";
    setStatus("[DEBUG] Step 2: Combobox found — highlighted RED");

    console.log("[STEP 3] Opening combobox — calling .click()");
    setStatus("[DEBUG] Step 3: Opening combobox…");
    targetEl.click();

    const options = await waitForOptions(8000);
    console.log(`[STEP 4] Available options (${options.length}):`);
    options.forEach((o, i) =>
      console.log(`  [${i}] "${(o.innerText || o.textContent || "").trim()}"`)
    );

    if (!options.length) {
      console.log('[ERROR] [STEP 4] No [role="option"] appeared after clicking');
      setStatus("[ERROR] No options appeared. Combobox may use a different interaction.", "err");
      return;
    }

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

    console.log(`[STEP 6] Selection success — clicked "${pickedText}"`);
    setStatus(
      `[DEBUG] Done: Selected "${pickedText}". ` +
      `Watch if Year / Make / Model appear. WORKFLOW STOPPED.`,
      "ok",
    );
  }

  log("Panel loaded v1.2", { isMessenger, isMarketplaceCreate });
})();
