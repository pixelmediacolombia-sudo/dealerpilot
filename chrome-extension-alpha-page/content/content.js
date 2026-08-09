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
        <h1>DealerPilot Page Publisher</h1>
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

  function findScrollableComposerPane() {
    const candidates = Array.from(document.querySelectorAll("div")).filter((el) => {
      if (!isVisible(el)) return false;
      const style = window.getComputedStyle(el);
      const canScroll = /(auto|scroll)/.test(style.overflowY || "");
      if (!canScroll || el.scrollHeight <= el.clientHeight + 80) return false;
      const text = normalizeText(el.innerText || el.textContent || "");
      return text.includes("post to") || text.includes("media") || text.includes("post details");
    });
    return candidates[0] || document.scrollingElement || document.documentElement;
  }

  function nudgeComposerScroll(top = 360) {
    const pane = findScrollableComposerPane();
    pane?.scrollBy?.({ top, behavior: "auto" });
    if (pane && !pane.scrollBy) pane.scrollTop += top;
  }

  function getComposerDiagnostics() {
    const pane = findScrollableComposerPane();
    const visibleText = normalizeText(pane?.innerText || pane?.textContent || "");
    const fields = collectSearchRoots().flatMap((root) =>
      Array.from(root.querySelectorAll?.(
        "textarea, input, [role='textbox'], [contenteditable='true'], [contenteditable='plaintext-only'], [data-lexical-editor]",
      ) || []),
    ).filter(isVisible).map((field) => ({
      tag: field.tagName,
      role: field.getAttribute("role") || "",
      aria: field.getAttribute("aria-label") || "",
      placeholder: field.getAttribute("placeholder") || "",
      editable: field.isContentEditable,
      frame: field.ownerDocument?.defaultView?.frameElement ? "iframe" : "document",
      text: normalizeText(field.innerText || field.value || field.textContent || "").slice(0, 80),
    }));
    return {
      scrollTop: pane?.scrollTop || 0,
      scrollHeight: pane?.scrollHeight || 0,
      clientHeight: pane?.clientHeight || 0,
      visibleSections: ["post to", "media", "post details", "button", "schedule", "collaborator", "share to"]
        .filter((section) => visibleText.includes(section)),
      fields,
    };
  }

  function scrollComposerPaneTo(position) {
    const pane = findScrollableComposerPane();
    if (!pane) return;
    if (position === "top") pane.scrollTop = 0;
    if (position === "bottom") pane.scrollTop = pane.scrollHeight;
  }

  function absoluteRect(element) {
    let rect = element.getBoundingClientRect();
    let owner = element.ownerDocument?.defaultView;
    while (owner?.frameElement) {
      const frameRect = owner.frameElement.getBoundingClientRect();
      rect = {
        left: frameRect.left + rect.left,
        top: frameRect.top + rect.top,
        right: frameRect.left + rect.right,
        bottom: frameRect.top + rect.bottom,
        width: rect.width,
        height: rect.height,
      };
      owner = owner.frameElement.ownerDocument?.defaultView;
    }
    return rect;
  }

  function findByText(patterns) {
    const normalizedPatterns = patterns.map(normalizeText);
    const nodes = Array.from(document.querySelectorAll("button, [role='button'], a, span, div"))
      .filter(isVisible);
    const matches = nodes.filter((node) => {
      const text = normalizeText(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
      return text && normalizedPatterns.some((pattern) => text.includes(pattern));
    });
    const clickable = matches.map((node) => node.closest("button, [role='button'], a") || node)
      .find((node) => isVisible(node) && node.matches("button, [role='button'], a"));
    return clickable || null;
  }

  function findTextField() {
    const fields = collectSearchRoots().flatMap((root) =>
      Array.from(root.querySelectorAll?.(
        "textarea, [role='textbox'], [contenteditable='true'], [contenteditable='plaintext-only'], [data-lexical-editor]",
      ) || []),
    ).filter((field) => {
      if (!isVisible(field)) return false;
      const descriptor = normalizeText(`${field.getAttribute("aria-label") || ""} ${field.getAttribute("placeholder") || ""}`);
      return !/search|username|page url|comment|collaborator/.test(descriptor);
    });

    const facebookField = fields.find((field) => {
      const text = normalizeText([
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.closest("label")?.innerText,
        field.parentElement?.innerText,
      ].filter(Boolean).join(" "));
      return text.includes("facebook") && (text.includes("text") || text.includes("write") || text.includes("post"));
    });
    const byLabel = fields.find((field) => {
      const text = normalizeText(`${field.getAttribute("aria-label") || ""} ${field.getAttribute("placeholder") || ""}`);
      return text.includes("text") || text.includes("write") || text.includes("post");
    });
    return facebookField || byLabel || fields[0] || null;
  }

  async function trustedClick(element) {
    element.scrollIntoView?.({ block: "center", behavior: "instant" });
    await sleep(200);
    const rect = absoluteRect(element);
    const response = await chrome.runtime.sendMessage({
      type: "ALPHA_DEBUGGER_CLICK",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    if (!response?.ok || !response?.data?.ok) {
      throw new Error(response?.data?.error || response?.error || "Trusted Business Suite click failed.");
    }
  }

  async function revealTextFields() {
    if (findTextField()) return;
    scrollComposerPaneTo("top");
    const customizeSwitch = Array.from(document.querySelectorAll("[role='switch'], input[type='checkbox']"))
      .find((element) => normalizeText(element.getAttribute("aria-label") || element.parentElement?.innerText || "")
        .includes("customize post for facebook and instagram"));
    if (!customizeSwitch) return;
    await sendDebug("customize_switch_clicking", {
      aria: customizeSwitch.getAttribute("aria-label") || "",
      checked: customizeSwitch.getAttribute("aria-checked") || customizeSwitch.checked || false,
    });
    await trustedClick(customizeSwitch);
    await sleep(1000);
  }

  function auditIframes() {
    return Array.from(document.querySelectorAll("iframe")).map((frame) => {
      let rect = null;
      try {
        const r = frame.getBoundingClientRect();
        rect = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      } catch (_) {}
      let accessible = false;
      try {
        accessible = Boolean(frame.contentDocument);
      } catch (_) {}
      return {
        title: frame.getAttribute("title") || "",
        aria: frame.getAttribute("aria-label") || "",
        id: frame.id || "",
        src: (frame.src || "").slice(0, 160),
        accessible,
        rect,
      };
    });
  }

  function syntheticField(data) {
    return {
      label: data.label || data.text || "",
      getBoundingClientRect: () => ({
        left: data.x - data.width / 2,
        top: data.y - data.height / 2,
        right: data.x + data.width / 2,
        bottom: data.y + data.height / 2,
        width: data.width,
        height: data.height,
      }),
    };
  }

  async function findTextFieldAcrossFrames() {
    scrollComposerPaneTo("top");
    await sleep(500);
    const response = await chrome.runtime.sendMessage({ type: "ALPHA_DEBUGGER_FIND_TEXT_FIELD" });
    if (!response?.ok || !response?.data?.ok) {
      await sendDebug("cross_frame_search_failed", {
        error: response?.data?.error || response?.error || "unknown",
      });
      return { field: null, hint: null };
    }
    const data = response.data;
    await sendDebug("cross_frame_search", {
      found: Boolean(data.found),
      framesTotal: data.framesTotal,
      framesSearched: data.framesSearched,
      errors: Array.isArray(data.errors) ? data.errors.slice(0, 4) : [],
      fieldLabel: data.field?.label ? String(data.field.label).slice(0, 80) : "",
      hintLabel: data.hint?.label ? String(data.hint.label).slice(0, 80) : "",
    });
    return {
      field: data.found && data.field ? syntheticField(data.field) : null,
      hint: data.hint ? syntheticField(data.hint) : null,
    };
  }

  async function tryClickHint(hint) {
    const rect = hint.getBoundingClientRect();
    const response = await chrome.runtime.sendMessage({
      type: "ALPHA_DEBUGGER_CLICK",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    return Boolean(response?.ok && response?.data?.ok);
  }

  function findHiddenTextField() {
    const candidates = collectSearchRoots().flatMap((root) =>
      Array.from(root.querySelectorAll?.(
        "textarea, [role='textbox'], [contenteditable='true'], [contenteditable='plaintext-only'], [data-lexical-editor]",
      ) || []),
    );
    const preferred = candidates.find((field) => {
      const descriptor = normalizeText(`${field.getAttribute("aria-label") || ""} ${field.getAttribute("placeholder") || ""}`);
      return /write|text|message|dialogue|post|say/i.test(descriptor)
        && !/search|username|page url|comment|collaborator/i.test(descriptor);
    });
    return preferred || candidates[0] || null;
  }

  function describeTextFieldAncestors(field) {
    const nodes = [];
    let node = field;
    while (node && nodes.length < 8) {
      const rect = node.getBoundingClientRect();
      const style = node !== document.documentElement ? window.getComputedStyle(node) : null;
      const ownText = Array.from(node.childNodes || [])
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      nodes.push({
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute?.("role") || "",
        cls: (typeof node.className === "string" ? node.className : "").slice(0, 80),
        rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
        display: style?.display || "",
        visibility: style?.visibility || "",
        overflow: style?.overflowY || "",
        text: ownText.slice(0, 40),
      });
      node = node.parentElement;
    }
    return nodes;
  }

  function forceRevealTextField(field) {
    let changed = false;
    let node = field;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        node.style.display = "block";
        node.style.visibility = "visible";
        changed = true;
      }
      node = node.parentElement;
    }
    if (field.clientHeight === 0) {
      field.style.minHeight = "120px";
      field.style.height = "120px";
      changed = true;
    }
    return changed;
  }

  async function clickTextRegion() {
    const headings = Array.from(document.querySelectorAll("[role='heading']")).filter(isVisible);
    const postTo = headings.find((h) => normalizeText(h.innerText || h.textContent || "") === "post to");
    const media = headings.find((h) => normalizeText(h.innerText || h.textContent || "") === "media");
    if (!postTo || !media) return false;
    const postRect = postTo.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const x = Math.round(postRect.left + postRect.width / 2);
    const y = Math.round(postRect.bottom + Math.max(20, (mediaRect.top - postRect.bottom) / 2));
    const response = await chrome.runtime.sendMessage({
      type: "ALPHA_DEBUGGER_CLICK",
      x,
      y,
    });
    return Boolean(response?.ok && response?.data?.ok);
  }

  async function waitForTextField(timeoutMs = 12000) {
    const started = Date.now();
    scrollComposerPaneTo("top");
    while (Date.now() - started < timeoutMs) {
      const field = findTextField();
      if (field) return field;
      nudgeComposerScroll();
      if (Date.now() - started > timeoutMs / 2) nudgeComposerScroll(-260);
      await sleep(500);
    }
    const hidden = findHiddenTextField();
    if (hidden) {
      const descriptor = normalizeText(`${hidden.getAttribute("aria-label") || ""} ${hidden.getAttribute("placeholder") || ""}`);
      await sendDebug("hidden_field_found", {
        tag: hidden.tagName.toLowerCase(),
        aria: descriptor.slice(0, 80),
        ancestors: describeTextFieldAncestors(hidden),
      });
      if (await clickTextRegion()) {
        await sleep(1500);
        const field = findTextField();
        if (field) return field;
      }
      forceRevealTextField(hidden);
      await sleep(500);
      const revealed = findTextField();
      if (revealed) return revealed;
      if (isVisible(hidden)) return hidden;
    }
    let attempt = await findTextFieldAcrossFrames();
    if (attempt.field) return attempt.field;
    const clickedHints = new Set();
    let guard = 0;
    while (attempt.hint && guard < 3) {
      const label = attempt.hint.label || "";
      if (clickedHints.has(label)) break;
      clickedHints.add(label);
      await sendDebug("text_hint_clicking", { label: label.slice(0, 80) });
      if (!(await tryClickHint(attempt.hint))) break;
      await sleep(1500);
      const local = findTextField();
      if (local) return local;
      attempt = await findTextFieldAcrossFrames();
      if (attempt.field) return attempt.field;
      guard += 1;
    }
    return null;
  }

  async function setFieldValue(field, value) {
    field.scrollIntoView?.({ block: "center", behavior: "instant" });
    await sleep(200);
    const rect = absoluteRect(field);
    const response = await chrome.runtime.sendMessage({
      type: "ALPHA_DEBUGGER_FILL_TEXT",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      text: value,
    });
    if (!response?.ok || !response?.data?.ok) {
      throw new Error(response?.data?.error || response?.error || "Business Suite text insertion failed.");
    }
    return response.data;
  }

  function collectSearchRoots() {
    const roots = [document];
    const visited = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      for (const element of root.querySelectorAll?.("*") || []) {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          visited.add(element.shadowRoot);
          roots.push(element.shadowRoot);
        }
        if (element.tagName === "IFRAME") {
          try {
            const frameDocument = element.contentDocument;
            if (frameDocument && !visited.has(frameDocument)) {
              visited.add(frameDocument);
              roots.push(frameDocument);
            }
          } catch (_) {
            // Cross-origin frames are not accessible from this content script.
          }
        }
      }
    }
    return roots;
  }

  function getPhotoInputCandidates() {
    return collectSearchRoots().flatMap((root) =>
      Array.from(root.querySelectorAll?.("input[type='file']") || []))
      .filter((input) => input.isConnected !== false);
  }

  function describePhotoInputs(inputs) {
    return inputs.map((input) => ({
      accept: input.getAttribute("accept") || "",
      multiple: input.multiple === true,
      name: input.getAttribute("name") || "",
      aria: input.getAttribute("aria-label") || "",
      connected: input.isConnected !== false,
    }));
  }

  function choosePhotoInput(inputs) {
    const preferred = inputs.find((candidate) => {
      const accept = normalizeText(candidate.getAttribute("accept") || "");
      return accept.includes("image") || /\.(?:jpe?g|png|webp)/i.test(accept) || candidate.multiple;
    });
    return preferred || inputs[inputs.length - 1] || null;
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
    const existingInput = choosePhotoInput(getPhotoInputCandidates());
    if (!existingInput) {
      scrollComposerPaneTo("top");
      const addButton = findByText(["add photo/video", "add photos", "add photo"]);
      if (!addButton) throw new Error("Business Suite Add photo/video button was not found.");
      addButton.scrollIntoView?.({ block: "center", behavior: "instant" });
      await sleep(250);
      const rect = absoluteRect(addButton);
      setStatus(`Downloading and assigning ${payload.images.length} photos through Business Suite...`);
      await sendDebug("photo_chooser_dispatching", {
        addButtonText: normalizeText(addButton.innerText || addButton.textContent || addButton.getAttribute("aria-label") || "").slice(0, 80),
        buttonRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      });
      const response = await chrome.runtime.sendMessage({
        type: "ALPHA_DEBUGGER_UPLOAD",
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        files: payload.images.map((image) => ({
          url: `${backendUrl}${image.proxyUrl}`,
          filename: `alpha-${payload.vehicle.id}-${String(image.index + 1).padStart(2, "0")}.jpg`,
        })),
      });
      if (!response?.ok || !response?.data?.ok) {
        throw new Error(response?.data?.error || response?.error || "Business Suite file chooser upload failed.");
      }
      await sendDebug("photos_assigned", {
        requestedPhotoCount: payload.images.length,
        assignedPhotoCount: response.data.assignedPhotoCount,
        method: response.data.method,
      });
      setStatus(`Assigned ${response.data.assignedPhotoCount} photos. Waiting for Business Suite preview...`);
      await sleep(4000);
      return;
    }

    setStatus(`Downloading ${payload.images.length} photos from DealerPilot...`);
    const files = await fetchDraftFiles(payload, backendUrl);
    const input = existingInput;

    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
    if (filesSetter) filesSetter.call(input, dataTransfer.files);
    else input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sendDebug("photos_assigned", {
      requestedPhotoCount: files.length,
      assignedPhotoCount: input.files?.length || 0,
      selectedInput: describePhotoInputs([input])[0],
    });
    setStatus(`Uploaded ${files.length} photos into the draft. Waiting for Business Suite preview...`);
    await sleep(2500);
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
    await uploadPhotos(payload, backendUrl);
    await revealTextFields();
    const field = await waitForTextField();
    if (!field) {
      const frameTreeResponse = await chrome.runtime.sendMessage({ type: "ALPHA_DEBUGGER_FRAME_TREE" });
      const captureResponse = await chrome.runtime.sendMessage({ type: "ALPHA_DEBUGGER_CAPTURE" }).catch(() => null);
      await sendDebug("blocked", {
        reason: "text_field_not_found",
        composer: getComposerDiagnostics(),
        iframes: auditIframes(),
        frameTree: frameTreeResponse?.ok ? frameTreeResponse.data.frames : (frameTreeResponse?.error || "unavailable"),
        domDump: buildDomDump(),
        textCandidates: findHiddenTextFieldCandidates(),
        textAncestors: (() => {
          const hidden = findHiddenTextField();
          return hidden ? describeTextFieldAncestors(hidden) : [];
        })(),
        captureResult: captureResponse?.ok ? captureResponse.data : (captureResponse?.error || "unavailable"),
      });
      throw new Error("Business Suite text field was not found.");
    }
    const textResult = await setFieldValue(field, payload.post.text);
    await sendDebug("text_filled", {
      vehicleId: payload.vehicle?.id || null,
      textLength: payload.post.text.length,
      method: textResult.method,
    });
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

  function findHiddenTextFieldCandidates() {
    return collectSearchRoots().flatMap((root) =>
      Array.from(root.querySelectorAll?.(
        "textarea, [role='textbox'], [contenteditable], [data-lexical-editor]",
      ) || []),
    ).map((field) => {
      const rect = field.getBoundingClientRect();
      return {
        tag: field.tagName,
        role: field.getAttribute("role") || "",
        aria: (field.getAttribute("aria-label") || "").slice(0, 60),
        editable: field.isContentEditable,
        visible: rect.width > 0 && rect.height > 0,
        rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    }).slice(0, 20);
  }

  function buildDomDump() {
    const pane = findScrollableComposerPane();
    const root = pane || document.body;
    const interesting = new Set(["input", "textarea", "select", "button", "a", "h1", "h2", "h3", "h4", "p", "label"]);
    const items = [];
    const seenText = new Set();
    for (const el of root.querySelectorAll("*")) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || "";
      const aria = el.getAttribute("aria-label") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const ownText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      const text = ownText || aria || placeholder;
      const editable = el.isContentEditable;
      if (!text && !role && !editable && !interesting.has(tag)) continue;
      if (text && seenText.has(text)) continue;
      if (text) seenText.add(text);
      items.push({
        tag,
        role,
        aria: aria.slice(0, 40),
        ph: placeholder.slice(0, 40),
        editable,
        text,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
      if (items.length >= 250) break;
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    return {
      paneText: normalizeText(pane?.innerText || "").slice(0, 1500),
      paneRect: pane
        ? ((r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }))(pane.getBoundingClientRect())
        : null,
      items,
    };
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
