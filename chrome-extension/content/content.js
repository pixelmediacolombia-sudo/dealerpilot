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
      document.querySelectorAll('input[type="text"], input:not([type]), input[type="number"], textarea')
    ).filter((el) => el.offsetParent !== null);
    for (const kw of keywords) {
      const match = fields.find((el) => labelText(el).includes(kw));
      if (match) return match;
    }
    return null;
  }

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
      <div id="mai-actions"></div>
      <div id="mai-output" class="mai-output" hidden></div>
    </div>
  `;
  document.documentElement.appendChild(panel);

  const statusEl = panel.querySelector("#mai-status");
  const actionsEl = panel.querySelector("#mai-actions");
  const outputEl = panel.querySelector("#mai-output");
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

  function button(label, onClick) {
    const b = document.createElement("button");
    b.className = "mai-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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

  // ---- Context detection ----
  const href = window.location.href;
  const isMessenger =
    location.hostname.includes("messenger.com") || /\/messages\b/.test(href);
  const isMarketplaceCreate = /\/marketplace\/create/.test(href);

  if (isMarketplaceCreate) {
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
        if (titleEl) {
          setNativeValue(titleEl, listing.title);
          filled.push("title");
        } else missed.push("title");

        const priceEl = findField(["price"]);
        if (priceEl) {
          setNativeValue(priceEl, String(listing.price));
          filled.push("price");
        } else missed.push("price");

        const mileageEl = findField(["mileage", "odometer"]);
        if (mileageEl) {
          setNativeValue(mileageEl, String(listing.mileage));
          filled.push("mileage");
        } else missed.push("mileage");

        const descEl = findField(["description", "describe"]);
        if (descEl) {
          setNativeValue(descEl, listing.description);
          filled.push("description");
        } else missed.push("description");

        setStatus("Listing data received. Publish was NOT clicked.", "ok");
        showOutput(
          `<div class="mai-line"><strong>Filled:</strong> ${filled.join(", ") || "none"}</div>` +
            `<div class="mai-line"><strong>Not found on page:</strong> ${
              missed.join(", ") || "none"
            }</div>` +
            `<pre class="mai-pre">${escapeHtml(JSON.stringify(listing, null, 2))}</pre>`
        );
        log("Test listing", listing, { filled, missed });
      })
    );
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
          `<button class="mai-btn mai-btn-secondary" id="mai-insert">Insert Reply</button>`
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
