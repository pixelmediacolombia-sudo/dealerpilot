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
  let _photosConfirmed = false;

  // Set to true once waitForPhotoThumbnails confirms at least one thumbnail.
  // validateBeforeNext skips its own photo re-scan when this is already true,

  function _runtimeAlive() {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
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

  function setFieldValue(el, value) {
    if (!el) return;
    const text = String(value);
    if (el.matches?.('input, textarea')) {
      setNativeValue(el, text);
      return;
    }

    el.focus?.();
    el.textContent = text;
    el.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text,
    }));
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }

  function setFocusedFieldValue(el, value) {
    if (!el) return;
    const text = String(value);
    el.focus?.();
    if (el.matches?.('input, textarea')) {
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
    } else {
      el.textContent = text;
    }
    el.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text,
    }));
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }));
  }

  function fieldCurrentValue(el) {
    if (!el) return "";
    if ("value" in el) return String(el.value || "").trim();
    return String(el.innerText || el.textContent || "").trim();
  }

  function fieldHasMeaningfulValue(el, placeholderValues = []) {
    const value = normalizeText(fieldCurrentValue(el));
    if (!value) return false;
    return !placeholderValues.map(normalizeText).includes(value);
  }

  function visibleValueCandidates(el) {
    const candidates = [
      el?.getAttribute?.("aria-valuetext"),
      el?.getAttribute?.("data-value"),
      fieldCurrentValue(el),
    ];
    let cur = el;
    for (let depth = 0; cur && depth < 4; depth += 1, cur = cur.parentElement) {
      const text = cur.innerText || cur.textContent || "";
      if (text && text.length < 260) {
        candidates.push(...text.split(/\r?\n/));
        candidates.push(text);
      }
    }
    return candidates.filter(Boolean);
  }

  function hasMeaningfulDisplayedValue(el, placeholderValues = []) {
    const placeholders = new Set(placeholderValues.map(normalizeText).filter(Boolean));
    const genericEmpty = new Set(["select", "seleccionar", "elige", "elija", "choose"]);
    for (const candidate of visibleValueCandidates(el)) {
      let text = normalizeText(candidate);
      if (!text || placeholders.has(text) || genericEmpty.has(text)) continue;
      for (const placeholder of placeholders) {
        if (text.startsWith(`${placeholder} `)) {
          text = text.slice(placeholder.length).trim();
          break;
        }
      }
      if (text && !placeholders.has(text) && !genericEmpty.has(text)) return true;
    }
    return false;
  }

  function displayedComboboxMatchesTarget(label, targetValue, el) {
    const target = normalizeText(targetValue);
    if (!target || !el) return false;
    const candidates = visibleValueCandidates(el)
      .map(normalizeText)
      .filter((text) => text && text.length < 140);

    if (label === "year") {
      return candidates.some((text) => {
        const years = text.match(/\b(?:19|20)\d{2}\b/g) || [];
        return years.length === 1 && years[0] === target;
      });
    }

    return candidates.some((text) => text.includes(target));
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

  function findField(keywords, options = {}) {
    const selector = options.inputOnly
      ? 'input[type="text"], input:not([type]), input[type="number"]'
      : 'input[type="text"], input:not([type]), input[type="number"], textarea, [role="textbox"], [contenteditable="true"]';
    const fields = Array.from(
      document.querySelectorAll(selector),
    ).filter((el) => el.offsetParent !== null);
    const normalizedKeywords = keywords.map(normalizeText);
    for (const kw of normalizedKeywords) {
      const match = fields.find((el) => labelText(el).includes(kw));
      if (match) return match;
    }
    return null;
  }

  function waitForField(keywords, maxWaitMs = 5000, options = {}) {
    return new Promise((resolve) => {
      const interval = 300;
      let elapsed = 0;
      const tick = () => {
        const field = findField(keywords, options);
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

  function isMarketplaceColorField(fieldName) {
    const normalized = normalizeText(fieldName);
    return normalized.includes("exterior")
      || normalized.includes("interior")
      || normalized.includes("color");
  }

  function colorControlKeywords(fieldName) {
    const normalized = normalizeText(fieldName);
    if (normalized.includes("exterior")) return ["exterior color", "color exterior"];
    if (normalized.includes("interior")) return ["interior color", "color interior"];
    return ["exterior color", "color exterior", "interior color", "color interior"];
  }

  function findVisibleColorControl(fieldName) {
    const exactColorKeywords = colorControlKeywords(fieldName);
    const cb = findCombobox(exactColorKeywords);
    if (cb) return cb;
    const txt = findField(exactColorKeywords);
    if (txt) return txt;
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

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    return el.offsetParent !== null || Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function checkboxIsChecked(el) {
    if (!el) return false;
    if (el.matches?.('input[type="checkbox"]')) return el.checked === true;
    return el.getAttribute("aria-checked") === "true" || el.getAttribute("data-checked") === "true";
  }

  function textNearElement(el) {
    const parts = [
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("name"),
    ];
    let cur = el;
    for (let depth = 0; cur && depth < 5; depth += 1, cur = cur.parentElement) {
      const text = cur.innerText || cur.textContent || "";
      if (text && text.length < 900) parts.push(text);
    }
    return normalizeText(parts.filter(Boolean).join(" "));
  }

  function findCheckbox(keywords) {
    const normalizedKeywords = keywords.map(normalizeText);
    const selector = '[role="checkbox"], input[type="checkbox"], [aria-checked]';
    const candidates = Array.from(document.querySelectorAll(selector)).filter(isVisibleElement);

    for (const el of candidates) {
      const combined = textNearElement(el);
      if (normalizedKeywords.some((kw) => combined.includes(kw))) return el;
    }

    const textNodes = Array.from(document.querySelectorAll("label, div, span, strong"))
      .filter(isVisibleElement);
    for (const node of textNodes) {
      const text = normalizeText(node.innerText || node.textContent || "");
      if (!text || text.length > 700) continue;
      if (!normalizedKeywords.some((kw) => text.includes(kw))) continue;

      let cur = node;
      for (let depth = 0; cur && depth < 6; depth += 1, cur = cur.parentElement) {
        const checkbox = cur.querySelector?.(selector);
        if (checkbox && isVisibleElement(checkbox)) return checkbox;
      }
    }
    return null;
  }

  function waitForCheckbox(label, keywords, maxWaitMs = 8000) {
    const limit = maxWaitMs;
    const kwStr = keywords.join("/");
    return new Promise((resolve) => {
      const interval = 300;
      let elapsed = 0;
      const tick = () => {
        const el = findCheckbox(keywords);
        if (el) {
          console.log(`[FOUND] "${label}" checkbox (${kwStr}) appeared at ${elapsed}ms`);
          resolve(el);
          return;
        }
        elapsed += interval;
        if (elapsed > 900 && elapsed % 900 === 0) nudgeMarketplaceFormScroll();
        if (elapsed >= limit) {
          console.log(`[TIMEOUT] "${label}" checkbox (${kwStr}) did not appear after ${limit}ms`);
          resolve(null);
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function dispatchCommitEvents(el) {
    if (!el) return;
    for (const eventName of ["input", "change"]) {
      try { el.dispatchEvent(new Event(eventName, { bubbles: true })); } catch (_) { /* noop */ }
    }
    try { el.dispatchEvent(new FocusEvent("blur", { bubbles: true })); } catch (_) { /* noop */ }
    try { el.blur?.(); } catch (_) { /* noop */ }
  }

  async function settleMarketplaceFormBeforeNext() {
    stateLog("Settling Marketplace form state before Next");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(250);

    const controls = Array.from(document.querySelectorAll([
      'input[type="text"]',
      'input[type="number"]',
      'input:not([type])',
      'textarea',
      '[role="combobox"]',
      '[role="checkbox"]',
      'input[type="checkbox"]',
    ].join(", "))).filter(isVisibleElement);

    for (const el of controls) dispatchCommitEvents(el);
    dispatchCommitEvents(document.activeElement);
    nudgeMarketplaceFormScroll();
    await sleep(900);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(600);
  }

  function collectDisabledNextDiagnostics() {
    const hints = [];
    const add = (value) => {
      const text = String(value || "").trim();
      if (text && !hints.includes(text)) hints.push(text);
    };

    document.querySelectorAll('[aria-invalid="true"], [data-invalid="true"]').forEach((el) => {
      if (!isVisibleElement(el)) return;
      if (!hasMeaningfulDisplayedValue(el, [])) {
        const text = textNearElement(el);
        add(text || "invalid visible control");
      }
    });

    const placeholderLike = new Set([
      "ano", "año", "marca", "modelo", "precio", "millaje", "ubicacion",
      "carroceria", "estado del vehiculo", "tipo de combustible", "transmision",
      "description", "descripcion",
    ]);

    document.querySelectorAll('[role="combobox"]').forEach((el) => {
      if (!isVisibleElement(el)) return;
      const text = normalizeText(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
      if ((!text || placeholderLike.has(text)) && !hasMeaningfulDisplayedValue(el, Array.from(placeholderLike))) {
        add(text || "empty combobox");
      }
    });

    document.querySelectorAll('input[required], textarea[required], [aria-required="true"], [role="textbox"][aria-required="true"]').forEach((el) => {
      if (!isVisibleElement(el)) return;
      if (
        !fieldHasMeaningfulValue(el, Array.from(placeholderLike))
        && !hasMeaningfulDisplayedValue(el, Array.from(placeholderLike))
        && !checkboxIsChecked(el)
      ) {
        add(textNearElement(el) || "empty required control");
      }
    });

    const descriptionField = findField(["description", "describe", "details", "descripción", "descripcion", "detalles"]);
    if (
      descriptionField
      && !fieldHasMeaningfulValue(descriptionField, ["description", "describe", "details", "descripción", "descripcion", "detalles"])
    ) {
      add("description field is visible but empty");
    }

    const cleanTitle = findCheckbox([
      "clean title",
      "titulo limpio",
      "título limpio",
      "este vehiculo tiene titulo limpio",
      "este vehículo tiene título limpio",
    ]);
    if (cleanTitle && !checkboxIsChecked(cleanTitle)) add("clean title checkbox is visible but unchecked");

    const visibleOptions = Array.from(document.querySelectorAll('[role="option"]')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const locationOptionsOpen = visibleOptions.some((el) => {
      const text = normalizeText(el.innerText || el.textContent || "");
      return text.includes("ciudad") || text.includes("city") || text.includes(" virginia") || /\bva\b/.test(text);
    });
    if (locationOptionsOpen) add("location autocomplete suggestions are still open");

    return hints.slice(0, 8);
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

  function makeModelTextFieldsAreVisible() {
    return Boolean(
      findField(["make", "marca"]) ||
      findField(["model", "modelo"]),
    );
  }

  // ---- Page detection (SPA-aware) ----

  function isMessengerUrl() {
    const hostname = location.hostname;
    const pathname = location.pathname;
    return hostname.includes("messenger.com") || /\/messages\b/.test(pathname);
  }

  function isMarketplaceConversationUrl() {
    const hostname = location.hostname;
    const pathname = location.pathname;
    return hostname.includes("facebook.com") && /\/marketplace\/(inbox|you\/selling|you\/buying|item\/\d+)\b/.test(pathname);
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const MESSENGER_COMPOSER_SELECTOR = [
    '[contenteditable="true"]',
    "textarea",
  ].join(", ");

  function isLikelyMessengerComposer(el) {
    if (!el || !visible(el)) return false;
    const isEditable =
      el.tagName === "TEXTAREA" ||
      el.getAttribute("contenteditable") === "true";
    if (!isEditable) return false;

    const descriptor = [
      el.getAttribute("role"),
      el.getAttribute("aria-label"),
      el.getAttribute("aria-placeholder"),
      el.getAttribute("placeholder"),
      el.getAttribute("data-lexical-editor"),
    ].filter(Boolean).join(" ");

    // Facebook's current chat editor is often only identified by
    // data-lexical-editor="true" or aria-placeholder="Aa". Keep the selector
    // broad, then exclude the other common Facebook editors explicitly.
    return !/search|buscar|comment|comentario|post|publicaci[o\u00f3]n|what(?:'s| is) on your mind|qu[e\u00e9] est[a\u00e1]s pensando|caption|descripci[o\u00f3]n/i.test(descriptor);
  }

  function hasExplicitMarketplaceEvidence(root) {
    if (!root) return false;
    if (root.matches?.('a[href*="/marketplace/item/"]')) return true;
    if (root.querySelector('a[href*="/marketplace/item/"]')) return true;
    const accessibleText = `${root.getAttribute?.("aria-label") || ""} ${root.innerText || ""}`;
    return /\bmarketplace\b/i.test(accessibleText);
  }

  function hasMarketplaceThreadEvidence(root) {
    if (!root || !visible(root)) return false;
    const hasComposer = Array.from(root.querySelectorAll(MESSENGER_COMPOSER_SELECTOR))
      .some(isLikelyMessengerComposer);
    const hasExplicitMarketplace = hasExplicitMarketplaceEvidence(root);

    // Facebook's current Marketplace inbox can render the listing title as
    // plain text instead of an item anchor, and its visible title is not always
    // exposed as a semantic heading. The active composer is the stable signal;
    // Marketplace route/text/link evidence scopes it to a seller thread. The
    // downstream Sales AI gates still require buyer, message direction, and
    // vehicle context before any reply can be sent.
    return hasComposer && (hasExplicitMarketplace || isMarketplaceConversationUrl());
  }

  function elementArea(el) {
    const rect = el?.getBoundingClientRect?.();
    return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
  }

  function findThreadRootFromComposers() {
    const roots = [];
    const composers = Array.from(document.querySelectorAll(MESSENGER_COMPOSER_SELECTOR))
      .filter(isLikelyMessengerComposer);

    for (const composer of composers) {
      let candidate = composer.parentElement;
      while (candidate && candidate !== document.documentElement) {
        if (hasMarketplaceThreadEvidence(candidate)) {
          roots.push(candidate);
          break;
        }
        candidate = candidate.parentElement;
      }
    }

    // A background post editor may only match at <body>, while the active chat
    // composer matches inside its compact popover. Prefer the narrowest valid
    // root so the selected conversation cannot leak into another page surface.
    return roots.sort((left, right) => elementArea(left) - elementArea(right))[0] || null;
  }

  function findMarketplaceThreadRoot() {
    const isolatedCapture = globalThis.DealerPilotMessengerCapture;
    if (isolatedCapture?.findThreadRoot) {
      const isolatedRoot = isolatedCapture.findThreadRoot({ document, location });
      if (isolatedRoot) return isolatedRoot;
    }
    const semanticSelectors = [
      '[role="region"][aria-label*="Conversaci\u00f3n con el t\u00edtulo" i]',
      '[role="region"][aria-label*="Conversation titled" i]',
      '[role="region"][aria-label*="Conversation with the title" i]',
      '[role="log"][aria-label*="Mensajes de la conversaci\u00f3n" i]',
      '[role="log"][aria-label*="Messages in the conversation" i]',
      '[role="log"][aria-label*="Conversation messages" i]',
    ];

    for (const selector of semanticSelectors) {
      for (const candidate of document.querySelectorAll(selector)) {
        const root =
          candidate.matches('[role="region"]')
            ? candidate
            : candidate.closest('[role="region"]') || candidate.closest('[role="main"]');
        if (hasMarketplaceThreadEvidence(root)) {
          return root;
        }
      }
    }

    const composerRoot = findThreadRootFromComposers();
    if (composerRoot) return composerRoot;

    const contextualRoots = Array.from(
      document.querySelectorAll('[role="dialog"], [role="main"], [role="region"]'),
    ).filter(hasMarketplaceThreadEvidence);
    return contextualRoots.sort((left, right) => elementArea(left) - elementArea(right))[0] || null;
  }

  function findMessengerRoot() {
    const marketplaceThreadRoot = findMarketplaceThreadRoot();
    if (marketplaceThreadRoot) return marketplaceThreadRoot;

    const textboxes = Array.from(
      document.querySelectorAll(
        MESSENGER_COMPOSER_SELECTOR,
      ),
    ).filter(isLikelyMessengerComposer);

    for (const box of textboxes) {
      const root =
        box.closest('[role="dialog"]') ||
        box.closest('[aria-label*="Messenger" i]') ||
        box.closest('[aria-label*="Chat" i]') ||
        box.closest('[role="main"]');
      if (hasMarketplaceThreadEvidence(root)) return root;
    }

    return null;
  }

  function getMessengerDetectionDebug() {
    const supportedHost =
      location.hostname.includes("facebook.com") ||
      location.hostname.includes("messenger.com");
    const root = supportedHost ? findMessengerRoot() : null;
    const composerDetected = !!root && Array.from(
      root.querySelectorAll(MESSENGER_COMPOSER_SELECTOR),
    ).some(isLikelyMessengerComposer);

    return {
      at: new Date().toISOString(),
      hostname: location.hostname,
      pathname: location.pathname,
      messengerRoute: isMessengerUrl(),
      marketplaceRoute: isMarketplaceConversationUrl(),
      supportedHost,
      rootDetected: !!root,
      rootTag: root?.tagName || null,
      rootRole: root?.getAttribute?.("role") || null,
      composerDetected,
      headingDetected: !!root?.querySelector('[role="heading"], h1, h2, h3, [aria-level]'),
      marketplaceEvidence: hasExplicitMarketplaceEvidence(root),
      messageLogDetected: !!root?.querySelector(
        '[role="log"], [aria-live="polite"][aria-label*="message" i], [aria-live="polite"][aria-label*="mensaje" i]',
      ),
      messengerDetected: supportedHost && !!root,
    };
  }

  function isMessengerUiVisible() {
    return getMessengerDetectionDebug().messengerDetected;
  }

  function detectPageState() {
    const hostname = location.hostname;
    const pathname = location.pathname;
    const href = location.href;
    const now = new Date().toISOString();

    const isMarketplaceNow =
      hostname.includes("facebook.com") && pathname.includes("/marketplace");

    const messengerDetectionDebug = getMessengerDetectionDebug();
    const isMessengerNow = messengerDetectionDebug.messengerDetected;

    const isLoginPage =
      /^\/(login(\.php)?|checkpoint|recover|two_step_verification|privacy\/consent)/.test(pathname) ||
      location.search.includes("reauth=1") ||
      (location.search.includes("next=") && pathname === "/login.php");
    const fbLoggedIn =
      (hostname.includes("facebook.com") || hostname.includes("messenger.com")) && !isLoginPage;
    const marketplaceConnected = isMarketplaceNow && fbLoggedIn;

    send({
      type: "PAGE_STATE_REPORT",
      state: {
        marketplaceDetected: isMarketplaceNow,
        marketplacePath: isMarketplaceNow ? pathname : null,
        marketplaceUrl: isMarketplaceNow ? href : null,
        marketplaceDetectedAt: now,
        messengerDetected: isMessengerNow,
        messengerDetectionDebug,
        fbLoggedIn,
        marketplaceConnected,
      },
    }).catch(() => { });

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
  setInterval(detectPageState, 5000);

  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      detectPageState();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  const isMessenger = _initial.isMessengerNow;
  const isMarketplaceCreate = /\/marketplace\/create/.test(location.pathname);
  const isMarketplaceItem = /\/marketplace\/item\//.test(location.pathname);

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
    const skippedMissingControls = new Set();

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
        const isColorField = isMarketplaceColorField(label);
        const renderedControlPresent = Boolean(findVisibleColorControl(label));
        if (isColorField && !renderedControlPresent) {
          skippedMissingControls.add(label);
          stateLog(`Skipping "${label}" — no color control rendered in this form variant`);
          warnings.push(`${label}: skipped — no color control rendered in this form variant`);
          return false;
        }
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
        "truck": ["truck", "pickup", "pick-up", "pick up", "pickup truck", "camioneta", "camion", "camioneta pickup", "camioneta tipo pickup"],
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
        "other": ["other", "otro", "otra", "gasoline", "gasolina"],
      };

      const CONDITION_MAP = {
        "used": ["used", "pre-owned", "usado", "usada", "bueno", "aceptable"],
        "new": ["new", "nuevo", "nueva", "excelente"],
        "excellent": ["excellent", "excelente"],
        "very good": ["very good", "muy bueno", "muy buena"],
        "good": ["good", "bueno", "buena"],
        "fair": ["fair", "aceptable", "regular"],
        "poor": ["poor", "malo", "mala"],
        "salvage": ["salvage", "salvamento", "malo", "mala"],
      };

      const TRANSMISSION_MAP = {
        "automatic": ["automatic", "auto", "a/t", "cvt", "automatica", "automatico", "transmision automatica"],
        "manual": ["manual", "m/t", "standard", "transmision manual"],
        "other": ["other", "otro", "otra", "automatic", "automatica", "transmision automatica"],
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
          : undefined) ||
        (label === "transmission"
          ? (() => {
            for (const [canonical, aliases] of Object.entries(TRANSMISSION_MAP)) {
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

      // ---- Post-selection verification (year / make) -----------------
      if (label === "year" || label === "make") {
        await sleep(400);
        const cbNow = (await waitForCombobox(keywords, 2000)) || combobox;
        const displayedNow = (cbNow.innerText || cbNow.textContent || "").trim();
        if (displayedComboboxMatchesTarget(label, targetValue, cbNow)) {
          stateLog(`${label} verified - combobox shows "${displayedNow}"`);
        } else if (label === "year") {
          const warning = `${label}: selected "${pickedText}" but combobox shows "${displayedNow}" - expected "${targetValue}"`;
          warnings.push(warning);
          if (!missed.includes(label)) missed.push(label);
          stateError(`Selected year does not match target "${targetValue}"`, new Error(warning));
          return false;
        } else {
          stateLog(`${label} - combobox shows "${displayedNow}" (expected "${targetValue}") - verify manually`);
          warnings.push(`${label}: selected "${pickedText}" but combobox shows "${displayedNow}" - verify manually`);
        }
      }

      // ---- Post-selection wait ----
      if (afterWait === "generic") {
        let skipGenericComboboxWait = false;
        if (label === "year") {
          await sleep(500);
          skipGenericComboboxWait = makeModelTextFieldsAreVisible();
          if (skipGenericComboboxWait) {
            stateLog("Skipping next-combobox wait after year because make/model text fields are already visible");
          }
        }

        if (!skipGenericComboboxWait) {
          stateLog(`Waiting for next combobox after ${label} (generic count wait)`);
          const appeared = await waitForMoreComboboxes(countBefore, 6000);
          if (!appeared) {
            console.log(`[WARN] combobox count did not increase after selecting ${label}`);
          }
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

    async function checkCheckboxStep(label, keywords, isRequired = false) {
      console.log(`[STEP] ${label}`);
      stateLog(`Step: ${label}`);
      setStatus(`Checking "${label}" checkbox...`);

      const checkbox = await waitForCheckbox(label, keywords, 8000);
      if (!checkbox) {
        if (isRequired) {
          missed.push(label);
          warnings.push(`${label}: checkbox did not appear`);
        } else {
          warnings.push(`${label}: checkbox did not appear — skipped`);
        }
        return false;
      }

      if (!checkboxIsChecked(checkbox)) {
        checkbox.click();
        await sleep(500);
      }

      if (!checkboxIsChecked(checkbox)) {
        const clickTarget = checkbox.closest?.("label") || checkbox.parentElement || checkbox;
        if (clickTarget && clickTarget !== checkbox) {
          clickTarget.click();
          await sleep(500);
        }
      }

      if (checkboxIsChecked(checkbox)) {
        filled.push(label);
        stateLog(`${label} checked`);
        log(`${label} checked`);
        return true;
      }

      missed.push(label);
      warnings.push(`${label}: checkbox found but could not be checked`);
      return false;
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
        "truck": "Car/Truck",
        "pickup": "Car/Truck",
        "pickup truck": "Car/Truck",
        "suv": "Car/Truck",
        "sport utility": "Car/Truck",
        "sport-utility": "Car/Truck",
        "sedan": "Car/Truck",
        "saloon": "Car/Truck",
        "coupe": "Car/Truck",
        "2-door": "Car/Truck",
        "hatchback": "Car/Truck",
        "hatch": "Car/Truck",
        "van": "Car/Truck",
        "minivan": "Car/Truck",
        "mini-van": "Car/Truck",
        "wagon": "Car/Truck",
        "estate": "Car/Truck",
        "convertible": "Car/Truck",
        "cabriolet": "Car/Truck",
        "roadster": "Car/Truck",
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
      const CAR_ALIASES = [
        "car/truck", "cars & trucks", "cars and trucks",
        "auto/camioneta", "auto", "camioneta", "vehiculo", "vehiculos", "vehículos",
        "automovil", "automóvil", "automobile", "vehicle", "vehicles",
      ];

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
          pick = optionEls.find((o) => CAR_ALIASES.some((a) => getText(o).includes(a)));
        }

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
      const inputOnly = label === "mileage" || label === "price";
      const el = await waitForField(keywords, 6000, { inputOnly });
      if (el) {
        setFieldValue(el, String(value));
        await sleep(150);
        if (!fieldCurrentValue(el)) {
          setFieldValue(el, String(value));
          await sleep(150);
        }
        filled.push(label);
        log(`${label} filled`);
        return true;
      } else {
        stateError(`Could not find ${label} field`);
        missed.push(label);
        return false;
      }
    }

    async function ensureDescriptionStep(value) {
      if (value === null || value === undefined || value === "") return false;
      const descriptionKeywords = ["description", "describe", "details", "descripcion", "detalles"];
      const el = await waitForField(descriptionKeywords, 3000);
      if (!el) {
        warnings.push("description: could not re-verify before publish");
        return false;
      }

      const current = fieldCurrentValue(el);
      const normalizedCurrent = normalizeText(current);
      const normalizedExpected = normalizeText(value);
      const numericOnly = /^[0-9\s,.$]+$/.test(normalizedCurrent);
      const hasExpectedCopy =
        normalizedCurrent.includes("english") ||
        normalizedCurrent.includes("espanol") ||
        normalizedCurrent.includes(normalizedExpected.slice(0, 60));

      if (!normalizedCurrent || numericOnly || !hasExpectedCopy) {
        stateLog("Description changed or was overwritten - restoring before publish");
        setFieldValue(el, String(value));
        await sleep(250);
        warnings.push("description: restored before publish after final field validation");
      }

      return true;
    }

    async function fillLocationStep(value) {
      const keywords = ["location", "city", "where", "ubicación", "ubicacion", "ciudad"];
      const STATE_ALIASES = {
        al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
        co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
        hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
        ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
        ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri",
        mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
        nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
        ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
        sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
        va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
        dc: "district of columbia",
      };
      if (value === null || value === undefined || value === "") {
        stateLog('Skipping "location" - no value in listing data');
        warnings.push("location: no value in listing data - skipped");
        return false;
      }

      stateLog("Filling location");
      const el = await waitForField(keywords, 6000);
      if (!el) {
        stateError("Could not find location field");
        missed.push("location");
        return false;
      }

      const textValue = String(value);
      const cityPart = normalizeText(textValue.split(",")[0] || textValue);
      const statePart = normalizeText((textValue.split(",")[1] || "").trim());
      const stateAlias = STATE_ALIASES[statePart] || statePart;
      const otherStateTokens = Object.entries(STATE_ALIASES)
        .filter(([abbr, name]) => abbr !== statePart && name !== stateAlias)
        .flatMap(([abbr, name]) => [abbr, name]);
      const containsToken = (text, token) => {
        if (!token) return false;
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
      };
      const readValidationState = () => {
        const validationText = normalizeText(
          Array.from(document.querySelectorAll('[role="alert"], [aria-live], div, span'))
            .filter(isVisibleElement)
            .map((node) => (node.innerText || node.textContent || "").trim())
            .filter((text) => text && text.length <= 180)
            .join(" "),
        );
        return {
          explicitlyInvalid:
            validationText.includes("ubicacion no es valid") ||
            validationText.includes("location is not valid") ||
            validationText.includes("invalid location") ||
            el.getAttribute?.("aria-invalid") === "true",
          explicitlyValid:
            validationText.includes("ubicacion es valid") ||
            validationText.includes("location is valid"),
        };
      };
      let pickedSuggestion = false;

      // Facebook often preloads the seller's current Marketplace city. Keep it
      // when it already matches the payload and Facebook has not marked it
      // invalid. Clearing a valid default can make the autocomplete return no
      // options and must never trigger a different dealer/city fallback.
      const currentLocation = normalizeText(fieldCurrentValue(el) || el.innerText || el.textContent || "");
      const currentPopupClosed = el.getAttribute?.("aria-expanded") !== "true";
      const currentValidation = readValidationState();
      if (
        cityPart &&
        containsToken(currentLocation, cityPart) &&
        currentPopupClosed &&
        !currentValidation.explicitlyInvalid
      ) {
        dispatchCommitEvents(el);
        stateLog(`location already valid -> "${currentLocation}"; preserving Facebook selection`);
        filled.push("location");
        log("existing Facebook location preserved");
        return true;
      }

      const locationQueries = [
        { query: textValue, city: cityPart, state: statePart, stateAlias },
        { query: stateAlias && cityPart ? `${textValue.split(",")[0].trim()} ${stateAlias}` : "", city: cityPart, state: statePart, stateAlias },
        { query: textValue.split(",")[0].trim(), city: cityPart, state: statePart, stateAlias },
      ].filter((entry, index, entries) => {
        if (!entry.query) return false;
        const normalizedQuery = normalizeText(entry.query);
        return entries.findIndex((candidate) => normalizeText(candidate.query) === normalizedQuery) === index;
      });

      for (const locationQuery of locationQueries) {
        const { query } = locationQuery;
        setFocusedFieldValue(el, "");
        await sleep(150);
        setFocusedFieldValue(el, query);
        await sleep(query === textValue ? 1500 : 1000);

        const options = await scanForAnyOptions(4500, "location-suggestions");
        if (!options.length) continue;

        // Facebook currently nests a second role=option inside every outer
        // suggestion row. The outer <li> is visible but does not reliably
        // commit the location when clicked; use the innermost option that owns
        // the actual interaction handler whenever that duplicated DOM exists.
        const leafOptions = options.filter((option) => !option.querySelector?.('[role="option"]'));
        const locationOptions = leafOptions.length ? leafOptions : options;

        const optionText = (option) => normalizeText(option.innerText || option.textContent || "");
        const optionScore = (option) => {
          const text = optionText(option);
          const firstLine = normalizeText((option.innerText || option.textContent || "").split(/\r?\n/)[0] || "");
          const queryCityPart = locationQuery.city;
          const queryStatePart = locationQuery.state;
          const queryStateAlias = locationQuery.stateAlias;
          let score = 0;
          if (firstLine === queryCityPart) score += 45;
          if (containsToken(text, "city") || containsToken(text, "ciudad")) score += 120;
          if (text.includes(`${queryCityPart}, ${queryStatePart}`)) score += 60;
          if (queryStateAlias && text.includes(`${queryCityPart}, ${queryStateAlias}`)) score += 55;
          if (queryCityPart && text.includes(queryCityPart)) score += 25;
          if (queryStatePart && containsToken(text, queryStatePart)) score += 80;
          if (queryStateAlias && text.includes(queryStateAlias)) score += 80;
          if ((queryStatePart || queryStateAlias) && otherStateTokens.some((token) => containsToken(text, token))) score -= 75;
          if (text.includes("lake ") || text.includes("park ") || text.includes("county ")) score -= 35;
          if (text.includes("downtown ") || text.includes("registraron una visita") || text.includes("checked in")) score -= 80;
          return score;
        };
        let pick = null;

        if (cityPart) {
          const scored = locationOptions
            .map((option) => ({ option, score: optionScore(option) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score);
          if (scored.length) pick = scored[0].option;
        }

        if (!pick) {
          const normalizedQueryTarget = normalizeText(query);
          pick =
            locationOptions.find((option) => optionText(option).includes(normalizedQueryTarget)) ||
            locationOptions.find((option) => locationQuery.city && optionText(option).includes(locationQuery.city) && (!locationQuery.stateAlias || optionText(option).includes(locationQuery.stateAlias))) ||
            (!locationQuery.state && locationOptions.find((option) => locationQuery.city && optionText(option).includes(locationQuery.city))) ||
            null;
        }

        if (pick) {
          const pickedText = (pick.innerText || pick.textContent || "").trim();
          stateLog(`location suggestion -> "${pickedText}"`);
          try { pick.scrollIntoView?.({ block: "center", inline: "nearest" }); } catch (_) { /* noop */ }
          for (const eventName of ["pointerdown", "mousedown", "mouseup", "click"]) {
            try { pick.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window })); } catch (_) { /* noop */ }
          }
          try { pick.click(); } catch (_) { /* noop */ }
          await sleep(900);
          const committed = normalizeText(fieldCurrentValue(el) || el.innerText || el.textContent || "");
          const visibleLocationOptions = Array.from(document.querySelectorAll('[role="option"]')).filter(isVisibleElement);
          const { explicitlyInvalid, explicitlyValid } = readValidationState();
          const cityCommitted = containsToken(committed, locationQuery.city);
          const popupClosed = el.getAttribute?.("aria-expanded") !== "true" && visibleLocationOptions.length === 0;
          const selectionCommitted =
            cityCommitted &&
            popupClosed &&
            !explicitlyInvalid &&
            (explicitlyValid || committed !== normalizeText(query));

          if (selectionCommitted) {
            pickedSuggestion = true;
            dispatchCommitEvents(el);
            stateLog(`location committed -> "${committed}"`);
            await sleep(250);
            break;
          }

          stateLog(`location suggestion did not commit -> "${committed || "empty"}"; retrying`);
        }
      }

      if (!pickedSuggestion) {
        warnings.push(`location: no autocomplete suggestion committed for "${textValue}"`);
        missed.push("location");
        stateError(`Could not commit a valid location for "${textValue}"`);
        return false;
      }
      await sleep(300);
      filled.push("location");
      log("location suggestion selected and committed");
      return true;
    }

    async function fillTextOrSelectComboboxStep(label, textKeywords, comboKeywords, value, afterWait) {
      if (value === null || value === undefined || value === "") {
        stateLog(`Skipping "${label}" — no value in listing data`);
        warnings.push(`${label}: no value in listing data — skipped`);
        return false;
      }
      const textField = await waitForNamedField(label, textKeywords, 1800);
      if (textField) {
        setFieldValue(textField, String(value));
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
      stateLog("Phase 2: location");
      setStatus("Selecting location...");
      await fillLocationStep(fill.location);

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
        setFieldValue(modelInput, String(fill.model));
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
            setFieldValue(titleEl, String(fill.title));
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
          true,
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
          if (findVisibleColorControl("exterior color")) {
            missed.push("exterior color");
            warnings.push("exterior color: missing from vehicle data");
          } else {
            skippedMissingControls.add("exterior color");
            warnings.push("exterior color: skipped — no color control rendered in this form variant");
          }
        } else {
          const ecOk = await selectComboboxStep(
            "exterior color",
            ["exterior color", "exterior", "color", "color exterior"],
            extColor,
            null,
            true,
          );
          if (!ecOk && !skippedMissingControls.has("exterior color") && !missed.includes("exterior color")) {
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
        if (!interiorFilled && !skippedMissingControls.has("interior color") && !missed.includes("interior color")) {
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
        fill.condition || "Good",
        null,
        true,
      );
      await selectComboboxStep(
        "fuel type",
        ["fuel", "fuel type", "tipo de combustible", "combustible"],
        fill.fuelType || "Gasoline",
        null,
        true,
      );
      await selectComboboxStep(
        "transmission",
        ["transmission", "transmisión", "transmision"],
        fill.transmission || "Automatic",
        null,
        true,
      );

      // ---- Phase 6b: Clean title checkbox. Newer Facebook vehicle forms keep
      // this as a required declaration below the vehicle detail dropdowns.
      stateLog("Phase 6b: clean title checkbox");
      await checkCheckboxStep(
        "clean title",
        [
          "clean title",
          "title is clean",
          "has a clean title",
          "titulo limpio",
          "título limpio",
          "este vehiculo tiene titulo limpio",
          "este vehículo tiene título limpio",
        ],
        true,
      );

      await ensureDescriptionStep(fill.description);

      checkBudget("workflow complete");
      stateLog(`Workflow Complete — ${elapsed()}s elapsed`);
      await send({
        type: "SEND_JOB_EVENT",
        jobId: job.id,
        event: "form_complete",
        details: "All Marketplace fields filled",
      }).catch(() => { });

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
    // DealerPilot publishes the Photo Director's final Marketplace set.
    const DEFAULT_MAX = 10;
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
              console.log(`[PHOTO] proxy skipped idx ${idx}:`, res?.error);
              stateLog(`Photo ${idx + 1}: proxy failed — ${res?.error}`);
              warnings.push(`photo ${idx + 1}: skipped — ${res?.error || "proxy failed"}`);
              return;
            }
            if (res.data?.skipped || !res.data?.base64) {
              const reason = res.data?.error || "proxy returned no image data";
              console.log(`[PHOTO] proxy skipped idx ${idx}:`, reason);
              stateLog(`Photo ${idx + 1}: skipped — ${reason}`);
              warnings.push(`photo ${idx + 1}: skipped — ${reason}`);
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

    // Record the empty/upload-placeholder state before assigning files. Facebook
    // always renders photo-related icons in this area, so a post-change check
    // must prove that NEW evidence appeared instead of accepting those icons.
    const photoEvidenceBaseline = collectFacebookPhotoEvidence();

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
    const confirmation = await waitForPhotoThumbnails(
      files.length,
      BUDGET.THUMBNAIL_WAIT_MS,
      photoEvidenceBaseline,
    );
    if (confirmation.confirmed && !_photosConfirmed) {
      stateLog(
        `Photo upload: Facebook confirmed ${confirmation.count} photo(s) via ${confirmation.source}`,
      );
      _photosConfirmed = true;
      send({
        type: "SEND_JOB_EVENT", jobId, event: "thumbnail_detected",
        details: `${confirmation.count} photo(s) confirmed via ${confirmation.source}`
      }).catch(() => { });
    } else if (!confirmation.confirmed) {
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

  function readFacebookPhotoCounter(root = document) {
    const text = root?.body?.innerText || root?.innerText || "";
    const slashMatch = text.match(/(?:photos?|fotos?)\s*[·:\-]?\s*(\d+)\s*\/\s*\d+/i);
    if (slashMatch) return Number.parseInt(slashMatch[1], 10) || 0;
    const wordMatch = text.match(/(\d+)\s*(?:photos?|fotos?)\b/i);
    return wordMatch ? Number.parseInt(wordMatch[1], 10) || 0 : 0;
  }

  function photoEvidenceSignature(element, kind) {
    const src = element?.currentSrc || element?.src || element?.getAttribute?.("src") || "";
    const style = element?.getAttribute?.("style") || "";
    const label = element?.getAttribute?.("aria-label") || "";
    const testId = element?.getAttribute?.("data-testid") || "";
    return `${kind}|${src}|${style}|${label}|${testId}`;
  }

  function collectFacebookPhotoEvidence(root = document) {
    const nodes = new Set();
    const signatures = new Set();
    const strongSelectors = [
      ["delete-control", '[data-testid="media-attachment-delete-button"]'],
      ["preview", '[data-testid="media-attachment-preview"]'],
      ["blob-image", 'img[src^="blob:"]'],
      ["data-image", 'img[src^="data:image/"]'],
      ["remove-photo", '[aria-label*="remove photo" i]'],
      ["remove-image", '[aria-label*="remove image" i]'],
      ["remove-photo-es", '[aria-label*="eliminar foto" i]'],
      ["remove-image-es", '[aria-label*="eliminar imagen" i]'],
      ["remove-photo-es", '[aria-label*="quitar foto" i]'],
      ["remove-image-es", '[aria-label*="quitar imagen" i]'],
    ];

    for (const [kind, selector] of strongSelectors) {
      for (const element of root?.querySelectorAll?.(selector) || []) {
        nodes.add(element);
        signatures.add(photoEvidenceSignature(element, kind));
      }
    }

    return {
      counter: readFacebookPhotoCounter(root),
      nodes,
      signatures,
    };
  }

  function compareFacebookPhotoEvidence(current, baseline) {
    const before = baseline || { counter: 0, nodes: new Set(), signatures: new Set() };
    if (current.counter > 0 && current.counter > (before.counter || 0)) {
      return { confirmed: true, count: current.counter, source: "photo_counter" };
    }

    const newNodes = [...current.nodes].filter((node) => !before.nodes?.has(node));
    const newSignatures = [...current.signatures].filter(
      (signature) => !before.signatures?.has(signature),
    );
    const count = Math.max(newNodes.length, newSignatures.length);
    return count > 0
      ? { confirmed: true, count, source: "new_thumbnail_dom" }
      : { confirmed: false, count: 0, source: "none" };
  }

  function readExistingFacebookPhotoEvidence(root = document) {
    const snapshot = collectFacebookPhotoEvidence(root);
    if (snapshot.counter > 0) {
      return { confirmed: true, count: snapshot.counter, source: "photo_counter" };
    }
    if (snapshot.nodes.size > 0) {
      return { confirmed: true, count: snapshot.nodes.size, source: "thumbnail_dom" };
    }
    return { confirmed: false, count: 0, source: "none" };
  }

  async function waitForPhotoThumbnails(expectedCount, timeoutMs, baseline) {
    const start = Date.now();
    let lastMsg = 0;
    let stableKey = "";
    let stableSince = 0;
    const PHOTO_CONFIRMATION_STABLE_MS = 750;

    while (Date.now() - start < timeoutMs) {
      const evidence = compareFacebookPhotoEvidence(
        collectFacebookPhotoEvidence(),
        baseline,
      );
      if (evidence.confirmed) {
        const nextStableKey = `${evidence.source}:${evidence.count}`;
        if (nextStableKey !== stableKey) {
          stableKey = nextStableKey;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= PHOTO_CONFIRMATION_STABLE_MS) {
          stateLog(
            `Photo evidence stable: ${evidence.count} / ${expectedCount} via ${evidence.source}`,
          );
          return evidence;
        }
      } else {
        stableKey = "";
        stableSince = 0;
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
    return { confirmed: false, count: 0, source: "timeout" };
  }

  // ── Auto-retry helper ────────────────────────────────────────────────────────
  // On first failure: fails the job, resets it to Queued on the backend, then
  // navigates back to the Marketplace create page so the content script picks
  // it up fresh. On second+ failure: returns false so the caller renders review.

  function closeMarketplaceTabSoon(delayMs = 1200) {
    setTimeout(() => {
      send({
        type: "CLOSE_MARKETPLACE_TABS",
        currentUrl: window.location.href,
        reason: "publish_flow_finished",
      }).catch(() => {
        send({ type: "CLOSE_CURRENT_TAB" }).catch(() => { });
      });
    }, delayMs);
  }

  const SIDE_EFFECT_JOB_STATUSES = new Set([
    "Claimed",
    "Publishing",
    "Opening Facebook",
    "Filling Form",
    "Auto Publishing",
    "Ready for Review",
  ]);

  async function validateJobBeforeMarketplaceSideEffect(job, checkpoint) {
    const { activeJob } = await chrome.storage.local.get("activeJob");
    if (!activeJob || Number(activeJob.id) !== Number(job.id)) {
      return {
        ok: false,
        stale: true,
        reason: `Stopped before ${checkpoint}: this tab no longer owns job #${job.id}.`,
      };
    }

    const validation = await send({ type: "VALIDATE_JOB", jobId: job.id }).catch(() => null);
    const progress = validation?.ok ? validation.data : null;
    if (!progress || !progress.status) {
      return {
        ok: false,
        stale: false,
        reason: `Stopped before ${checkpoint}: DealerPilot could not confirm the current job state.`,
      };
    }

    if (!SIDE_EFFECT_JOB_STATUSES.has(progress.status)) {
      return {
        ok: false,
        stale: true,
        reason: `Stopped before ${checkpoint}: job #${job.id} is ${progress.status}, not actively publishing.`,
      };
    }

    return { ok: true, status: progress.status };
  }

  async function stopStaleMarketplaceFlow(job, gate) {
    stateLog(gate.reason);
    setStatus(gate.reason, "err");
    send({
      type: "SEND_JOB_EVENT",
      jobId: job.id,
      event: "side_effect_blocked",
      details: gate.reason,
    }).catch(() => { });

    if (gate.stale) {
      await chrome.storage.local.remove("activeJob");
      await send({ type: "POLL_NOW" }).catch(() => { });
    }
  }

  async function handleAutoRetry(job, reason, extras) {
    const retryCount = job._retryCount ?? 0;
    if (retryCount >= 1) {
      // Already retried once. Move on so one incompatible form cannot block
      // every later vehicle in the queue.
      await send({ type: "MARK_NEEDS_REVIEW", jobId: job.id, reason });
      await chrome.storage.local.remove("activeJob");
      setStatus(`Skipped job #${job.id}: ${reason}. Checking the next vehicle…`, "err");
      // Background normally reloads this tab as soon as it claims the next job.
      // Keep a navigation fallback so a transient tab-update failure cannot
      // leave the rejected Facebook form on screen.
      setTimeout(() => {
        window.location.replace("https://www.facebook.com/marketplace/create/vehicle");
      }, 2000);
      await send({ type: "POLL_NOW" }).catch(() => { });
      return true;
    }

    stateLog(`Auto-retry: first failure — "${reason}" — will retry job #${job.id}`);
    setStatus("First attempt failed — auto-retrying in 4 s…", "err");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_retry_pending", details: reason }).catch(() => { });

    try {
      await send({ type: "FAIL_JOB", jobId: job.id, reason: `${reason} [auto-retry pending]` });
      const retryRes = await send({ type: "RETRY_JOB", jobId: job.id });
      if (!retryRes || !retryRes.ok) throw new Error(retryRes?.error ?? "Retry API call failed");

      // The backend owns the retry transition. Clear this tab's ownership and
      // let the queue claim the Queued job again before another form can start.
      // Reusing activeJob here allowed an old tab to continue after the backend
      // had cancelled or requeued the job.
      await chrome.storage.local.remove("activeJob");
      await chrome.storage.local.set({
        pendingRetry: { jobId: job.id, retryCount: retryCount + 1, at: new Date().toISOString() },
      });

      setStatus("Auto-retry: waiting for DealerPilot to reclaim the job...");
      await send({ type: "POLL_NOW" });
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
    await settleMarketplaceFormBeforeNext();

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

    await send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "next_enabled" }).catch(() => { });

    setStatus("Auto-publishing — clicking Next…");
    const nextTexts = ["next", "continue", "next step", "siguiente", "continuar"];
    const nextButton = await waitForEnabledButtonByText(nextTexts, 10000);
    if (!nextButton) {
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

    const nextGate = await validateJobBeforeMarketplaceSideEffect(job, "clicking Next");
    if (!nextGate.ok) {
      await stopStaleMarketplaceFlow(job, nextGate);
      return;
    }

    const nextText = normalizeText(nextButton.innerText || nextButton.textContent || "");
    log("Auto-publish clicking:", nextText);
    nextButton.click();

    stateLog("Auto-publish: Next clicked, waiting for Publish button…");
    setStatus("Auto-publishing — waiting for Publish button…");
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "next_clicked" }).catch(() => { });
    send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "clicking_next" }).catch(() => { });
    await sleep(500);

    const publishOutcome = await clickPublishUntilListingUrl(job);
    const listingUrl = publishOutcome.listingUrl;
    if (!listingUrl) {
      if (publishOutcome.jobAborted) {
        return;
      }
      if (publishOutcome.publishedLanding) {
        const reason = "Facebook accepted the publish and opened Your Listings, but the individual listing URL was not available.";
        stateLog("Auto-publish: Facebook selling page confirmed; URL pending review");
        await send({ type: "MARK_NEEDS_REVIEW", jobId: job.id, reason });
        await chrome.storage.local.remove("activeJob");
        setStatus("✓ Published on Facebook. URL pending review; continuing with the next vehicle.", "ok");
        clearOutput();
        jobBoxEl.innerHTML = `
          <div class="mai-job">
            <div class="mai-job-title">Published on Facebook ✓</div>
            <div class="mai-job-meta">Job #${escapeHtml(String(job.id))} moved to Needs Review only because Facebook did not expose its individual URL.</div>
            <div class="mai-job-meta">Loading the next eligible vehicle…</div>
          </div>`;
        await send({ type: "POLL_NOW" }).catch(() => { });
        closeMarketplaceTabSoon();
        return;
      }
      const reason = publishOutcome.blockReason
        ? `Facebook blocked publishing: ${publishOutcome.blockReason}`
        : "Publish was clicked, but DealerPilot could not confirm a live Marketplace listing URL. " +
        "Facebook may require one more Publish click or manual review.";
      stateError("Auto-publish: live listing not confirmed", new Error(reason));
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "auto_publish_failed", details: reason }).catch(() => { });
      const failResult = await send({ type: "MARK_NEEDS_REVIEW", jobId: job.id, reason });
      await chrome.storage.local.remove("activeJob");
      if (!failResult || !failResult.ok) {
        setStatus("Could not record review state: " + (failResult && failResult.error), "err");
      } else {
        setStatus(reason + " Continuing with the next vehicle.", "err");
      }
      await send({ type: "POLL_NOW" }).catch(() => { });
      closeMarketplaceTabSoon();
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
      closeMarketplaceTabSoon();
      return;
    }

    setTimeout(() => {
      send({ type: "POLL_NOW" }).catch(() => { });
    }, 1500);
    closeMarketplaceTabSoon(2200);

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
      const publishButton = await waitForEnabledButtonByText(publishTexts, attempt === 1 ? 15000 : 7000);
      if (!publishButton) {
        return { listingUrl: null, blockReason: "Publish button was not available.", publishedLanding: false };
      }

      const publishGate = await validateJobBeforeMarketplaceSideEffect(job, `Publish click ${attempt}`);
      if (!publishGate.ok) {
        await stopStaleMarketplaceFlow(job, publishGate);
        return { listingUrl: null, blockReason: publishGate.reason, publishedLanding: false, jobAborted: true };
      }

      const publishText = normalizeText(publishButton.innerText || publishButton.textContent || "");
      log("Auto-publish clicking:", publishText);
      publishButton.click();

      stateLog(`Auto-publish: Publish click ${attempt}, waiting for Marketplace confirmation...`);
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "publish_clicked" }).catch(() => { });
      send({ type: "SEND_JOB_EVENT", jobId: job.id, event: "clicking_publish" }).catch(() => { });
      await sleep(900);

      const outcome = await waitForPublishOutcome(job, attempt === 1 ? 12000 : 22000);
      if (outcome.listingUrl || outcome.blockReason || outcome.publishedLanding) return outcome;

      // Some Facebook sessions show a final confirmation dialog with another
      // Publish/Post button. Try once more only when that button is still visible.
      if (!findEnabledButtonByText(publishTexts)) return outcome;
    }
    return { listingUrl: null, blockReason: null, publishedLanding: false };
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

  function findButtonByText(textOptions) {
    const candidates = Array.from(
      document.querySelectorAll('div[role="button"], button, [role="button"]'),
    );
    const normalizedOptions = textOptions.map(normalizeText);
    for (const el of candidates) {
      const text = normalizeText(el.innerText || el.textContent || "");
      if (normalizedOptions.some((t) => text === t || text === t + " ")) return el;
    }
    return null;
  }

  async function waitForEnabledButtonByText(textOptions, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const btn = findEnabledButtonByText(textOptions);
      if (btn) return btn;
      await sleep(400);
    }
    return findEnabledButtonByText(textOptions);
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
      while (Date.now() - photoStart < PHOTO_POLL_MS) {
        // Only accept a Facebook counter or controls that represent an actual
        // uploaded preview. Generic "Add photos" icons are intentionally not
        // evidence because they exist before any file is selected.
        const evidence = readExistingFacebookPhotoEvidence();
        if (evidence.confirmed) { hasPhoto = true; break; }
        await sleep(600);
      }
    }
    // Some localized Marketplace forms omit certain optional fields
    // entirely (no combobox / input rendered). If a "missed" field
    // refers to a color field that does not exist in the current DOM,
    // treat it as non-blocking for the pre-Next validation. This prevents
    // blocking auto-publish when Facebook's form variant simply doesn't
    // render exterior/interior color controls.
    function fieldPresentOnPage(fieldName) {
      if (!isMarketplaceColorField(fieldName)) return true;

      const control = findVisibleColorControl(fieldName);
      return Boolean(control);
    }

    const effectiveMissed = missed.filter((m) => fieldPresentOnPage(m));
    const skippedColorFields = missed.filter((m) => {
      return isMarketplaceColorField(m) && fieldPresentOnPage(m) === false;
    });
    const skippedVehicleDetailFields = [...new Set(warnings
      .map((w) => String(w || "").match(/^(condition|fuel type|transmission): skipped\b/i)?.[1])
      .filter(Boolean))];

    // Debug: log presence map and persist for inspection if auto-start still fails
    try {
      const presenceMap = {};
      for (const m of missed) {
        try { presenceMap[m] = fieldPresentOnPage(m); } catch (e) { presenceMap[m] = `error: ${e && e.message}`; }
      }
      console.log(`[VALIDATION DEBUG] missed:`, missed, `effectiveMissed:`, effectiveMissed, `skippedColorFields:`, skippedColorFields, `presenceMap:`, presenceMap);
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ lastValidationDebug: { at: new Date().toISOString(), missed, effectiveMissed, presenceMap } }).catch(() => {});
      }
    } catch (e) { console.warn('[VALIDATION DEBUG] failed to write debug storage', e); }

    if (!hasPhoto) {
      return {
        ok: false,
        reason: "Photo upload not confirmed by Facebook - refusing to continue to Next/Publish",
      };
    }

    await settleMarketplaceFormBeforeNext();

    const blockingIdentityFields = effectiveMissed.filter((fieldName) => {
      return ["year", "make"].includes(normalizeText(fieldName));
    });
    if (blockingIdentityFields.length > 0) {
      return {
        ok: false,
        reason: `Vehicle identity fields did not verify: ${blockingIdentityFields.join(", ")}. Refusing to click Next/Publish.`,
      };
    }

    // 2. Check Next button exists and becomes enabled. Facebook can take a few
    // seconds after the last checkbox/dropdown change to recalculate readiness.
    const NEXT_TEXTS = ["next", "continue", "next step", "siguiente", "continuar"];
    const readyNext = await waitForEnabledButtonByText(NEXT_TEXTS, 20000);
    if (readyNext) return { ok: true };

    const nextBtn = findButtonByText(NEXT_TEXTS);
    if (!nextBtn) {
      const fbErrors = scrapeFacebookErrors();
      return {
        ok: false,
        reason: fbErrors
          ? `Form not ready for Next: ${fbErrors}`
          : "Next button not found on page — form may not have loaded correctly",
      };
    }

    const fbErrors = scrapeFacebookErrors();
    const nextDiagnostics = collectDisabledNextDiagnostics();
    try {
      console.log("[VALIDATION DEBUG] next disabled diagnostics:", nextDiagnostics);
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          lastNextDisabledDiagnostics: {
            at: new Date().toISOString(),
            diagnostics: nextDiagnostics,
            bodySnippet: (document.body?.innerText || "").slice(0, 4000),
          },
        }).catch(() => {});
      }
    } catch (_) { /* noop */ }
    const diagnosticSuffix = nextDiagnostics.length
      ? ` Possible blocked controls: ${nextDiagnostics.join(" | ")}.`
      : "";
    return {
      ok: false,
      reason: fbErrors
        ? `Next button is disabled: ${fbErrors}`
        : effectiveMissed.length > 0
          ? `Next button is disabled — required fields not selected: ${effectiveMissed.join(", ")}. Check those fields on the form.${diagnosticSuffix}`
          : skippedVehicleDetailFields.length > 0
            ? `Next button is disabled — required vehicle details not selected: ${skippedVehicleDetailFields.join(", ")}. Check those fields on the form.${diagnosticSuffix}`
            : `Next button is disabled — Facebook still has a required field unselected after waiting 20 seconds. Check clean title and visible vehicle details on the form.${diagnosticSuffix}`,
    };
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
    const isNonBlockingValidationText = (value) => {
      const text = normalizePublishText(value);
      if (!text) return true;
      return /\b(valid|valido|valida|correct|correcto|correcta)\b/.test(text)
        && !/\b(invalid|invalido|invalida|error|required|obligatorio|obligatoria|missing|falta)\b/.test(text);
    };
    for (const sel of errorSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const t = (el.innerText || el.textContent || "").trim();
        if (t && t.length < 200 && !isNonBlockingValidationText(t)) errors.push(t);
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

  function findMarketplaceListingUrlOnPage(job) {
    const anchors = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'));
    if (anchors.length === 0) return null;

    const expectedTokens = expectedMarketplaceListingTokens(job);

    for (const anchor of anchors) {
      const href = anchor.href;
      if (!href) continue;
      const text = normalizeText(
        [
          anchor.innerText || anchor.textContent || "",
          anchor.closest('[role="button"], [role="article"], div')?.innerText || "",
        ].join(" "),
      );
      if (marketplaceTextMatchesExpectedListing(text, expectedTokens)) {
        return href;
      }
    }


    return null;
  }

  function expectedMarketplaceListingTokens(job) {
    const fallbackVehicleLabel = [
      job?.year,
      job?.make,
      job?.model,
    ].filter(Boolean).join(" ");
    const expectedLabel = normalizeText(
      job?.vehicleLabel || job?.listingTitle || job?.title || fallbackVehicleLabel,
    );
    return expectedLabel
      ? expectedLabel.split(/\s+/).filter((token) => token.length >= 3)
      : [];
  }

  function marketplaceTextMatchesExpectedListing(text, expectedTokens) {
    if (expectedTokens.length === 0) return false;
    const normalized = normalizeText(text);
    return expectedTokens.every((token) => normalized.includes(token));
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function detectMarketplaceYearMismatchOnPage(job) {
    const expectedYear = String(job?.year || "").trim();
    const make = normalizeText(job?.make || "");
    const model = normalizeText(job?.model || "");
    if (!/^(?:19|20)\d{2}$/.test(expectedYear) || !make || !model) return null;

    const normalizedBody = normalizeText(document.body?.innerText || "");
    const pattern = new RegExp(`\\b((?:19|20)\\d{2})\\s+${escapeRegExp(make)}\\s+${escapeRegExp(model)}\\b`, "i");
    const match = normalizedBody.match(pattern);
    if (!match || match[1] === expectedYear) return null;

    return `Facebook appears to show this vehicle as ${match[1]} ${job.make} ${job.model}, but DealerPilot expected ${expectedYear} ${job.make} ${job.model}.`;
  }

  function currentMarketplaceItemMatchesJob(job) {
    if (!window.location.href.includes("/marketplace/item/")) return false;
    const expectedTokens = expectedMarketplaceListingTokens(job);
    return marketplaceTextMatchesExpectedListing(document.body?.innerText || "", expectedTokens);
  }

  async function findMarketplaceListingUrlFromSellerDialog(job) {
    const expectedTokens = expectedMarketplaceListingTokens(job);
    if (expectedTokens.length === 0) return null;

    const candidates = Array.from(document.querySelectorAll('[role="button"], button, a'))
      .filter((el) => {
        const text = normalizeText(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
        if (!marketplaceTextMatchesExpectedListing(text, expectedTokens)) return false;
        if (/mas opciones|more options|marcar como|compartir|share|promocionar|boost|edit|editar|eliminar/.test(text)) {
          return false;
        }
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      });

    for (const candidate of candidates) {
      try {
        candidate.scrollIntoView?.({ block: "center", inline: "nearest" });
        await sleep(250);
        candidate.click();
        await sleep(1800);

        const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
          .find((el) => marketplaceTextMatchesExpectedListing(el.innerText || el.textContent || "", expectedTokens));
        if (!dialog) continue;

        const listingLink = Array.from(dialog.querySelectorAll('a[href*="/marketplace/item/"]'))
          .find((anchor) => marketplaceTextMatchesExpectedListing(anchor.innerText || anchor.textContent || dialog.innerText || "", expectedTokens));
        if (listingLink?.href) return listingLink.href;
      } catch (err) {
        console.warn("[DealerPilot AI] seller dialog listing URL lookup failed", err);
      }
    }

    return null;
  }

  async function waitForPublishOutcome(job, timeoutMs) {
    const startUrl = window.location.href;
    const start = Date.now();
    let sawSellingLanding = false;
    while (Date.now() - start < timeoutMs) {
      const cur = window.location.href;
      if (cur !== startUrl && cur.includes("/marketplace/item/")) {
        if (currentMarketplaceItemMatchesJob(job)) {
          return { listingUrl: cur, blockReason: null, publishedLanding: false };
        }
      }
      if (cur !== startUrl && cur.includes("/marketplace/you/selling")) {
        sawSellingLanding = true;
        const yearMismatch = detectMarketplaceYearMismatchOnPage(job);
        if (yearMismatch) return { listingUrl: null, blockReason: yearMismatch, publishedLanding: false };
        const listingUrl =
          findMarketplaceListingUrlOnPage(job) ||
          await findMarketplaceListingUrlFromSellerDialog(job);
        if (listingUrl) return { listingUrl, blockReason: null, publishedLanding: true };
      }
      const successEl =
        document.querySelector('[aria-label*="listed" i]') ||
        document.querySelector('[data-testid*="success" i]');
      if (successEl && window.location.href.includes("/marketplace/item/")) {
        return { listingUrl: window.location.href, blockReason: null, publishedLanding: false };
      }
      const blockReason = detectMarketplacePublishBlock();
      if (blockReason) return { listingUrl: null, blockReason, publishedLanding: false };
      await sleep(500);
    }
    const final = window.location.href;
    if (final !== startUrl && final.includes("/marketplace/item/")) {
      if (currentMarketplaceItemMatchesJob(job)) {
        return { listingUrl: final, blockReason: null, publishedLanding: false };
      }
      return {
        listingUrl: null,
        blockReason: "Facebook opened a Marketplace item URL that does not match this vehicle.",
        publishedLanding: false,
      };
    }
    if (final !== startUrl && final.includes("/marketplace/you/selling")) {
      const yearMismatch = detectMarketplaceYearMismatchOnPage(job);
      if (yearMismatch) {
        return {
          listingUrl: null,
          blockReason: yearMismatch,
          publishedLanding: false,
        };
      }
      const listingUrl =
        findMarketplaceListingUrlOnPage(job) ||
        await findMarketplaceListingUrlFromSellerDialog(job);
      if (!listingUrl) {
        return {
          listingUrl: null,
          blockReason: "Facebook Your Listings did not expose a Marketplace item URL matching this vehicle.",
          publishedLanding: false,
        };
      }
      return {
        listingUrl,
        blockReason: null,
        publishedLanding: true,
      };
    }
    return { listingUrl: null, blockReason: detectMarketplacePublishBlock(), publishedLanding: sawSellingLanding };
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
        closeMarketplaceTabSoon(2200);
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

  function marketplaceItemKey(url) {
    try {
      const parsed = new URL(url, location.origin);
      const match = parsed.pathname.match(/\/marketplace\/item\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  function currentPageMatchesSoldAction(action) {
    const currentKey = marketplaceItemKey(location.href);
    const targetKey = marketplaceItemKey(action?.listingUrl || "");
    if (currentKey && targetKey) return currentKey === targetKey;
    return action?.listingUrl && location.href.split("?")[0] === String(action.listingUrl).split("?")[0];
  }

  async function openMarketplaceListingActionMenu() {
    const menuLabels = ["more options", "more", "options", "mas opciones", "más opciones", "opciones", "acciones"];
    const candidates = Array.from(document.querySelectorAll('div[role="button"], button, [role="button"]'));
    for (const el of candidates) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled")) continue;
      const label = normalizeText(
        [
          el.getAttribute("aria-label"),
          el.getAttribute("title"),
          el.innerText,
          el.textContent,
        ].filter(Boolean).join(" "),
      );
      if (!label) continue;
      if (menuLabels.some((text) => label.includes(text))) {
        el.scrollIntoView?.({ block: "center", inline: "nearest" });
        await sleep(250);
        el.click();
        await sleep(900);
        return true;
      }
    }
    return false;
  }

  async function runMarketplaceSoldAction() {
    const { activeSoldAction, soldActionCompletedId } = await chrome.storage.local.get([
      "activeSoldAction",
      "soldActionCompletedId",
    ]);
    if (!activeSoldAction?.listingUrl || activeSoldAction.listingId === soldActionCompletedId) return;
    if (!currentPageMatchesSoldAction(activeSoldAction)) return;

    const soldTexts = [
      "mark as sold",
      "mark sold",
      "sold",
      "marcar como vendido",
      "marcar vendido",
      "vendido",
    ];
    setStatus(`Marking Marketplace listing sold: ${activeSoldAction.label || activeSoldAction.vehicleId || ""}`.trim());
    await sleep(1200);

    let clicked = await clickButtonByText(soldTexts, 2500);
    if (!clicked) {
      const menuOpened = await openMarketplaceListingActionMenu();
      if (menuOpened) clicked = await clickButtonByText(soldTexts, 5000);
    }

    if (!clicked) {
      const reason = "Could not find Facebook's Mark as Sold control on this listing.";
      await chrome.storage.local.set({
        soldActionLastError: reason,
        soldActionLastErrorAt: new Date().toISOString(),
      });
      setStatus(reason, "err");
      return;
    }

    await clickButtonByText(
      ["confirm", "done", "save", "mark as sold", "confirmar", "listo", "guardar", "marcar como vendido"],
      4000,
    );
    await chrome.storage.local.set({
      soldActionCompletedId: activeSoldAction.listingId,
      soldActionCompletedAt: new Date().toISOString(),
    });
    await chrome.storage.local.remove("activeSoldAction");
    setStatus("Marketplace listing marked sold. DealerPilot will not republish this vehicle.", "ok");
  }

  // ==================================================================
  // Marketplace create page — job flow + debug button
  // ==================================================================
  if (isMarketplaceItem) {
    setTimeout(() => {
      runMarketplaceSoldAction().catch((err) => {
        stateError("Marketplace sold action failed", err);
      });
    }, 1600);
  }

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
              "Claimed",
              "Publishing",
              "Opening Facebook",
              "Filling Form",
              "Auto Publishing",
              "Ready for Review",
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
        const restoreRes = await send({ type: "RESTORE_ACTIVE_JOB" }).catch(() => null);
        const restoredJob = restoreRes?.ok && restoreRes.data?.job ? restoreRes.data.job : null;
        if (restoredJob) {
          console.log(`[DealerPilot AI] [AUDIT] restored activeJob #${restoredJob.id} — auto-starting flow`);
          actionsEl.appendChild(
            button("Fill Marketplace Fields", () => runPublishingFlow(restoredJob)),
          );
          setTimeout(() => runPublishingFlow(restoredJob), 1200);
          return;
        }

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
  let messengerControlsStarted = false;
  let lastMessengerCaptureHash = "";
  let lastMessengerAutoSendHash = "";
  let lastMessengerHistoryHydrationKey = "";
  let messengerCaptureInFlight = false;
  let lastReply = "";
  const MESSENGER_REPLY_QUIET_MS = 7000;
  const MESSENGER_CAPTURE_INTERVAL_MS = 2000;
  const MESSENGER_OWN_REPLY_GUARD_MS = 120000;
  let pendingMessengerBuyerHash = "";
  let pendingMessengerBuyerSince = 0;
  let pendingMessengerMessageDetectedAt = 0;
  let lastMessengerAutoReplyText = "";
  let lastMessengerAutoReplyAt = 0;
  let lastMessengerAutoSendFailureReason = "";
  let lastMessengerAutoSendMethod = "";
  let lastMessengerSendDiagnostics = {};
  let lastMarketplaceQuickReplyDiagnostics = null;
  let messengerInboxDiscoveryInFlight = false;
  let lastMessengerInboxCandidateKey = "";
  let lastMessengerInboxCandidateOpenedAt = 0;
  const MESSENGER_INBOX_DISCOVERY_RETRY_MS = 5000;

  function safeSalesAiUrl() {
    return `${location.origin}${location.pathname}`;
  }

  function validateFacebookSellerProfile(root = document) {
    const expected = ["alpha manassas", "alpha motorsport", "andres ibanez"];
    const labels = Array.from(root?.querySelectorAll?.("[aria-label]") || [])
      .map((element) => element.getAttribute("aria-label") || "")
      .filter(Boolean);
    const match = labels.map((label) => {
      const result = label.match(/(?:manage|administrar)\s+(.+?)\s+(?:notification settings|configuraci[oÃ³]n(?:es)? de notificaciones)/i) ||
        label.match(/(?:your profile|tu perfil)\s*[:\-]\s*(.+)$/i);
      return String(result?.[1] || "").replace(/\s+/g, " ").trim();
    }).find(Boolean) || "";
    const normalized = match.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return {
      currentProfileName: match,
      expectedProfileNames: ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
      matched: expected.includes(normalized),
    };
  }

  function reportMessengerCaptureDebug(stage, details = {}) {
    void send({
      type: "MESSENGER_CAPTURE_DEBUG",
      debug: {
        at: new Date().toISOString(),
        stage,
        sourceUrl: safeSalesAiUrl(),
        ...details,
      },
    }).catch(() => {});
  }

  function getMessengerMessageBox() {
    const threadRoot = findMessengerRoot();
    const candidates = Array.from(
      document.querySelectorAll(
        '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label], textarea[aria-label]',
      ),
    ).filter((box) => {
      if (!visible(box)) return false;
      const label = `${box.getAttribute("aria-label") || ""} ${box.getAttribute("data-lexical-editor") || ""}`;
      if (/search|buscar|comment|comentario|post|publicaci\u00f3n/i.test(label)) return false;
      return /message|mensaje|lexical/i.test(label) || !!threadRoot?.contains(box);
    });

    const insideThread = candidates.find((box) => threadRoot?.contains(box));
    if (insideThread) return insideThread;
    return candidates.sort((left, right) =>
      right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom,
    )[0] || null;
  }

  function clickMarketplaceInboxCandidate(candidate) {
    const element = candidate?.element;
    if (!element) return false;
    try {
      element.focus?.();
      const eventInit = { bubbles: true, cancelable: true, view: window };
      element.dispatchEvent?.(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent?.(new MouseEvent("mouseup", eventInit));
      if (typeof element.click === "function") element.click();
      else element.dispatchEvent?.(new MouseEvent("click", eventInit));
      return true;
    } catch (error) {
      console.warn("[DealerPilot AI] Marketplace inbox row could not be opened", error);
      return false;
    }
  }

  function discoverMarketplaceInboxConversation() {
    const capture = globalThis.DealerPilotMessengerCapture;
    if (!capture?.findInboxConversationCandidate || !/\/marketplace\/inbox\b/i.test(location.pathname || "")) return;

    // An active thread is the only surface allowed to reach the scraper. The
    // discovery phase is finished as soon as Facebook renders its composer.
    if (isMessengerUiVisible()) {
      messengerInboxDiscoveryInFlight = false;
      lastMessengerInboxCandidateKey = "";
      return;
    }
    if (messengerInboxDiscoveryInFlight) return;

    const sellerProfile = validateFacebookSellerProfile(document);
    if (!sellerProfile.matched) {
      reportMessengerCaptureDebug("inbox_discovery_blocked", {
        reason: "seller_profile_unmatched",
        sellerProfileName: sellerProfile.currentProfileName || "",
        sellerProfileMatched: false,
        discoveryRoute: safeSalesAiUrl(),
      });
      return;
    }

    const candidate = capture.findInboxConversationCandidate({ document, location });
    if (!candidate) {
      reportMessengerCaptureDebug("inbox_discovery_waiting", {
        reason: "marketplace_inbox_candidate_missing",
        sellerProfileName: sellerProfile.currentProfileName || "",
        sellerProfileMatched: true,
        discoveryRoute: safeSalesAiUrl(),
      });
      return;
    }

    const now = Date.now();
    if (
      candidate.key === lastMessengerInboxCandidateKey &&
      now - lastMessengerInboxCandidateOpenedAt < MESSENGER_INBOX_DISCOVERY_RETRY_MS
    ) return;

    messengerInboxDiscoveryInFlight = true;
    lastMessengerInboxCandidateKey = candidate.key;
    lastMessengerInboxCandidateOpenedAt = now;
    const opened = clickMarketplaceInboxCandidate(candidate);
    reportMessengerCaptureDebug(opened ? "inbox_thread_open_requested" : "inbox_thread_open_failed", {
      reason: opened ? undefined : "dom_click_failed",
      candidateKey: candidate.key,
      candidateText: candidate.text,
      candidateScore: candidate.score,
      sellerProfileName: sellerProfile.currentProfileName || "",
      sellerProfileMatched: true,
      discoveryRoute: safeSalesAiUrl(),
    });
    if (!opened) messengerInboxDiscoveryInFlight = false;
    setTimeout(() => {
      if (!isMessengerUiVisible()) messengerInboxDiscoveryInFlight = false;
    }, MESSENGER_INBOX_DISCOVERY_RETRY_MS);
  }

  function initMessengerAiControls() {
    if (!messengerControlsStarted) discoverMarketplaceInboxConversation();
    if (messengerControlsStarted || !isMessengerUiVisible()) return;
    messengerControlsStarted = true;

    // ---- Structured chat scraping ----
    // Extracts individual messages with speaker attribution instead of raw innerText.
    const MESSENGER_UI_TEXT = new Set([
      "aa",
      "active",
      "archive",
      "anyone can find this group",
      "anyone can see who's in the group and what they post",
      "about",
      "chat members",
      "close",
      "compose",
      "copy link",
      "customize chat",
      "delete chat",
      "edit nicknames",
      "emoji",
      "enter",
      "esc",
      "facebook",
      "feed",
      "group",
      "message",
      "message...",
      "messenger",
      "more",
      "mute",
      "notifications",
      "people",
      "privacy & support",
      "public",
      "recent media",
      "saved",
      "search",
      "search in conversation",
      "see all",
      "send",
      "send in messenger",
      "share",
      "share now",
      "share to",
      "visible",
      "view profile",
      "write to saved",
    ]);

    function cleanMessengerText(text) {
      return (text || "")
        .replace(/\s+/g, " ")
        .replace(/^\s*(Enter|Return)\s*,?\s*/i, "")
        .replace(/\bMessage sent\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You\s*:?\s*/gi, "")
        .replace(/\bMessage sent\b/gi, "")
        .replace(/^\s*[:.,;]\s*/, "")
        .trim();
    }

    function isMessengerUiText(text) {
      const cleaned = cleanMessengerText(text);
      const normalized = cleaned.toLowerCase().replace(/[.。:;,\-–—]+$/g, "").trim();
      if (!normalized) return true;
      if (MESSENGER_UI_TEXT.has(normalized)) return true;
      if (/^(enter|escape|tab|shift|control|option|command|alt)\b/i.test(normalized)) return true;
      if (/^(write to saved|saved|compose|mute|search|customize chat|chat members|older listings will be deleted|this group consist|anyone can)\b/i.test(normalized)) return true;
      if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(normalized)) return true;
      return false;
    }

    // Profile labels are useful corroboration, but Facebook does not render
    // them consistently. The active thread's seller-only controls are the
    // primary evidence; an explicit "View seller" surface always rejects the
    // capture even if a profile label happens to match.
    const EXPECTED_FACEBOOK_SELLER_NAMES = [
      "Alpha Manassas",
      "Alpha Motorsport",
      "Andres Ibanez",
    ];

    function normalizeFacebookProfileName(value) {
      return cleanMessengerText(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    function extractFacebookCurrentProfileName(root = document) {
      const labels = Array.from(root?.querySelectorAll?.("[aria-label]") || [])
        .map((element) => element.getAttribute("aria-label") || "")
        .filter(Boolean);
      const patterns = [
        /(?:manage|administrar)\s+(.+?)\s+(?:notification settings|configuraci[oó]n(?:es)? de notificaciones)/i,
        /(?:your profile|tu perfil)\s*[:\-]\s*(.+)$/i,
      ];
      for (const label of labels) {
        for (const pattern of patterns) {
          const match = label.match(pattern);
          const candidate = cleanMessengerText(match?.[1] || "");
          if (candidate && candidate.length <= 80) return candidate;
        }
      }
      return "";
    }

    function validateFacebookSellerProfile(root = document) {
      const currentProfileName = extractFacebookCurrentProfileName(root);
      const normalizedCurrent = normalizeFacebookProfileName(currentProfileName);
      const expected = EXPECTED_FACEBOOK_SELLER_NAMES
        .map(normalizeFacebookProfileName)
        .filter(Boolean);
      const matched = !!normalizedCurrent && expected.includes(normalizedCurrent);
      return {
        currentProfileName,
        expectedProfileNames: EXPECTED_FACEBOOK_SELLER_NAMES,
        matched,
      };
    }

    function isReliableBuyerName(name) {
      const cleaned = cleanMessengerText(name);
      const normalized = cleaned.toLowerCase();
      if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return false;
      if (normalized === "unknown buyer" || normalized === "buyer" || normalized === "facebook") return false;
      if (isMessengerUiText(cleaned)) return false;
      if (/\b(19|20)\d{2}\b/.test(cleaned)) return false;
      if (/\b(honda|acura|toyota|marketplace|listing|vehicle|group|page|facebook)\b/i.test(cleaned)) return false;
      if (/[/$•·]/.test(cleaned)) return false;
      return true;
    }

    function isBlockedSalesAiRoute() {
      const pathname = location.pathname || "/";
      return (
        pathname === "/" ||
        /^\/(home\.php|feed)\b/i.test(pathname) ||
        /^\/(groups|pages|profile\.php|watch|reel|events)\b/i.test(pathname)
      );
    }

    function safeSalesAiUrl() {
      return `${location.origin}${location.pathname}`;
    }

    function getThreadHeadingText(root) {
      if (!root) return "";
      const inspected = globalThis.DealerPilotMessengerCapture?.inspectThread?.(root);
      if (inspected?.cleanedThreadHeader) return inspected.cleanedThreadHeader.slice(0, 160);
      const headings = Array.from(root.querySelectorAll('[role="heading"], h1, h2, h3'));
      const heading = headings.find((el) => /\b(19|20)\d{2}\b/.test(el.textContent || "")) || headings[0];
      if (heading) return cleanMessengerText(heading.textContent || "").slice(0, 160);

      // Marketplace floating chats currently expose the title as plain text
      // (for example "Juan - 2012 Mazda MAZDA3") without a heading role. Keep
      // this lookup inside the active thread and prefer compact nodes near its
      // top edge so a vehicle year mentioned in message history is not treated
      // as the conversation header.
      const rootRect = root.getBoundingClientRect();
      const visualHeading = Array.from(
        root.querySelectorAll('span[dir="auto"], div[dir="auto"], span, div'),
      )
        .filter(visible)
        .map((el) => ({ el, text: cleanMessengerText(el.innerText || el.textContent || "") }))
        .filter(({ el, text }) => {
          if (!text || text.length > 160 || !/\b(19|20)\d{2}\b/.test(text)) return false;
          if (!/^.{2,80}\s*(?:[-|\u00b7\u2022])\s*(?:19|20)\d{2}\b/.test(text)) return false;
          const rect = el.getBoundingClientRect();
          return rect.top >= rootRect.top - 4 && rect.top <= rootRect.top + 140;
        })
        .sort((left, right) => elementArea(left.el) - elementArea(right.el))[0];
      if (visualHeading) return visualHeading.text.slice(0, 160);

      return cleanMessengerText(root.getAttribute("aria-label") || "")
        .replace(/^(?:Conversaci\u00f3n con el t\u00edtulo|Conversation titled|Conversation with the title)\s*/i, "")
        .slice(0, 160);
    }

    function extractBuyerNameFromThreadHeader(headerText) {
      const candidate = cleanMessengerText(headerText).split(/\s+[\u00b7\u2022|]\s+/)[0] || "";
      return candidate.slice(0, 80);
    }

    function extractMessengerSenderName(descriptor) {
      const cleaned = cleanMessengerText(descriptor);
      const directed = cleaned.match(/(?:por|by)\s+([^:]{1,80}):\s*\S/i);
      const timestamped = cleaned.match(/,\s*([^,:]{1,80}):\s*\S/i);
      const match = directed || timestamped;
      if (!match) return "";
      const candidate = cleanMessengerText(match[1]);
      if (/^(?:tú|tu|you)$/i.test(candidate)) return "";
      return candidate.slice(0, 80);
    }

    function normalizeMessengerPersonName(value) {
      return cleanMessengerText(value)
        .replace(/^visto\s+por\s+/i, "")
        .replace(/\s+a\s+las\s+\d{1,2}:\d{2}\s*(?:am|pm).*$/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    function messengerNamesMatch(left, right) {
      const leftTokens = normalizeMessengerPersonName(left).split(" ").filter(Boolean);
      const rightTokens = normalizeMessengerPersonName(right).split(" ").filter(Boolean);
      if (!leftTokens.length || !rightTokens.length) return false;
      const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
      const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
      return shorter.every((token, index) => token === longer[index]);
    }

    function extractMessengerPersonNameFromAlt(value) {
      const normalized = normalizeMessengerPersonName(value);
      if (!normalized || normalized.length < 2 || normalized.length > 80) return "";
      if (/^(?:tÃº|tu|you|facebook|unknown|buyer|seller|dealer)$/i.test(normalized)) return "";
      if (!/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u.test(normalized)) return "";
      if (isMessengerUiText(normalized) || /\b(?:sent|mensaje|message|active|online|seen|visto)\b/i.test(normalized)) return "";
      return normalized;
    }

    function collectMessengerSellerNameCandidates(currentProfileName = "", profileMatched = false) {
      const configured = EXPECTED_FACEBOOK_SELLER_NAMES
        .map(extractMessengerPersonNameFromAlt)
        .filter(Boolean);
      const validatedCurrent = profileMatched
        ? extractMessengerPersonNameFromAlt(currentProfileName)
        : "";
      return [...configured, validatedCurrent]
        .filter(Boolean)
        .filter((name, index, names) => names.indexOf(name) === index);
    }

    function findStableMessengerThreadIdentity(root, messageScope) {
      const nodes = [root, messageScope].filter(Boolean);
      const isMeaningfulIdentity = (value) => {
        const normalized = normalizeThreadToken(value);
        return (
          /(?:thread|conversation|message)/i.test(value) &&
          normalized.length >= 8 &&
          !/^(?:mwthread|messenger-thread|conversation|message)$/.test(normalized)
        );
      };
      for (const node of nodes) {
        const candidates = [
          "data-thread-id",
          "data-conversation-id",
          "data-thread-key",
          "data-fb-thread-id",
          "data-testid",
          "id",
        ]
          .map((attribute) => node.getAttribute?.(attribute) || "")
          .filter(isMeaningfulIdentity);
        const hrefs = Array.from(node.querySelectorAll?.('a[href], [href]') || [])
          .map((element) => element.getAttribute?.("href") || "")
          .filter((value) => /(?:\/messages\/t\/|thread_id=|conversation_id=)/i.test(value));
        const candidate = [...candidates, ...hrefs].find((value) => value.length >= 6);
        if (candidate) return candidate.slice(0, 180);
      }
      return "";
    }

    function collectMatchedThreadSelectors(root) {
      const selectors = [
        '[role="region"][aria-label*="Conversaci\u00f3n con el t\u00edtulo" i]',
        '[role="region"][aria-label*="Conversation titled" i]',
        '[role="log"][aria-label*="Mensajes de la conversaci\u00f3n" i]',
        '[role="log"][aria-label*="Messages in the conversation" i]',
        'a[href*="/marketplace/item/"]',
        '[role="log"] article',
      ];
      return selectors.filter((selector) =>
        root?.matches?.(selector) || (root || document).querySelector(selector),
      ).slice(0, 12);
    }

    function findMessengerMessageScope(root) {
      if (!root) return null;
      const isolatedCapture = globalThis.DealerPilotMessengerCapture;
      if (isolatedCapture?.findMessageScope) {
        const isolatedScope = isolatedCapture.findMessageScope(root);
        if (isolatedScope) return isolatedScope;
      }
      const semanticLog = root.querySelector(
        [
          '[role="log"]',
          '[aria-live="polite"][aria-label*="message" i]',
          '[aria-live="polite"][aria-label*="mensaje" i]',
          '[aria-live="polite"][aria-label*="conversation" i]',
          '[aria-live="polite"][aria-label*="conversaci\u00f3n" i]',
        ].join(", "),
      );
      if (semanticLog) return semanticLog;

      // Current Marketplace chat popovers can omit role="log" entirely while
      // retaining accessible labels on individual messages. Use their closest
      // shared container; if Facebook also removes that wrapper, the already
      // validated active thread is the narrowest safe fallback scope.
      const semanticMessages = Array.from(root.querySelectorAll('[aria-label]')).filter((el) => {
        const descriptor = el.getAttribute("aria-label") || "";
        return visible(el) && /(?:por|by)\s+[^:]{1,80}:\s*\S|,\s*[^,:]{1,80}:\s*\S/i.test(descriptor);
      });
      if (!semanticMessages.length) return root;

      let candidate = semanticMessages[0].parentElement;
      while (candidate && candidate !== root) {
        if (semanticMessages.every((message) => candidate.contains(message))) return candidate;
        candidate = candidate.parentElement;
      }
      return root;
    }

    function getMessageDescriptor(el) {
      const labels = [
        el.getAttribute("aria-label") || "",
        ...Array.from(el.querySelectorAll('[aria-label]')).map((node) => node.getAttribute("aria-label") || ""),
      ].filter(Boolean);
      return labels.find((label) => /(?:por|by)\s+[^:]{1,80}:\s*\S|,\s*[^,:]{1,80}:\s*\S/i.test(label)) || labels[0] || "";
    }

    function parseSemanticMessengerMessage(el, sellerNameCandidates = []) {
      const descriptor = cleanMessengerText(getMessageDescriptor(el));
      const visibleText = cleanMessengerText(el.innerText || el.textContent || "");
      const directed = descriptor.match(/(?:por|by)\s+([^:]{1,80}):\s*(.+)$/i);
      const timestamped = descriptor.match(/,\s*([^,:]{1,80}):\s*(.+)$/i);
      const parsed = directed || timestamped;
      const text = cleanMessengerText(parsed?.[2] || visibleText);
      const explicitCurrentUser =
        /(?:por\s+(?:t\u00fa|ti)|by\s+you)\s*:/i.test(descriptor) ||
        /\b(?:sent by you|you sent|enviaste|enviado por ti)\b/i.test(descriptor) ||
        /^t\u00fa\s*:/i.test(descriptor);
      const senderName = extractMessengerSenderName(descriptor);
      const sellerNameMatch = !!senderName && sellerNameCandidates.some((candidate) => messengerNamesMatch(senderName, candidate));
      const sentByCurrentUser = explicitCurrentUser || sellerNameMatch;
      const isThreadStarter = /\b(?:iniciaste este chat|you started this chat|inici\u00f3 este chat|started this chat)\b/i.test(text);
      return {
        descriptor,
        text,
        sentByCurrentUser,
        isThreadStarter,
        senderName: sentByCurrentUser ? "" : senderName,
        sellerNameMatch,
      };
    }

    function isTransparentMessengerColor(color) {
      return !color || /^(?:transparent|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,\s*0\s*)?\))$/i.test(color);
    }

    function getMessengerBubbleVisualEvidence(element) {
      const styles = [
        window.getComputedStyle(element),
        window.getComputedStyle(element, "::before"),
        window.getComputedStyle(element, "::after"),
      ];
      return styles.reduce((evidence, style) => {
        const radius = Math.max(
          Number.parseFloat(style.borderRadius || "0") || 0,
          Number.parseFloat(style.borderTopLeftRadius || "0") || 0,
          Number.parseFloat(style.borderTopRightRadius || "0") || 0,
          Number.parseFloat(style.borderBottomLeftRadius || "0") || 0,
          Number.parseFloat(style.borderBottomRightRadius || "0") || 0,
        );
        const background = style.backgroundColor || "";
        return {
          hasBackground: evidence.hasBackground || !isTransparentMessengerColor(background),
          radius: Math.max(evidence.radius, radius),
        };
      }, { hasBackground: false, radius: 0 });
    }

    function findPlainMessengerBubble(textEl, messageScope) {
      let candidate = textEl;
      while (candidate && candidate !== messageScope) {
        if (candidate.closest('button, [role="button"], a, [contenteditable="true"], textarea')) return null;
        const rect = candidate.getBoundingClientRect();
        const visualEvidence = getMessengerBubbleVisualEvidence(candidate);
        const presentationBubble = candidate.getAttribute("role") === "presentation";
        if (
          rect.width >= 18 &&
          rect.height >= 16 &&
          rect.width <= Math.max(560, messageScope.getBoundingClientRect().width * 0.92) &&
          rect.height <= 320 &&
          (
            (visualEvidence.hasBackground && visualEvidence.radius >= 6) ||
            (presentationBubble && visualEvidence.radius >= 6)
          )
        ) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    }

    function parsePlainMessengerMessages(messageScope, buyerName, threadHeaderText) {
      if (!messageScope) return [];
      const isolatedCapture = globalThis.DealerPilotMessengerCapture;
      if (isolatedCapture?.readVisualMessages) {
        const isolatedMessages = isolatedCapture.readVisualMessages(messageScope, buyerName);
        if (isolatedMessages.length) return isolatedMessages;
      }
      const scopeRect = messageScope.getBoundingClientRect();
      if (!scopeRect.width || !scopeRect.height) return [];
      const seenBubbles = new Set();
      const headerParts = cleanMessengerText(threadHeaderText).split(/\s+[·•|]\s+/).filter(Boolean);
      const candidates = Array.from(messageScope.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
        .filter(visible)
        .map((textEl) => findPlainMessengerBubble(textEl, messageScope))
        .filter((bubble) => {
          if (!bubble || seenBubbles.has(bubble)) return false;
          seenBubbles.add(bubble);
          return true;
        })
        .map((bubble) => {
          const text = cleanMessengerText(bubble.innerText || bubble.textContent || "");
          const rect = bubble.getBoundingClientRect();
          const leftGap = Math.max(0, rect.left - scopeRect.left);
          const rightGap = Math.max(0, scopeRect.right - rect.right);
          return {
            bubble,
            text,
            top: rect.top,
            sentByCurrentUser: rightGap + 16 < leftGap,
          };
        })
        .filter(({ text, bubble }) => {
          if (!text || text.length < 2 || text.length > 500 || isMessengerUiText(text)) return false;
          if (text === buyerName || headerParts.includes(text)) return false;
          if (/^Marketplace\b/i.test(text) || /^\$[\d,.]+\b/.test(text)) return false;
          return !bubble.querySelector('a[href*="/marketplace/item/"]');
        })
        .sort((left, right) => left.top - right.top);

      return candidates.map(({ text, sentByCurrentUser }) => ({
        speaker: sentByCurrentUser ? "Dealer" : (buyerName || "Buyer"),
        text,
      }));
    }

    function isMarketplaceAvailabilityInquiry(text) {
      const normalized = cleanMessengerText(text).toLowerCase();
      return /\b(?:is (?:it|this|the .+?) (?:still )?available|still available|sigue disponible|est[aá] disponible|lo tiene disponible)\b/i.test(normalized);
    }

    function normalizeMarketplaceAvailabilityLabel(text) {
      return cleanMessengerText(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    function hasMarketplaceQuickResponsePrompt(text) {
      const normalized = normalizeMarketplaceAvailabilityLabel(text);
      const hasEnglishPrompt = normalized.includes("send a quick response") &&
        normalized.includes("tap a response to send it to the buyer");
      const hasSpanishPrompt = normalized.includes("enviar una respuesta rapida") &&
        normalized.includes("respuesta para enviarla al comprador");
      return hasEnglishPrompt || hasSpanishPrompt;
    }

    function isMarketplaceQuickResponsePromptMarker(element) {
      const normalized = normalizeMarketplaceAvailabilityLabel(
        element.getAttribute?.("aria-label") || element.innerText || element.textContent || "",
      );
      return (
        normalized.includes("send a quick response") ||
        normalized.includes("tap a response to send it to the buyer") ||
        normalized.includes("enviar una respuesta rapida") ||
        normalized.includes("respuesta para enviarla al comprador")
      );
    }

    function findMarketplaceQuickResponsePromptMarkers(root) {
      return Array.from(root.querySelectorAll("span, div, p"))
        .filter((element) => visible(element) && isMarketplaceQuickResponsePromptMarker(element))
        .filter((element) => !Array.from(element.children || []).some(isMarketplaceQuickResponsePromptMarker));
    }

    function findLowestCommonMessengerAncestor(left, right, root) {
      if (!left || !right || !root) return null;
      const leftAncestors = new Set();
      let current = left;
      while (current) {
        leftAncestors.add(current);
        if (current === root) break;
        current = current.parentElement;
      }
      current = right;
      while (current) {
        if (leftAncestors.has(current)) return current;
        if (current === root) break;
        current = current.parentElement;
      }
      return null;
    }

    function rectDistance(left, right) {
      const horizontal = Math.max(0, left.left - right.right, right.left - left.right);
      const vertical = Math.max(0, left.top - right.bottom, right.top - left.bottom);
      return Math.hypot(horizontal, vertical);
    }

    function serializeMessengerAncestorChain(element, root) {
      const chain = [];
      let current = element;
      while (current) {
        chain.push({
          tag: current.tagName || "",
          role: current.getAttribute?.("role") || "",
          ariaLabel: current.getAttribute?.("aria-label") || "",
          text: cleanMessengerText(current.innerText || current.textContent || "").slice(0, 180),
        });
        if (current === root) break;
        current = current.parentElement;
      }
      return chain;
    }

    function inspectMarketplaceQuickResponseCandidate(candidate, root, promptMarkers) {
      const candidateRect = candidate.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const relationships = promptMarkers.map((prompt) => {
        const commonAncestor = findLowestCommonMessengerAncestor(candidate, prompt, root);
        const commonRect = commonAncestor?.getBoundingClientRect?.();
        const promptRect = prompt.getBoundingClientRect();
        const commonText = cleanMessengerText(
          commonAncestor?.innerText || commonAncestor?.textContent || "",
        );
        const rootArea = Math.max(1, rootRect.width * rootRect.height);
        const commonArea = commonRect ? commonRect.width * commonRect.height : Number.POSITIVE_INFINITY;
        const accepted = !!commonAncestor &&
          commonAncestor !== root &&
          visible(commonAncestor) &&
          hasMarketplaceQuickResponsePrompt(commonText) &&
          commonArea < rootArea * 0.82 &&
          commonRect.width <= rootRect.width + 8 &&
          commonRect.height <= Math.min(680, rootRect.height + 8) &&
          rectDistance(candidateRect, promptRect) <= 480;
        return {
          accepted,
          commonAncestor,
          commonArea,
          distance: Math.round(rectDistance(candidateRect, promptRect)),
          promptText: cleanMessengerText(prompt.innerText || prompt.textContent || "").slice(0, 180),
          siblingBranches: candidate.parentElement !== prompt.parentElement,
          reason: accepted
            ? "quick_response_card_common_ancestor"
            : !commonAncestor
              ? "no_common_ancestor"
              : commonAncestor === root
                ? "common_ancestor_is_thread_root"
                : !hasMarketplaceQuickResponsePrompt(commonText)
                  ? "prompt_contract_missing"
                  : commonArea >= rootArea * 0.82
                    ? "common_ancestor_too_broad"
                    : "candidate_too_far_from_prompt",
        };
      }).sort((left, right) => {
        if (left.accepted !== right.accepted) return left.accepted ? -1 : 1;
        return left.commonArea - right.commonArea;
      });
      const relationship = relationships[0] || {
        accepted: false,
        commonAncestor: null,
        distance: null,
        promptText: "",
        siblingBranches: false,
        reason: "quick_response_prompt_missing",
      };
      return {
        accepted: relationship.accepted,
        reason: relationship.reason,
        distance: relationship.distance,
        promptText: relationship.promptText,
        siblingBranches: relationship.siblingBranches,
        commonAncestorText: cleanMessengerText(
          relationship.commonAncestor?.innerText || relationship.commonAncestor?.textContent || "",
        ).slice(0, 360),
        ancestorChain: serializeMessengerAncestorChain(candidate, root),
      };
    }

    function findMarketplaceAvailabilityAcceptButton() {
      const root = findMessengerRoot();
      if (!root) {
        lastMarketplaceQuickReplyDiagnostics = {
          rootDetected: false,
          spansExamined: 0,
          matchingSpans: 0,
          affirmativeMatches: 0,
          promptMarkers: 0,
          candidates: [],
          accepted: false,
          reason: "thread_root_missing",
        };
        return null;
      }
      const affirmativeLabels = [
        "yes its available",
        "yes it is available",
        "yes this is available",
        "yes still available",
        "yes are you interested",
        "si esta disponible",
        "si sigue disponible",
        "si aun esta disponible",
        "si te interesa",
      ];
      const matchesAffirmativeLabel = (element) => {
        if (!visible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
        const label = normalizeMarketplaceAvailabilityLabel(
          element.getAttribute("aria-label") || element.innerText || element.textContent || "",
        );
        return affirmativeLabels.some((expectedLabel) =>
          label === expectedLabel ||
          (label.length >= 12 && expectedLabel.startsWith(label)),
        );
      };

      const spans = Array.from(root.querySelectorAll("span"));
      const promptMarkers = findMarketplaceQuickResponsePromptMarkers(root);
      const candidates = Array.from(
        root.querySelectorAll('button, [role="button"], span, div'),
      )
        .filter(matchesAffirmativeLabel)
        .sort((left, right) => elementArea(left) - elementArea(right));
      const inspectedCandidates = candidates.map((candidate) => ({
        candidate,
        label: cleanMessengerText(
          candidate.getAttribute("aria-label") || candidate.innerText || candidate.textContent || "",
        ),
        tag: candidate.tagName || "",
        role: candidate.getAttribute("role") || "",
        visible: visible(candidate),
        ...inspectMarketplaceQuickResponseCandidate(candidate, root, promptMarkers),
      }));
      const accepted = inspectedCandidates.find((candidate) => candidate.accepted) || null;
      lastMarketplaceQuickReplyDiagnostics = {
        rootDetected: true,
        spansExamined: spans.length,
        matchingSpans: spans.filter(matchesAffirmativeLabel).length,
        affirmativeMatches: candidates.length,
        promptMarkers: promptMarkers.length,
        accepted: !!accepted,
        acceptedLabel: accepted?.label || "",
        reason: accepted?.reason || inspectedCandidates[0]?.reason || "affirmative_candidate_missing",
        candidates: inspectedCandidates.map(({ candidate: _candidate, ...details }) => details),
      };
      return accepted?.candidate || null;
    }

    function createMarketplaceAvailabilityFallbackMessage(buyerName) {
      const acceptButton = findMarketplaceAvailabilityAcceptButton();
      if (!acceptButton) return null;
      const label = normalizeMarketplaceAvailabilityLabel(
        acceptButton.getAttribute("aria-label") || acceptButton.innerText || acceptButton.textContent || "",
      );
      return {
        speaker: buyerName || "Buyer",
        text: label.startsWith("si ") ? "¿Sigue disponible?" : "Is it still available?",
        availabilityQuickReplyLabel: label,
        quickReplyDiagnostics: lastMarketplaceQuickReplyDiagnostics,
      };
    }

    async function acceptMarketplaceAvailabilityQuickReply(captureHash, messages) {
      const lastMessage = messages[messages.length - 1] || null;
      if (!lastMessage || lastMessage.speaker === "Dealer" || !isMarketplaceAvailabilityInquiry(lastMessage.text)) {
        return false;
      }
      const acceptButton = findMarketplaceAvailabilityAcceptButton();
      if (!acceptButton) return false;
      const claim = await send({
        type: "MESSENGER_CLAIM_AVAILABILITY_ACTION",
        claimKey: captureHash,
      });
      if (!claim?.ok || claim.data?.claimed !== true) return false;
      acceptButton.click();
      await sleep(900);
      setStatus("Marketplace availability confirmed. Preparing financing question...", "muted");
      return true;
    }

    function logSalesAiGateDiagnostics(gates, evidence) {
      console.log("[DealerPilot AI] Sales AI validation gates", gates);
      const reasons = {
        routeAllowed: isBlockedSalesAiRoute() ? "blocked Facebook surface" : "route is not a supported Marketplace thread",
        conversationThreadDetected: "Marketplace conversation region or message log not found",
        buyerMessageDetected: "latest substantive message is not an inbound buyer message",
        buyerNameDetected: "thread header did not provide a reliable buyer name",
        sellerIsCurrentUser: evidence.sellerSurfaceRejected === true
          ? "active Marketplace thread exposes buyer-side View seller controls"
          : "seller-side controls and configured seller profile evidence are both missing",
        marketplaceContextDetected: "Marketplace listing id or vehicle title was not found in the seller thread",
      };
      for (const [gate, passed] of Object.entries(gates)) {
        if (passed) continue;
        console.log("[DealerPilot AI] Sales AI gate failed", {
          gate,
          reason: reasons[gate],
          currentUrl: safeSalesAiUrl(),
          matchedSelectors: evidence.matchedSelectors || [],
          threadHeaderText: (evidence.threadHeaderText || "").slice(0, 160),
          latestInboundMessageText: (evidence.latestInboundMessageText || "").slice(0, 500),
          buyerNameCandidate: (evidence.buyerNameCandidate || "").slice(0, 80),
          listingTitleCandidate: (evidence.listingTitleCandidate || "").slice(0, 160),
        });
      }
    }

    function validateMessengerSalesContext({ buyerName, messages, context, evidence }) {
      const root = findMarketplaceThreadRoot();
      const lastMessage = messages[messages.length - 1] || null;
      const gates = {
        routeAllowed:
          !!root &&
          (!isBlockedSalesAiRoute() || hasExplicitMarketplaceEvidence(root)),
        conversationThreadDetected: !!root,
        buyerMessageDetected: !!lastMessage && lastMessage.speaker !== "Dealer" && !isMessengerUiText(lastMessage.text),
        buyerNameDetected: isReliableBuyerName(buyerName),
        // Seller-only controls are the primary evidence because Facebook can
        // omit the account aria-label. A matching profile is an allowed
        // fallback only when the thread does not explicitly expose View seller.
        sellerIsCurrentUser: evidence.sellerContextTrusted === true,
        marketplaceContextDetected:
          !!context.marketplaceItemId ||
          (!!root && !!context.vehicleTitle),
      };
      const missingReasonByGate = {
        routeAllowed: "route_not_allowed",
        conversationThreadDetected: "conversation_thread_missing",
        buyerMessageDetected: "buyer_message_missing",
        buyerNameDetected: "buyer_name_missing",
        sellerIsCurrentUser: evidence.sellerSurfaceRejected
          ? "seller_surface_rejected"
          : "seller_context_untrusted",
        marketplaceContextDetected: "marketplace_context_missing",
      };
      const missing = Object.entries(gates)
        .filter(([, passed]) => !passed)
        .map(([gate]) => missingReasonByGate[gate]);
      logSalesAiGateDiagnostics(gates, evidence);
      return { ok: missing.length === 0, missing, ...gates };
    }

    function scrapeConversationSnapshot() {
      const main = findMarketplaceThreadRoot();
      const isolatedCapture = globalThis.DealerPilotMessengerCapture;
      const threadInspection = isolatedCapture?.inspectThread?.(main) || {};
      const threadHeaderText = threadInspection.cleanedThreadHeader || getThreadHeadingText(main);
      const sellerProfile = validateFacebookSellerProfile(document);
      const sellerContextTrusted = isolatedCapture?.sellerContextIsTrusted
        ? isolatedCapture.sellerContextIsTrusted(threadInspection, sellerProfile.matched)
        : threadInspection.sellerSurfaceRejected !== true &&
          (threadInspection.sellerSurfaceDetected === true || sellerProfile.matched === true);

      // Try to detect buyer name from page heading
      let buyerName = threadInspection.buyerName || extractBuyerNameFromThreadHeader(threadHeaderText);

      // Try structured message rows — Messenger renders each message in a [role="row"] or similar
      const messageScope = findMessengerMessageScope(main);
      const sellerNameCandidates = collectMessengerSellerNameCandidates(
        sellerProfile.currentProfileName,
        sellerProfile.matched,
      );
      const semanticMessageEls = messageScope
        ? Array.from(messageScope.querySelectorAll('[aria-label]')).filter((el) => {
            const descriptor = el.getAttribute("aria-label") || "";
            return visible(el) && /(?:por|by)\s+[^:]{1,80}:\s*\S|,\s*[^,:]{1,80}:\s*\S/i.test(descriptor);
          })
        : [];
      const messageEls = semanticMessageEls.length > 0
        ? semanticMessageEls
        : messageScope
          ? Array.from(messageScope.querySelectorAll('article, [role="row"]')).filter(visible)
          : [];

      const messages = [];
      const inboundSenderNames = [];
      const inboundMessageDescriptors = [];
      let threadStartedByCurrentUser = null;
      let extractionMode = "none";
      const stableThreadIdentity =
        isolatedCapture?.findThreadIdentity?.(main, messageScope) ||
        findStableMessengerThreadIdentity(main, messageScope);

      if (messageEls.length > 0) {
        // Structured extraction: detect sent (you) vs received (buyer)
        for (const el of messageEls) {
          const parsed = parseSemanticMessengerMessage(el, sellerNameCandidates);
          if (parsed.isThreadStarter) {
            threadStartedByCurrentUser = parsed.sentByCurrentUser;
            continue;
          }
          if (!parsed.text || parsed.text.length < 2 || isMessengerUiText(parsed.text)) continue;
          if (!parsed.sentByCurrentUser) {
            if (parsed.senderName) inboundSenderNames.push(parsed.senderName);
            if (parsed.descriptor) inboundMessageDescriptors.push(parsed.descriptor);
          }
          messages.push({
            speaker: parsed.sentByCurrentUser ? "Dealer" : (buyerName || "Buyer"),
            text: parsed.text.slice(0, 500),
          });
        }
        if (messages.length > 0) extractionMode = "semantic";
      }

      const descriptorBuyerName = inboundSenderNames.find(isReliableBuyerName);
      if (descriptorBuyerName) buyerName = descriptorBuyerName;

      // Facebook also renders Marketplace chats as unlabeled rounded bubbles.
      // When semantic rows are absent, use bubble styling plus left/right
      // alignment inside the already validated active thread.
      if (messages.length < 1 && messageScope) {
        const plainMessages = parsePlainMessengerMessages(messageScope, buyerName, threadHeaderText);
        messages.push(...plainMessages);
        if (plainMessages.length > 0) extractionMode = "visual_bubbles";
      }

      // On a first Marketplace contact, Facebook can replace the inbound
      // buyer bubble with a "Send a quick response" availability card. Treat
      // that seller-only control as evidence of the buyer's availability turn
      // so validation, debounce, button acceptance and intake can still run.
      const availabilityQuickReplyMessage = createMarketplaceAvailabilityFallbackMessage(buyerName);
      const availabilityFallbackMessage = messages.length < 1
        ? availabilityQuickReplyMessage
        : null;
      if (availabilityFallbackMessage) {
        messages.push(availabilityFallbackMessage);
        extractionMode = "quick_reply_card";
      }

      if (messages.length < 1) {
        return {
          buyerName,
          rawText: "",
          messages: [],
          evidence: {
            threadHeaderText,
            cleanedThreadHeader: threadInspection.cleanedThreadHeader || threadHeaderText,
            cleanedVehicleTitle: threadInspection.cleanedVehicleTitle || "",
            buyerNameCandidate: buyerName,
            latestInboundMessageText: "",
            inboundMessageText: "",
            threadStartedByCurrentUser,
            availabilityQuickReplyVisible: false,
            availabilityQuickReplyLabel: "",
            quickReplyDiagnostics: lastMarketplaceQuickReplyDiagnostics,
            threadRootDetected: !!main,
            messageScopeDetected: !!messageScope,
            extractionMode,
            messageCandidateCount: semanticMessageEls.length || (messageScope
              ? messageScope.querySelectorAll('div[dir="auto"], span[dir="auto"]').length
              : 0),
            latestMessageDirection: "none",
            activeThreadRootSelector: isolatedCapture?.selectorFor?.(main) || "",
            matchedSelectors: collectMatchedThreadSelectors(main),
            threadIdentity: stableThreadIdentity || inboundMessageDescriptors[0] || "",
            sellerNameCandidates,
            sellerContext: "extension_installed_seller_browser",
            sellerSurfaceDetected: threadInspection.sellerSurfaceDetected === true,
            sellerSurfaceRejected: threadInspection.sellerSurfaceRejected === true,
            sellerSurfaceEvidence: threadInspection.sellerSurfaceEvidence || [],
            sellerContextTrusted,
            sellerProfileName: sellerProfile.currentProfileName,
            sellerProfileMatched: sellerProfile.matched,
          },
        };
      }

      // Deduplicate consecutive identical messages
      const deduped = messages.filter((message, index) => {
        const previous = messages[index - 1];
        return !previous || message.speaker !== previous.speaker || message.text !== previous.text;
      });
      const latestInboundMessage = [...deduped].reverse().find((message) => message.speaker !== "Dealer");

      return {
        buyerName,
        messages: deduped,
        rawText: "",
        evidence: {
          threadHeaderText,
          cleanedThreadHeader: threadInspection.cleanedThreadHeader || threadHeaderText,
          cleanedVehicleTitle: threadInspection.cleanedVehicleTitle || "",
          buyerNameCandidate: buyerName,
          latestInboundMessageText: latestInboundMessage?.text || "",
          inboundMessageText: latestInboundMessage?.text || "",
          threadStartedByCurrentUser,
          availabilityQuickReplyVisible: !!availabilityQuickReplyMessage,
          availabilityQuickReplyLabel: availabilityQuickReplyMessage?.availabilityQuickReplyLabel || "",
          quickReplyDiagnostics:
            availabilityQuickReplyMessage?.quickReplyDiagnostics || lastMarketplaceQuickReplyDiagnostics,
          threadRootDetected: !!main,
          messageScopeDetected: !!messageScope,
          extractionMode,
          messageCandidateCount: semanticMessageEls.length || (messageScope
            ? messageScope.querySelectorAll('div[dir="auto"], span[dir="auto"]').length
            : 0),
          latestMessageDirection: deduped[deduped.length - 1]?.speaker === "Dealer" ? "dealer" : "buyer",
          activeThreadRootSelector: isolatedCapture?.selectorFor?.(main) || "",
          matchedSelectors: collectMatchedThreadSelectors(main),
          threadIdentity: stableThreadIdentity || inboundMessageDescriptors[0] || "",
          sellerNameCandidates,
          sellerContext: "extension_installed_seller_browser",
          sellerSurfaceDetected: threadInspection.sellerSurfaceDetected === true,
          sellerSurfaceRejected: threadInspection.sellerSurfaceRejected === true,
          sellerSurfaceEvidence: threadInspection.sellerSurfaceEvidence || [],
          sellerContextTrusted,
          sellerProfileName: sellerProfile.currentProfileName,
          sellerProfileMatched: sellerProfile.matched,
        },
      };
    }

    function findConversationScrollContainer(messageLog) {
      let candidate = messageLog;
      while (candidate && candidate !== document.body) {
        const style = window.getComputedStyle(candidate);
        const canScroll = /auto|scroll/i.test(style.overflowY || "");
        if (canScroll && candidate.scrollHeight > candidate.clientHeight + 8) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    }

    function sameConversationMessage(left, right) {
      return left?.speaker === right?.speaker && left?.text === right?.text;
    }

    function mergeConversationWindows(olderWindow, currentHistory) {
      if (!olderWindow.length) return currentHistory;
      if (!currentHistory.length) return olderWindow;

      const maxOverlap = Math.min(olderWindow.length, currentHistory.length);
      for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        const olderSuffix = olderWindow.slice(-overlap);
        const currentPrefix = currentHistory.slice(0, overlap);
        if (olderSuffix.every((message, index) => sameConversationMessage(message, currentPrefix[index]))) {
          return [...olderWindow, ...currentHistory.slice(overlap)];
        }
      }

      return [...olderWindow, ...currentHistory];
    }

    async function scrapeConversation() {
      let snapshot = scrapeConversationSnapshot();
      let messages = snapshot.messages;
      const hydrationKey = safeSalesAiUrl();
      const messageScope = findMessengerMessageScope(findMarketplaceThreadRoot());
      let scrollContainer = findConversationScrollContainer(messageScope);

      if (!scrollContainer || lastMessengerHistoryHydrationKey === hydrationKey) return snapshot;
      lastMessengerHistoryHydrationKey = hydrationKey;

      const shouldRestoreBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 80;
      let stablePasses = 0;
      let previousHeight = scrollContainer.scrollHeight;

      for (let pass = 0; pass < 8 && stablePasses < 2; pass += 1) {
        scrollContainer.scrollTop = 0;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        await sleep(350);

        const olderSnapshot = scrapeConversationSnapshot();
        const merged = mergeConversationWindows(olderSnapshot.messages, messages);
        const addedMessages = merged.length - messages.length;
        messages = merged;
        snapshot = {
          ...snapshot,
          buyerName: snapshot.buyerName || olderSnapshot.buyerName,
          evidence: {
            ...olderSnapshot.evidence,
            ...snapshot.evidence,
            threadIdentity:
              snapshot.evidence.threadIdentity || olderSnapshot.evidence.threadIdentity || "",
          },
        };

        const refreshedScope = findMessengerMessageScope(findMarketplaceThreadRoot());
        scrollContainer = findConversationScrollContainer(refreshedScope) || scrollContainer;
        const heightChanged = scrollContainer.scrollHeight > previousHeight + 8;
        stablePasses = addedMessages > 0 || heightChanged ? 0 : stablePasses + 1;
        previousHeight = scrollContainer.scrollHeight;
      }

      if (shouldRestoreBottom) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        await sleep(100);
        const newestSnapshot = scrapeConversationSnapshot();
        messages = mergeConversationWindows(messages, newestSnapshot.messages);
        snapshot = {
          ...snapshot,
          evidence: {
            ...snapshot.evidence,
            ...newestSnapshot.evidence,
            threadIdentity:
              newestSnapshot.evidence.threadIdentity || snapshot.evidence.threadIdentity || "",
          },
        };
      }

      return { ...snapshot, messages };
    }

    // Detect listing context from the page (vehicle title, price, etc.)
    function canonicalMarketplaceListingUrl(value) {
      const match = String(value || "").match(/\/marketplace\/item\/(\d+)/i);
      return match ? `https://www.facebook.com/marketplace/item/${match[1]}/` : null;
    }

    function extractVehicleTitleCandidate(value) {
      const isolatedCleaned = globalThis.DealerPilotMessengerCapture?.cleanVehicleTitle?.(value);
      if (isolatedCleaned) return isolatedCleaned;
      const cleaned = cleanMessengerText(value)
        .replace(/^.*?\$[\d,.]+\s*[-\u2013\u2014]\s*/i, "")
        .replace(/^.*?[\u00b7\u2022|]\s+(?=(?:19|20)\d{2}\b)/, "")
        .replace(/\s+(?:See details|Ver detalles|More options|M\u00e1s opciones).*$/i, "")
        .trim();
      const match = cleaned.match(/\b(?:19|20)\d{2}\s+[A-Za-z0-9][A-Za-z0-9 .+'\/-]{2,80}/);
      return match ? match[0].trim() : null;
    }

    function detectListingContext() {
      const root = findMarketplaceThreadRoot();
      const threadInspection = globalThis.DealerPilotMessengerCapture?.inspectThread?.(root) || {};
      const bodyText = (root?.innerText || "").toLowerCase();
      const listingLink =
        root?.querySelector('a[href*="/marketplace/item/"]') ||
        document.querySelector('a[href*="/marketplace/item/"]') ||
        null;
      const listingUrl =
        canonicalMarketplaceListingUrl(listingLink?.href) ||
        canonicalMarketplaceListingUrl(location.href);
      const marketplaceItemId = listingUrl?.match(/\/item\/(\d+)\//)?.[1] || null;

      // Look for price patterns like $12,500 or $12500
      const priceMatch = bodyText.match(/\$[\d,]+/);
      const price = priceMatch ? priceMatch[0] : null;

      // Look for down payment pattern
      const downMatch = bodyText.match(/\$[\d,]+\s*(?:down|\/mo|per month)/i);
      const downPayment = downMatch ? downMatch[0] : null;

      // Vehicle title — look for pattern like "2020 Toyota Camry" in headings or links
      const titleSources = [
        threadInspection.cleanedVehicleTitle || "",
        listingLink?.textContent || "",
        getThreadHeadingText(root),
        ...Array.from(root?.querySelectorAll('[role="heading"]') || []).map((node) => node.textContent || ""),
      ];
      const vehicleTitle = titleSources.map(extractVehicleTitleCandidate).find(Boolean) || null;

      return { listingUrl, marketplaceItemId, vehicleTitle, price, downPayment };
    }

    function normalizeThreadToken(value) {
      return (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
    }

    function stableThreadFingerprint(value) {
      let hash = 2166136261;
      for (const character of String(value || "")) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function buildMessengerThreadRef(
      buyerName,
      vehicleTitle,
      fallbackUrl = location.href,
      messages = [],
      threadIdentity = "",
    ) {
      const buyer = normalizeThreadToken(buyerName || "unknown-buyer");
      const vehicle = normalizeThreadToken(vehicleTitle || "vehicle-inquiry");
      const firstBuyerMessage = messages.find((message) => message?.speaker !== "Dealer")?.text || "";
      const identitySeed = threadIdentity || firstBuyerMessage || fallbackUrl.split("?")[0];
      const fingerprint = stableThreadFingerprint(
        [buyer, vehicle, normalizeThreadToken(identitySeed)].join("::"),
      );
      return `marketplace-thread::${buyer || "unknown-buyer"}::${vehicle}::${fingerprint}`;
    }

    function findMessengerSendButton() {
      const box = getMessengerMessageBox();
      const root =
        box?.closest('[role="dialog"]') ||
        box?.closest('[role="main"]') ||
        findMessengerRoot() ||
        document;
      const candidates = Array.from(
        root.querySelectorAll(
          [
            '[aria-label="Send"]',
            '[aria-label="Enviar"]',
            '[aria-label*="send" i]',
            '[aria-label*="enviar" i]',
            '[data-testid*="send" i]',
          ].join(", "),
        ),
      ).filter((el) => {
        const text = (el.textContent || "").trim().toLowerCase();
        const label = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        const title = (el.getAttribute("title") || "").trim().toLowerCase();
        const descriptor = `${text} ${label} ${title}`;
        if (!/(^|\b)(send|enviar)(\b|$)/i.test(descriptor)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !el.disabled && el.getAttribute("aria-disabled") !== "true";
      });
      if (!box) return candidates[0] || null;
      const boxRect = box.getBoundingClientRect();
      return candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftDistance = Math.abs(leftRect.left - boxRect.right) + Math.abs(leftRect.top - boxRect.top);
        const rightDistance = Math.abs(rightRect.left - boxRect.right) + Math.abs(rightRect.top - boxRect.top);
        return leftDistance - rightDistance;
      })[0] || null;
    }

    function readMessengerComposerText(box) {
      if (!box) return "";
      return cleanMessengerText(box.tagName === "TEXTAREA" ? box.value : box.textContent || "");
    }

    function messengerShowsSentReply(reply) {
      const root = findMessengerRoot();
      if (!root) return false;
      const expected = cleanMessengerText(reply);
      const messageScope = findMessengerMessageScope(root);
      const sellerProfile = validateFacebookSellerProfile(document);
      const sellerNameCandidates = collectMessengerSellerNameCandidates(
        sellerProfile.currentProfileName,
        sellerProfile.matched,
      );
      const semanticDelivery = Array.from(root.querySelectorAll('[aria-label]')).some((el) => {
        const parsed = parseSemanticMessengerMessage(el, sellerNameCandidates);
        return parsed.sentByCurrentUser && cleanMessengerText(parsed.text) === expected;
      });
      if (semanticDelivery) return true;

      const buyerName = extractBuyerNameFromThreadHeader(getThreadHeadingText(root));
      return parsePlainMessengerMessages(messageScope, buyerName, getThreadHeadingText(root))
        .some((message) => message.speaker === "Dealer" && cleanMessengerText(message.text) === expected);
    }

    async function clickMessengerSend(box = getMessengerMessageBox()) {
      await sleep(250);
      const sendBtn = findMessengerSendButton();
      if (sendBtn) {
        sendBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        sendBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return { ok: true, method: "button" };
      }

      if (!box) return { ok: false, method: "none" };
      box.focus();
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      return { ok: true, method: "enter" };
    }

    async function autoSendReply(reply, captureHash, messages, captureDebug = {}) {
      lastMessengerAutoSendFailureReason = "";
      lastMessengerAutoSendMethod = "";
      lastMessengerSendDiagnostics = {
        composerDetected: false,
        composerTextDetected: false,
        sendControlDetected: false,
        sendMethod: "none",
        deliveryConfirmed: false,
      };
      if (!reply || !captureHash || captureHash === lastMessengerAutoSendHash) {
        lastMessengerAutoSendFailureReason = "reply_or_capture_not_actionable";
        return false;
      }
      if (!messages.length) {
        lastMessengerAutoSendFailureReason = "message_history_missing";
        return false;
      }
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.speaker === "Dealer") {
        lastMessengerAutoSendFailureReason = "latest_message_is_dealer";
        return false;
      }

      const box = getMessengerMessageBox();
      if (!box) {
        lastMessengerAutoSendFailureReason = "composer_missing";
        return false;
      }
      lastMessengerSendDiagnostics.composerDetected = true;
      const inserted = insertReply(reply);
      const composerTextDetected = cleanMessengerText(readMessengerComposerText(box)) === cleanMessengerText(reply);
      lastMessengerSendDiagnostics.composerTextDetected = composerTextDetected;
      if (!inserted || !composerTextDetected) {
        lastMessengerAutoSendFailureReason = "composer_insert_unconfirmed";
        return false;
      }
      const sendControlDetected = !!findMessengerSendButton();
      lastMessengerSendDiagnostics.sendControlDetected = sendControlDetected;
      const sendResult = await clickMessengerSend(box);
      lastMessengerSendDiagnostics.sendMethod = sendResult.method;
      if (!sendResult.ok) {
        lastMessengerAutoSendFailureReason = "send_dispatch_failed";
        setStatus("Reply inserted, but DealerPilot could not find Messenger Send.", "err");
        return false;
      }
      await sleep(900);
      const deliveryConfirmed = !readMessengerComposerText(box) || messengerShowsSentReply(reply);
      lastMessengerSendDiagnostics.deliveryConfirmed = deliveryConfirmed;
      if (!deliveryConfirmed) {
        lastMessengerAutoSendFailureReason = "delivery_unconfirmed";
        reportMessengerCaptureDebug("auto_send_blocked", {
          ...captureDebug,
          reason: lastMessengerAutoSendFailureReason,
          composerDetected: true,
          composerTextDetected: true,
          sendControlDetected,
          sendMethod: sendResult.method,
          deliveryConfirmed: false,
        });
        setStatus("AI reply was prepared, but Facebook did not confirm delivery.", "err");
        return false;
      }
      lastMessengerAutoSendHash = captureHash;
      lastMessengerAutoReplyText = cleanMessengerText(reply);
      lastMessengerAutoReplyAt = Date.now();
      lastMessengerAutoSendFailureReason = "";
      lastMessengerAutoSendMethod = sendResult.method;
      setStatus("AI reply sent automatically. Lead saved to CRM.", "ok");
      return true;
    }

    async function captureConversationOnce(options = {}) {
      const silent = !!options.silent;
      const automatic = !!options.automatic;
      const messageDetectedAtMs = Date.now();
      setStatus("Reading conversation…");

      const { buyerName, messages, rawText, evidence } = await scrapeConversation();
      const context = detectListingContext();
      evidence.listingTitleCandidate = context.vehicleTitle || "";
      if (!evidence.threadIdentity && buyerName && messages.some((message) => message.speaker !== "Dealer")) {
        evidence.threadIdentity = buildMessengerThreadRef(
          buyerName,
          context.vehicleTitle,
          context.listingUrl || location.href,
          messages,
        );
      }
      const salesContext = validateMessengerSalesContext({ buyerName, messages, context, evidence });
      const captureDebug = {
        pageRoute: safeSalesAiUrl(),
        automatic,
        messageCount: messages.length,
        messageCandidateCount: evidence.messageCandidateCount || 0,
        rawTextDetected: !!rawText,
        buyerNameDetected: isReliableBuyerName(buyerName),
        buyerName: buyerName || "",
        vehicleContextDetected: !!context.marketplaceItemId || !!context.vehicleTitle,
        vehicleTitle: context.vehicleTitle || "",
        quickReplyVisible: evidence.availabilityQuickReplyVisible === true,
        quickReplyLabel: evidence.availabilityQuickReplyLabel || "",
        quickReplyDiagnostics: evidence.quickReplyDiagnostics || lastMarketplaceQuickReplyDiagnostics,
        affirmativeActionDetected: evidence.quickReplyDiagnostics?.accepted === true,
        threadRootDetected: evidence.threadRootDetected === true,
        messageScopeDetected: evidence.messageScopeDetected === true,
        messageExtractionMode: evidence.extractionMode || "none",
        threadIdentityDetected: !!evidence.threadIdentity,
        threadIdentity: evidence.threadIdentity || "",
        latestMessageDirection: evidence.latestMessageDirection || "none",
        activeThreadRootSelector: evidence.activeThreadRootSelector || "",
        sellerSurfaceDetected: evidence.sellerSurfaceDetected === true,
        sellerSurfaceRejected: evidence.sellerSurfaceRejected === true,
        sellerSurfaceEvidence: evidence.sellerSurfaceEvidence || [],
        cleanedThreadHeader: evidence.cleanedThreadHeader || evidence.threadHeaderText || "",
        cleanedVehicleTitle: context.vehicleTitle || evidence.cleanedVehicleTitle || "",
        inboundMessageText: evidence.inboundMessageText || evidence.latestInboundMessageText || "",
        sellerContext: evidence.sellerContext || "extension_installed_seller_browser",
        sellerContextTrusted: evidence.sellerContextTrusted === true,
        sellerProfileName: evidence.sellerProfileName || "",
        sellerProfileMatched: evidence.sellerProfileMatched === true,
        composerDetected: !!getMessengerMessageBox(),
      };

      if (!messages.length && !rawText) {
        reportMessengerCaptureDebug("blocked", {
          ...captureDebug,
          reason: "no_conversation_text",
        });
        setStatus("No conversation text found.", "err");
        return;
      }

      if (!salesContext.ok) {
        console.log("[DealerPilot AI] Sales AI capture skipped", {
          reasons: salesContext.missing,
          buyerName,
          url: location.href,
        });
        reportMessengerCaptureDebug("blocked", {
          ...captureDebug,
          reason: salesContext.missing[0] || "invalid_sales_context",
          validationGates: salesContext,
        });
        setStatus(`Sales AI skipped: ${salesContext.missing[0] || "invalid context"}.`, "muted");
        return;
      }

      if (automatic) {
        const lastMessage = messages[messages.length - 1] || null;
        if (!lastMessage || lastMessage.speaker === "Dealer") {
          pendingMessengerBuyerHash = "";
          pendingMessengerBuyerSince = 0;
          pendingMessengerMessageDetectedAt = 0;
          setStatus("No new buyer message detected.", "muted");
          return;
        }

        const latestText = cleanMessengerText(lastMessage.text);
        const recentlySentOwnReply =
          !!latestText &&
          latestText === lastMessengerAutoReplyText &&
          Date.now() - lastMessengerAutoReplyAt < MESSENGER_OWN_REPLY_GUARD_MS;
        if (recentlySentOwnReply) {
          pendingMessengerBuyerHash = "";
          pendingMessengerBuyerSince = 0;
          pendingMessengerMessageDetectedAt = 0;
          setStatus("No new buyer message detected.", "muted");
          return;
        }
      }

      // Build the payload — structured messages preferred over rawText
      const currentMessage =
        messages.length > 0
          ? messages[messages.length - 1].text
          : rawText.split("\n").map((line) => line.trim()).filter(Boolean).slice(-1)[0] || "";
      const externalThreadRef = [
        buildMessengerThreadRef(
          buyerName,
          context.vehicleTitle,
          context.listingUrl || location.href,
          messages,
          evidence.threadIdentity,
        ),
      ].join("");
      const payload = {
        externalThreadRef,
        sourceUrl: location.href,
        buyerName: buyerName || undefined,
        dealerId: 1,
        messageDetectedAt: new Date(messageDetectedAtMs).toISOString(),
        routeAllowed: salesContext.routeAllowed,
        conversationThreadDetected: salesContext.conversationThreadDetected,
        buyerMessageDetected: salesContext.buyerMessageDetected,
        buyerNameDetected: salesContext.buyerNameDetected,
        sellerIsCurrentUser: salesContext.sellerIsCurrentUser,
        marketplaceContextDetected: salesContext.marketplaceContextDetected,
        currentMessage,
        detectedVehicleTitle: context.vehicleTitle || undefined,
        detectedMarketplaceListingUrl: context.listingUrl || undefined,
        marketplaceAskingPrice: context.price || undefined,
        marketplaceDownPayment: context.downPayment || undefined,
      };

      if (messages.length >= 1) {
        // Canonical role labels keep the backend parser stable even when the
        // buyer's display name changes or contains punctuation.
        const canonicalMessages = messages.map((m) =>
          `${m.speaker === "Dealer" ? "Dealer" : "Buyer"}: ${m.text}`,
        );
        payload.visibleMessages = canonicalMessages;
        payload.chatText = canonicalMessages.join("\n").slice(-4000);
      } else {
        payload.visibleMessages = rawText.split("\n").map((line) => line.trim()).filter(Boolean).slice(-12);
        payload.chatText = rawText;
      }

      const captureHash = JSON.stringify({
        thread: externalThreadRef,
        currentMessage,
        visibleMessages: payload.visibleMessages,
      });
      payload.messageHash = captureHash;
      payload.idempotencyKey = captureHash;
      let availabilityQuickReplyAccepted = false;

      if (automatic) {
        if (captureHash === lastMessengerAutoSendHash) {
          setStatus("No new buyer message detected.", "muted");
          return;
        }

        const now = Date.now();
        if (captureHash !== pendingMessengerBuyerHash) {
          pendingMessengerBuyerHash = captureHash;
          pendingMessengerBuyerSince = now;
          pendingMessengerMessageDetectedAt = messageDetectedAtMs;
          reportMessengerCaptureDebug("waiting_quiet_window", captureDebug);
          setStatus("Waiting for the buyer to finish typing...", "muted");
          return;
        }

        if (now - pendingMessengerBuyerSince < MESSENGER_REPLY_QUIET_MS) {
          setStatus("Waiting for the buyer to finish typing...", "muted");
          return;
        }

        payload.messageDetectedAt = new Date(
          pendingMessengerMessageDetectedAt || messageDetectedAtMs,
        ).toISOString();

        availabilityQuickReplyAccepted = await acceptMarketplaceAvailabilityQuickReply(
          captureHash,
          messages,
        );
      }

      payload.availabilityQuickReplyAccepted = availabilityQuickReplyAccepted;
      reportMessengerCaptureDebug("intake_sending", {
        ...captureDebug,
        availabilityQuickReplyAccepted,
        backendIntakeSent: false,
        backendIntakeReceived: false,
      });

      const buyerReplyPending =
        silent &&
        messages.length > 0 &&
        messages[messages.length - 1].speaker !== "Dealer";
      if (
        silent &&
        captureHash === lastMessengerCaptureHash &&
        (!buyerReplyPending || captureHash === lastMessengerAutoSendHash)
      ) return;

      const res = await send({ type: "CONVERSATION_INTAKE", ...payload });
      if (!res || !res.ok) {
        if (res?.error === CTXI) return;
        reportMessengerCaptureDebug("intake_failed", {
          ...captureDebug,
          availabilityQuickReplyAccepted,
          backendIntakeSent: true,
          backendIntakeReceived: false,
          reason: res?.error || "no_extension_response",
        });
        setStatus("Failed: " + (res && res.error), "err");
        return;
      }
      if (res.data?.skipped) {
        lastMessengerCaptureHash = captureHash;
        pendingMessengerBuyerHash = "";
        pendingMessengerBuyerSince = 0;
        pendingMessengerMessageDetectedAt = 0;
        reportMessengerCaptureDebug("intake_skipped", {
          ...captureDebug,
          availabilityQuickReplyAccepted,
          backendIntakeSent: true,
          backendIntakeReceived: true,
          reason: res.data.reason || "backend_skipped",
        });
        setStatus("No new buyer message to answer.", "muted");
        return;
      }

      lastMessengerCaptureHash = captureHash;
      pendingMessengerBuyerHash = "";
      pendingMessengerBuyerSince = 0;
      pendingMessengerMessageDetectedAt = 0;
      lastReply = res.data.suggestedReply;
      const msgCount = messages.length || "?";
      const autoSent = silent ? await autoSendReply(lastReply, captureHash, messages, captureDebug) : false;
      const replySentAt = autoSent ? new Date().toISOString() : null;
      const totalResponseMs = Date.now() - messageDetectedAtMs;
      reportMessengerCaptureDebug(autoSent || !silent ? "intake_ok" : "auto_send_blocked", {
        ...captureDebug,
        ...lastMessengerSendDiagnostics,
        availabilityQuickReplyAccepted,
        aiReplyReceived: !!lastReply,
        autoSent,
        sendMethod: autoSent ? lastMessengerAutoSendMethod : undefined,
        backendIntakeSent: true,
        backendIntakeReceived: true,
        reason: autoSent || !silent ? undefined : (lastMessengerAutoSendFailureReason || "auto_send_unconfirmed"),
        totalResponseMs,
      });
      console.log("[DealerPilot AI] Sales AI response timing", {
        ...(res.data.timings || {}),
        replySentAt,
        totalResponseMs,
        fallbackUsed: res.data.fallbackUsed === true,
        fallbackReason: res.data.fallbackReason || null,
      });
      if (!autoSent) {
        setStatus(`Reply ready (${msgCount} messages read). Lead saved to CRM.`, "ok");
      }

      showOutput(
        `<div class="mai-line"><strong>${autoSent ? "AI auto reply sent:" : "Suggested reply:"}</strong></div>` +
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
    }

    async function captureConversation(options = {}) {
      if (messengerCaptureInFlight) return;
      messengerCaptureInFlight = true;
      try {
        return await captureConversationOnce(options);
      } finally {
        messengerCaptureInFlight = false;
      }
    }

    const readBtn = button("Read Chat & Send AI Reply", () => captureConversation({ silent: true }));
    actionsEl.appendChild(readBtn);

    const captureOnlyWhenTabVisible = () => {
      // Each Facebook tab owns an independent conversation state. Allow a
      // hidden seller tab to continue polling so two open Marketplace threads
      // can be processed concurrently; backend idempotency is the final guard
      // when duplicate tabs happen to show the same thread.
      captureConversation({ silent: true, automatic: true }).catch((err) => {
        console.warn("[DealerPilot AI] Messenger auto-capture failed", err);
      });
    };

    setTimeout(captureOnlyWhenTabVisible, 1200);
    setInterval(() => {
      if (!isMessengerUiVisible()) return;
      captureOnlyWhenTabVisible();
    }, MESSENGER_CAPTURE_INTERVAL_MS);
  }

  initMessengerAiControls();
  setInterval(initMessengerAiControls, 1500);

  function insertReply(text) {
    // Use the composer resolved inside the active Marketplace thread. A global
    // contenteditable selector can target Facebook search instead of Messenger.
    const box = getMessengerMessageBox();

    if (!box) {
      setStatus("Could not find the message box.", "err");
      return false;
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
    setStatus("Reply inserted.", "ok");
    return true;
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

  log("Panel loaded", { version: EXT_VERSION, isMessenger, isMarketplaceCreate });
})();
