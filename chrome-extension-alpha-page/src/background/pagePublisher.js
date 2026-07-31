(function () {
  const ALPHA_COMPOSER_URL =
    "https://business.facebook.com/latest/composer/?asset_id=265746649947861&business_id=7725528554132936&context_ref=HOME&nav_ref=internal_nav&ref=dealerpilot_alpha_page";

  async function saveLastError(error) {
    await chrome.storage.local.set({
      lastAlphaPageError: {
        message: error?.message ? String(error.message) : String(error),
        stack: error?.stack || null,
        at: new Date().toISOString(),
      },
    });
  }

  async function getDebugState() {
    const keys = [
      "backendUrl",
      "pendingAlphaPagePost",
      "lastAlphaPageDraftDebug",
      "lastAlphaPageError",
      "alphaPageDebugHistory",
      "lastAlphaPageScreenshot",
    ];
    const stored = await chrome.storage.local.get(keys);
    const pending = stored.pendingAlphaPagePost || null;
    return {
      version: chrome.runtime.getManifest?.().version || "0.1.0",
      backendUrl: stored.backendUrl || "https://1987dealerpilot.com",
      debugHistory: Array.isArray(stored.alphaPageDebugHistory) ? stored.alphaPageDebugHistory : [],
      hasScreenshot: Boolean(stored.lastAlphaPageScreenshot),
      target: {
        pageId: "265746649947861",
        businessId: "7725528554132936",
        pageName: "Alpha MotorSports: Easy Credit / Credito Facil",
        composerUrl: ALPHA_COMPOSER_URL,
      },
      pendingPost: pending
        ? {
            vehicleId: pending.payload?.vehicle?.id || null,
            vehicleLabel: pending.payload?.vehicle?.label || null,
            photoCount: pending.payload?.images?.length || 0,
            autoFill: pending.autoFill === true,
            preparedAt: pending.preparedAt || null,
            filledAt: pending.filledAt || null,
            backendUrl: pending.backendUrl || null,
            readiness: pending.payload?.readiness || null,
            target: pending.payload?.target || null,
          }
        : null,
      lastDraftDebug: stored.lastAlphaPageDraftDebug || null,
      lastError: stored.lastAlphaPageError || null,
      rawPendingPost: pending,
    };
  }

  async function openAlphaComposer(composerUrl) {
    const targetUrl = composerUrl || ALPHA_COMPOSER_URL;
    const tabs = await chrome.tabs.query({ url: "https://business.facebook.com/latest/composer*" });
    if (tabs[0]?.id) {
      await chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
      if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
      return { tabId: tabs[0].id, reused: true };
    }
    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    return { tabId: tab.id, reused: false };
  }

  async function waitForDownload(downloadId, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const [download] = await chrome.downloads.search({ id: downloadId });
      if (download?.state === "complete" && download.filename) return download;
      if (download?.state === "interrupted") {
        throw new Error(`Photo download interrupted: ${download.error || "unknown_error"}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Timed out while downloading photos for Business Suite.");
  }

  async function downloadDraftPhotos(files) {
    const downloads = [];
    for (const file of files) {
      const downloadId = await chrome.downloads.download({
        url: file.url,
        filename: `DealerPilot Alpha Drafts/${file.filename}`,
        conflictAction: "overwrite",
        saveAs: false,
      });
      downloads.push(await waitForDownload(downloadId));
    }
    return downloads;
  }

  async function uploadThroughFileChooser(message, sender) {
    const tabId = sender?.tab?.id;
    if (!tabId) return { ok: false, error: "no_tab_id" };
    if (!Array.isArray(message.files) || message.files.length === 0) {
      return { ok: false, error: "no_photo_files" };
    }
    const downloads = await downloadDraftPhotos(message.files);
    const filePaths = downloads.map((download) => download.filename);
    let chooserListener = null;
    let chooserTimer = null;
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
      await chrome.debugger.sendCommand({ tabId }, "Page.setInterceptFileChooserDialog", { enabled: true });
      const chooserOpened = new Promise((resolve, reject) => {
        chooserListener = (source, method, params) => {
          if (source.tabId === tabId && method === "Page.fileChooserOpened") resolve(params);
        };
        chrome.debugger.onEvent.addListener(chooserListener);
        chooserTimer = setTimeout(() => reject(new Error("business_suite_file_chooser_timeout")), 10000);
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: message.x,
        y: message.y,
        button: "left",
        clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: message.x,
        y: message.y,
        button: "left",
        clickCount: 1,
      });
      const chooser = await chooserOpened;
      await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
        files: filePaths,
        backendNodeId: chooser.backendNodeId,
      });
      return {
        ok: true,
        method: "debugger_file_chooser",
        assignedPhotoCount: filePaths.length,
        downloadIds: downloads.map((download) => download.id),
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error),
      };
    } finally {
      if (chooserTimer) clearTimeout(chooserTimer);
      if (chooserListener) chrome.debugger.onEvent.removeListener(chooserListener);
      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.setInterceptFileChooserDialog", { enabled: false });
      } catch (_) {}
      try {
        await chrome.debugger.detach({ tabId });
      } catch (_) {}
    }
  }

  async function dispatchTrustedClick(message, sender) {
    const tabId = sender?.tab?.id;
    if (!tabId) return { ok: false, error: "no_tab_id" };
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed", x: message.x, y: message.y, button: "left", clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x: message.x, y: message.y, button: "left", clickCount: 1,
      });
      return { ok: true, method: "debugger_click" };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    } finally {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }

  async function fillTextThroughDebugger(message, sender) {
    const tabId = sender?.tab?.id;
    if (!tabId) return { ok: false, error: "no_tab_id" };
    if (typeof message.text !== "string" || !message.text.trim()) {
      return { ok: false, error: "no_post_text" };
    }
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mousePressed", x: message.x, y: message.y, button: "left", clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x: message.x, y: message.y, button: "left", clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
        type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17,
      });
      await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: message.text });
      return { ok: true, method: "debugger_insert_text", textLength: message.text.length };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    } finally {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }

  function buildFieldSearchScript() {
    return `(() => {
      const selector = "textarea, [role='textbox'], [contenteditable='true'], [contenteditable='plaintext-only'], [data-lexical-editor]";
      const exclude = /search|username|page url|comment|collaborator/;
      const textish = /text|write|post|message|say something|what\\s+on your mind|escribe|publica/;
      const candidates = Array.from(document.querySelectorAll(selector)).map((field) => {
        const rect = field.getBoundingClientRect();
        const descriptor = ((field.getAttribute("aria-label") || "") + " " + (field.getAttribute("placeholder") || "")).toLowerCase().replace(/\\s+/g, " ").trim();
        return {
          tag: field.tagName,
          role: field.getAttribute("role") || "",
          label: field.getAttribute("aria-label") || "",
          placeholder: field.getAttribute("placeholder") || "",
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0,
          excluded: exclude.test(descriptor),
          textish: textish.test(descriptor),
        };
      });
      const usable = candidates.filter((candidate) => candidate.visible && !candidate.excluded);
      usable.sort((a, b) => Number(Boolean(b.textish)) - Number(Boolean(a.textish)));
      const textishHint = /write something|what\\s+on your mind|say something|share something|create post|escrib|publicaci|message|text/i;
      const excludedHint = /post to|media|schedule|collaborator|boost|share to|story|password|search|page url|inbox|chat|messenger|instagram|customize/i;
      const hints = Array.from(document.querySelectorAll("div, span, p, textarea, [role='textbox'], [contenteditable]"))
        .slice(0, 4000)
        .map((el) => {
          const ownText = Array.from(el.childNodes || [])
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(" ")
            .trim();
          const placeholder = el.getAttribute("placeholder") || "";
          const aria = el.getAttribute("aria-label") || "";
          const text = (ownText || placeholder || aria).toLowerCase().replace(/\\s+/g, " ").trim();
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            text: text.slice(0, 80),
            strong: Boolean(placeholder || aria),
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
            visible: rect.width > 0 && rect.height > 0,
          };
        })
        .filter((hint) => hint.visible && hint.text.length >= 3 && hint.text.length <= 90
          && textishHint.test(hint.text) && !excludedHint.test(hint.text));
      return {
        candidates,
        found: usable.length > 0,
        pick: usable[0] || null,
        hints: hints.slice(0, 12),
      };
    })()`;
  }

  function buildFrameMatchScript(childUrl) {
    const child = String(childUrl || "").split("?")[0];
    return `(() => {
      const target = ${JSON.stringify(child)};
      const frames = Array.from(document.querySelectorAll("iframe"));
      const norm = (url) => String(url || "").split("?")[0].replace(/^https?:\\/\\//, "");
      const targetNorm = norm(target);
      const matches = frames.filter((frame) => norm(frame.src) === targetNorm);
      const pick = matches.find((frame) => {
        const rect = frame.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || matches[0];
      if (!pick) return { ok: false };
      const rect = pick.getBoundingClientRect();
      return { ok: true, left: rect.left, top: rect.top, width: rect.width, height: rect.height, src: String(pick.src || "").slice(0, 200) };
    })()`;
  }

  async function absolutePositionFor(tabId, frameId, localX, localY, byId) {
    let offsetX = 0;
    let offsetY = 0;
    let current = byId.get(frameId);
    while (current?.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || !Number.isInteger(parent.contextId)) break;
      const matchResponse = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: buildFrameMatchScript(current.url),
        contextId: parent.contextId,
        returnByValue: true,
      });
      const match = matchResponse?.result?.value;
      if (!match?.ok) break;
      offsetX += match.left;
      offsetY += match.top;
      current = parent;
    }
    return { x: Math.round(localX + offsetX), y: Math.round(localY + offsetY) };
  }

  function walkFrameTree(node, out) {
    if (node?.frame) {
      out.push(node.frame);
      (node.childFrames || []).forEach((child) => walkFrameTree(child, out));
    }
  }

  async function findTextFieldAcrossFrames(_message, sender) {
    const tabId = sender?.tab?.id;
    if (!tabId) return { ok: false, error: "no_tab_id" };
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
      const { frameTree } = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree");
      const frames = [];
      walkFrameTree(frameTree, frames);
      const byId = new Map(frames.map((frame) => [frame.id, frame]));
      const mainOrigin = frames[0]?.securityOrigin || "";
      const errors = [];
      let framesSearched = 0;

      const evaluated = [];
      for (const frame of frames) {
        if (!Number.isInteger(frame.contextId)) continue;
        framesSearched += 1;
        let value = null;
        try {
          const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression: buildFieldSearchScript(),
            contextId: frame.contextId,
            returnByValue: true,
          });
          if (response?.result?.exceptionDetails) {
            errors.push(`frame ${String(frame.id).slice(0, 12)}: ${String(response.result.exceptionDetails.text || "exception")}`);
            continue;
          }
          value = response?.result?.value || null;
        } catch (error) {
          errors.push(`frame ${String(frame.id).slice(0, 12)}: ${error?.message || String(error)}`);
          continue;
        }
        if (value) evaluated.push({ frame, value });
      }

      let field = null;
      const fieldCandidates = evaluated.filter(({ value }) => value?.found && value.pick);
      if (fieldCandidates.length > 0) {
        fieldCandidates.sort((a, b) => {
          const score = (candidate) =>
            (candidate.pick.textish ? 4 : 0) +
            (candidate.pick.tag === "TEXTAREA" ? 2 : 0) +
            (candidate.pick.role === "textbox" ? 1 : 0);
          return score(b) - score(a) || b.pick.height - a.pick.height;
        });
        const best = fieldCandidates[0];
        const absolute = await absolutePositionFor(tabId, best.frame.id, best.pick.x, best.pick.y, byId);
        field = {
          ...best.pick,
          x: absolute.x,
          y: absolute.y,
          frameUrl: best.frame.url,
          crossOrigin: best.frame.securityOrigin !== mainOrigin,
        };
      }

      let hint = null;
      const hintCandidates = evaluated.flatMap(({ frame, value }) =>
        (value?.hints || []).map((candidateHint) => ({ frame, hint: candidateHint })));
      if (hintCandidates.length > 0) {
        hintCandidates.sort((a, b) =>
          Number(Boolean(b.hint.strong)) - Number(Boolean(a.hint.strong)) || b.hint.height - a.hint.height);
        const best = hintCandidates[0];
        const absolute = await absolutePositionFor(tabId, best.frame.id, best.hint.x, best.hint.y, byId);
        hint = {
          ...best.hint,
          x: absolute.x,
          y: absolute.y,
          label: best.hint.text.slice(0, 80),
          frameUrl: best.frame.url,
          crossOrigin: best.frame.securityOrigin !== mainOrigin,
        };
      }

      return {
        ok: true,
        found: Boolean(field),
        framesTotal: frames.length,
        framesSearched,
        errors,
        field,
        hint,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    } finally {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }

  async function getComposerFrameTree(_message, sender) {
    const tabId = sender?.tab?.id;
    if (!tabId) return { ok: false, error: "no_tab_id" };
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
      const { frameTree } = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree");
      const frames = [];
      walkFrameTree(frameTree, frames);
      return {
        ok: true,
        data: {
          frames: frames.map((frame) => ({
            id: String(frame.id).slice(0, 16),
            parentId: frame.parentId ? String(frame.parentId).slice(0, 16) : null,
            url: (frame.url || "").slice(0, 200),
            origin: (frame.securityOrigin || "").slice(0, 80),
            hasContextId: Number.isInteger(frame.contextId),
          })),
        },
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    } finally {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }

  async function captureComposerScreenshot(_message, sender) {
    const tabId = sender?.tab?.id;
    if (!tabId) return { ok: false, error: "no_tab_id" };
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      const { data } = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 60,
      });
      if (!data) return { ok: false, error: "capture_empty" };
      await chrome.storage.local.set({ lastAlphaPageScreenshot: `data:image/jpeg;base64,${data}` });
      return { ok: true, data: { captured: true } };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    } finally {
      try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message?.type === "OPEN_ALPHA_COMPOSER") {
          const result = await openAlphaComposer(message.composerUrl);
          sendResponse({ ok: true, data: result });
          return;
        }
        if (message?.type === "ALPHA_DRAFT_DEBUG") {
          const debug = {
            ...(message.debug || {}),
            at: message.debug?.at || new Date().toISOString(),
          };
          const stored = await chrome.storage.local.get("alphaPageDebugHistory");
          const history = Array.isArray(stored.alphaPageDebugHistory) ? stored.alphaPageDebugHistory : [];
          const detail = {};
          for (const key of ["framesTotal", "framesSearched", "fieldLabel", "hintLabel"]) {
            if (debug[key] !== undefined) detail[key] = debug[key];
          }
          if (Array.isArray(debug.errors) && debug.errors.length > 0) detail.errorCount = debug.errors.length;
          history.unshift({ at: debug.at, stage: debug.stage, reason: debug.reason || "", detail });
          await chrome.storage.local.set({
            lastAlphaPageDraftDebug: debug,
            alphaPageDebugHistory: history.slice(0, 8),
          });
          sendResponse({ ok: true, data: { saved: true } });
          return;
        }
        if (message?.type === "ALPHA_DEBUGGER_UPLOAD") {
          sendResponse({ ok: true, data: await uploadThroughFileChooser(message, _sender) });
          return;
        }
        if (message?.type === "ALPHA_DEBUGGER_CLICK") {
          sendResponse({ ok: true, data: await dispatchTrustedClick(message, _sender) });
          return;
        }
        if (message?.type === "ALPHA_DEBUGGER_FILL_TEXT") {
          sendResponse({ ok: true, data: await fillTextThroughDebugger(message, _sender) });
          return;
        }
        if (message?.type === "ALPHA_DEBUGGER_FIND_TEXT_FIELD") {
          sendResponse({ ok: true, data: await findTextFieldAcrossFrames(message, _sender) });
          return;
        }
        if (message?.type === "ALPHA_DEBUGGER_FRAME_TREE") {
          sendResponse(await getComposerFrameTree(message, _sender));
          return;
        }
        if (message?.type === "ALPHA_DEBUGGER_CAPTURE") {
          sendResponse(await captureComposerScreenshot(message, _sender));
          return;
        }
        if (message?.type === "GET_DEBUG_STATE") {
          sendResponse({ ok: true, data: await getDebugState() });
          return;
        }
        sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
      } catch (error) {
        await saveLastError(error).catch(() => {});
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });
})();
