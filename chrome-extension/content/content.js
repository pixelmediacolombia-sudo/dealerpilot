(function () {
  if (window.__marketplaceAiPanelLoaded) return;
  window.__marketplaceAiPanelLoaded = true;

  const log = (...args) => console.log("[DealerPilot AI]", ...args);

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

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
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
      <span id="mai-title">DealerPilot AI Connected</span>
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

    setStatus("Loading listing data…");
    const res = await send({ type: "GET_JOB_PAYLOAD", jobId: job.id });
    if (!res || !res.ok) {
      setStatus("Could not load job data: " + (res && res.error), "err");
      return;
    }
    const { fill, images } = res.data;

    const filled = [];
    const missed = [];
    const warnings = [];

    function tryFill(label, keywords, value) {
      if (value === null || value === undefined || value === "") {
        warnings.push(`${label} has no data in the listing`);
        return;
      }
      const el = findField(keywords);
      if (el) {
        setNativeValue(el, String(value));
        filled.push(label);
      } else {
        missed.push(label);
      }
    }

    tryFill("title", ["title", "what are you selling", "vehicle name"], fill.title);
    tryFill("price", ["price"], fill.price);
    tryFill("description", ["description", "describe"], fill.description);
    tryFill("mileage", ["mileage", "odometer"], fill.mileage);
    tryFill("year", ["year"], fill.year);
    tryFill("make", ["make"], fill.make);
    tryFill("model", ["model"], fill.model);
    tryFill("vin", ["vin"], fill.vin);
    tryFill("location", ["location", "city"], fill.location);

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
            setStatus("Fetching test listing…");
            const res = await send({ type: "GET_TEST_LISTING" });
            if (!res || !res.ok) {
              setStatus("Failed: " + (res && res.error), "err");
              return;
            }
            const listing = res.data;
            const filled = [];
            const missed = [];

            const titleEl = findField(["title", "what are you selling", "vehicle name"]);
            if (titleEl) { setNativeValue(titleEl, listing.title); filled.push("title"); }
            else missed.push("title");

            const priceEl = findField(["price"]);
            if (priceEl) { setNativeValue(priceEl, String(listing.price)); filled.push("price"); }
            else missed.push("price");

            const mileageEl = findField(["mileage", "odometer"]);
            if (mileageEl) { setNativeValue(mileageEl, String(listing.mileage)); filled.push("mileage"); }
            else missed.push("mileage");

            const descEl = findField(["description", "describe"]);
            if (descEl) { setNativeValue(descEl, listing.description); filled.push("description"); }
            else missed.push("description");

            setStatus("Listing data received. Publish was NOT clicked.", "ok");
            showOutput(
              `<div class="mai-line"><strong>Filled:</strong> ${filled.join(", ") || "none"}</div>` +
              `<div class="mai-line"><strong>Not found on page:</strong> ${missed.join(", ") || "none"}</div>` +
              `<pre class="mai-pre">${escapeHtml(JSON.stringify(listing, null, 2))}</pre>`,
            );
            log("Test listing", listing, { filled, missed });
          }),
        );
      }
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
