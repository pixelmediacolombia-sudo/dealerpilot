(function () {
  if (window.__dealerpilotAlphaPagePublisherLoaded) return;
  window.__dealerpilotAlphaPagePublisherLoaded = true;

  const PANEL_ID = "dealerpilot-alpha-panel";
  const TARGET_PAGE_TEXT = "alpha motorsports";
  const INSTAGRAM_TEXT = "alphamotorsportlatino";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    const rect = el?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <header>
        <h1>DealerPilot Alpha Page Publisher</h1>
        <p>Prepares the Business Suite draft. Human review is required before Publish.</p>
      </header>
      <div class="body">
        <div class="status" data-alpha-status>Waiting for a DealerPilot vehicle payload.</div>
        <button type="button" data-alpha-fill>Fill Alpha draft</button>
      </div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector("[data-alpha-fill]")?.addEventListener("click", () => {
      fillPendingDraft().catch((error) => setStatus(error.message || String(error), "err"));
    });
    return panel;
  }

  function sendDebug(stage, details = {}) {
    return chrome.runtime.sendMessage({
      type: "ALPHA_DRAFT_DEBUG",
      debug: {
        stage,
        url: window.location.href,
        pageVisible: normalizeText(document.body.innerText || document.body.textContent || "").includes(TARGET_PAGE_TEXT),
        instagramVisible: normalizeText(document.body.innerText || document.body.textContent || "").includes(INSTAGRAM_TEXT),
        ...details,
        at: new Date().toISOString(),
      },
    }).catch(() => {});
  }

  function setStatus(message, tone = "") {
    const panel = createPanel();
    const status = panel.querySelector("[data-alpha-status]");
    if (!status) return;
    status.className = `status ${tone}`.trim();
    status.textContent = message;
  }

  function setBusy(isBusy) {
    const panel = createPanel();
    const button = panel.querySelector("[data-alpha-fill]");
    if (button) button.disabled = isBusy;
  }

  function verifyComposerTarget() {
    const text = normalizeText(document.body.innerText || document.body.textContent || "");
    if (!text.includes(TARGET_PAGE_TEXT)) {
      throw new Error("Alpha MotorSports is not visible in this Business Suite composer. Draft fill stopped.");
    }
    return {
      instagramAlsoSelected: text.includes(INSTAGRAM_TEXT),
    };
  }

  async function waitForComposerTarget(timeoutMs = 20000) {
    const started = Date.now();
    let latestError = null;
    while (Date.now() - started < timeoutMs) {
      try {
        return verifyComposerTarget();
      } catch (error) {
        latestError = error;
        await sendDebug("waiting_for_target", { reason: error.message || String(error) });
        await sleep(700);
      }
    }
    throw latestError || new Error("Alpha MotorSports is not visible in this Business Suite composer.");
  }

  function findByText(patterns) {
    const normalizedPatterns = patterns.map(normalizeText);
    const nodes = Array.from(document.querySelectorAll("button, div[role='button'], span, div"))
      .filter(isVisible);
    return nodes.find((node) => {
      const text = normalizeText(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
      return text && normalizedPatterns.some((pattern) => text.includes(pattern));
    }) || null;
  }

  function findTextField() {
    const fields = Array.from(
      document.querySelectorAll("textarea, [role='textbox'], [contenteditable='true']"),
    ).filter(isVisible);

    const byLabel = fields.find((field) => {
      const text = normalizeText([
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.closest("label")?.innerText,
        field.parentElement?.innerText,
      ].filter(Boolean).join(" "));
      return text.includes("text") || text.includes("write") || text.includes("post details");
    });
    return byLabel || fields[fields.length - 1] || null;
  }

  async function waitForTextField(timeoutMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const field = findTextField();
      if (field) return field;
      window.scrollBy({ top: 360, behavior: "auto" });
      await sleep(500);
    }
    return null;
  }

  function setFieldValue(field, value) {
    field.focus?.();
    if ("value" in field) {
      const setter = Object.getOwnPropertyDescriptor(
        field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(field, value);
    } else {
      field.textContent = value;
    }
    field.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: value,
    }));
    field.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value,
    }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function findPhotoInput(timeoutMs = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = Array.from(document.querySelectorAll("input[type='file']")).find((candidate) => {
        const accept = normalizeText(candidate.getAttribute("accept") || "");
        return accept.includes("image") || candidate.multiple;
      });
      if (input) return input;

      const addButton = findByText(["add photo/video", "add photos", "add photo", "media"]);
      addButton?.click();
      await sleep(700);
    }
    return null;
  }

  function extensionFromType(type) {
    if (/png/i.test(type)) return "png";
    if (/webp/i.test(type)) return "webp";
    return "jpg";
  }

  async function fetchDraftFiles(payload, backendUrl) {
    const files = [];
    for (const image of payload.images || []) {
      const response = await fetch(`${backendUrl}${image.proxyUrl}`);
      if (!response.ok) throw new Error(`Photo ${image.index + 1} failed: ${response.status}`);
      const blob = await response.blob();
      const type = blob.type || "image/jpeg";
      files.push(new File(
        [blob],
        `alpha-${payload.vehicle.id}-${String(image.index + 1).padStart(2, "0")}.${extensionFromType(type)}`,
        { type },
      ));
    }
    return files;
  }

  async function uploadPhotos(payload, backendUrl) {
    if (!payload.images?.length) throw new Error("Vehicle payload has no photos.");
    setStatus(`Downloading ${payload.images.length} photos from DealerPilot...`);
    const files = await fetchDraftFiles(payload, backendUrl);
    const input = await findPhotoInput();
    if (!input) throw new Error("Business Suite photo upload input was not found.");

    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setStatus(`Uploaded ${files.length} photos into the draft. Waiting for Business Suite preview...`);
  }

  async function fillDraft(payload, backendUrl) {
    if (!payload?.post?.text) throw new Error("DealerPilot payload is missing post text.");
    if (payload.readiness && payload.readiness.ready === false) {
      throw new Error(`Vehicle is not ready for Alpha page posting: ${payload.readiness.missing.join(", ")}`);
    }

    await sendDebug("started", {
      vehicleId: payload.vehicle?.id || null,
      vehicleLabel: payload.vehicle?.label || null,
      photoCount: payload.images?.length || 0,
    });
    const targetState = await waitForComposerTarget();
    setStatus(`Filling ${payload.vehicle.label} for Alpha MotorSports...`);
    const field = await waitForTextField();
    if (!field) {
      await sendDebug("blocked", { reason: "text_field_not_found" });
      throw new Error("Business Suite text field was not found.");
    }
    setFieldValue(field, payload.post.text);
    await sendDebug("text_filled", {
      vehicleId: payload.vehicle?.id || null,
      textLength: payload.post.text.length,
    });
    await uploadPhotos(payload, backendUrl);

    await chrome.storage.local.set({
      pendingAlphaPagePost: { payload, backendUrl, autoFill: false, filledAt: new Date().toISOString() },
    });

    const instagramWarning = targetState.instagramAlsoSelected
      ? " Instagram is also selected in Business Suite; remove it manually if this should be Facebook Page only."
      : "";
    setStatus(
      `Draft prepared. Review text, photos, and target, then manually click Publish when ready.${instagramWarning}`,
      targetState.instagramAlsoSelected ? "warn" : "ok",
    );
    await sendDebug("draft_prepared", {
      vehicleId: payload.vehicle?.id || null,
      vehicleLabel: payload.vehicle?.label || null,
      photoCount: payload.images?.length || 0,
      instagramAlsoSelected: targetState.instagramAlsoSelected,
      humanPublishRequired: true,
    });
  }

  async function fillPendingDraft() {
    setBusy(true);
    try {
      const { pendingAlphaPagePost } = await chrome.storage.local.get("pendingAlphaPagePost");
      if (!pendingAlphaPagePost?.payload) {
        throw new Error("No DealerPilot Alpha payload is pending. Use the extension popup first.");
      }
      await fillDraft(pendingAlphaPagePost.payload, pendingAlphaPagePost.backendUrl);
    } finally {
      setBusy(false);
    }
  }

  async function maybeAutoFill() {
    const { pendingAlphaPagePost } = await chrome.storage.local.get("pendingAlphaPagePost");
    if (!pendingAlphaPagePost?.autoFill) return;
    await sleep(2500);
    await fillPendingDraft();
  }

  createPanel();
  maybeAutoFill().catch((error) => setStatus(error.message || String(error), "err"));
})();
