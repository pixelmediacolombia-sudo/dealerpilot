(function () {
  const $ = (id) => document.getElementById(id);

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message || "no_extension_response" });
      });
    });
  }

  async function currentWindowId() {
    try {
      const tabs = await chrome.tabs?.query?.({ active: true, currentWindow: true });
      const tabWindowId = Number(tabs?.[0]?.windowId);
      if (Number.isInteger(tabWindowId) && tabWindowId >= 0) return tabWindowId;
      const current = await chrome.windows?.getCurrent?.();
      const id = Number(current?.id);
      return Number.isInteger(id) && id >= 0 ? id : null;
    } catch {
      return null;
    }
  }

  async function load() {
    const windowId = await currentWindowId();
    const response = await send({ type: "GET_SETTINGS", windowId });
    if (!response?.ok) {
      $("autoReplyEnabled").checked = true;
      $("diagnostics").textContent = `Settings could not be loaded for window ${windowId ?? "unknown"}. ${response?.error || "Try again."}`;
      return;
    }
    const settings = response.data || {};
    $("backendUrl").value = settings.backendUrl || "https://app.1987dealerpilot.com";
    $("dealerId").value = Number.isInteger(Number(settings.dealerId)) && Number(settings.dealerId) > 0 ? String(Number(settings.dealerId)) : "1";
    $("sessionId").value = settings.sessionId || "";
    $("sellerProfileNames").value = (settings.sellerProfileNames || []).join("\n");
    $("autoReplyEnabled").checked = settings.autoReplyEnabled !== false;

    await loadDebug(windowId);
  }

  function setDebugValue(id, text, className = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `debug-value ${className}`.trim();
  }

  function getSuggestedReply(state = {}) {
    const debug = state.lastMessengerCaptureDebug || {};
    const intake = state.lastConversationIntake || {};
    return String(
      intake.suggestedReply ||
      intake.suggestedReplyPreview ||
      debug.suggestedReply ||
      debug.suggestedReplyPreview ||
      "",
    ).trim();
  }

  async function copySuggestedReply() {
    const text = $("suggested-reply").value.trim();
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      $("suggested-reply").select();
      document.execCommand("copy");
    }
    $("copy-suggested").textContent = "Copied";
    setTimeout(() => {
      $("copy-suggested").textContent = "Copy Suggested Reply";
    }, 1200);
  }

  async function loadDebug(windowId = null) {
    const resolvedWindowId = windowId ?? await currentWindowId();
    const response = await send({ type: "GET_DEBUG_STATE", windowId: resolvedWindowId });
    const state = response.ok ? response.data : {};
    const settings = state.settings || {};
    const debug = state.lastMessengerCaptureDebug || {};
    const intake = state.lastConversationIntake || {};
    const mode = settings.autoReplyEnabled ? "Auto reply enabled" : "Suggest only";

    setDebugValue("dbg-mode", mode, settings.autoReplyEnabled ? "warn" : "ok");
    setDebugValue(
      "dbg-stage",
      debug.stage ? `${debug.stage}${debug.reason ? `: ${debug.reason}` : ""}` : "Never",
      debug.stage === "intake_ok" ? "ok" : debug.reason ? "err" : "",
    );
    setDebugValue(
      "dbg-seller",
      debug.sellerProfileMatched ? `${debug.sellerProfileName || "Matched"} ✓` : debug.sellerProfileName || "Not matched",
      debug.sellerProfileMatched ? "ok" : "err",
    );
    setDebugValue("dbg-buyer", debug.buyerName || intake.buyerName || "—", debug.buyerNameDetected ? "ok" : "");
    if (!debug.sellerProfileMatched && !debug.sellerProfileDetected) {
      setDebugValue("dbg-seller", "Unknown", "warn");
    }
    setDebugValue(
      "dbg-dom",
      [
        `Root ${debug.threadRootDetected ? "Y" : "N"}`,
        `Msg ${debug.messageExtractionMode || "none"}`,
        `Box ${debug.composerDetected ? "Y" : "N"}`,
      ].join(" | "),
      debug.threadRootDetected && debug.messageExtractionMode !== "none" ? "ok" : "",
    );
    const imageCount = debug.imageCandidateCount ?? 0;
    const imageMessageCount = debug.imageMessageCount ?? 0;
    const audioCount = debug.audioCandidateCount ?? 0;
    const audioMessageCount = debug.audioMessageCount ?? 0;
    setDebugValue(
      "dbg-images",
      imageCount
        ? `Cand ${imageCount} | Msg ${imageMessageCount}${debug.latestIsImage ? " | latest" : ""}`
        : "None",
      imageMessageCount ? "warn" : imageCount ? "" : "ok",
    );
    setDebugValue(
      "dbg-audio",
      audioCount
        ? `Cand ${audioCount} | Msg ${audioMessageCount}${debug.latestIsAudio ? " | latest" : ""}`
        : "None",
      audioMessageCount ? "warn" : audioCount ? "" : "ok",
    );
    setDebugValue(
      "dbg-backend",
      debug.backendIntakeReceived ? "Intake OK" : debug.backendIntakeSent ? "Waiting/Error" : "Not sent",
      debug.backendIntakeReceived ? "ok" : debug.backendIntakeSent ? "warn" : "",
    );
    setDebugValue(
      "dbg-send",
      debug.autoSent ? `Sent ${debug.sendMethod || ""}` : debug.reason || "Blocked",
      debug.autoSent ? "ok" : "warn",
    );
    const specificError = debug.rawError || debug.errorData || intake.error || state.lastError || null;
    const specificErrorText =
      debug.reason ||
      intake.error?.message ||
      state.lastError?.message ||
      "None";
    setDebugValue(
      "dbg-error-specific",
      specificErrorText,
      specificErrorText === "None" ? "ok" : "err",
    );
    $("raw-error").textContent = specificError
      ? JSON.stringify(specificError, null, 2)
      : "None";
    const suggestedReply = getSuggestedReply(state);
    $("suggested-reply").value = suggestedReply;
    $("copy-suggested").disabled = !suggestedReply;
    $("diagnostics").textContent = "Debug loaded. Use Show Debug Object for full JSON.";
  }

  async function save() {
    const windowId = await currentWindowId();
    const response = await send({
      type: "SAVE_SETTINGS",
      windowId,
      backendUrl: $("backendUrl").value,
      dealerId: Number($("dealerId").value),
      sessionId: $("sessionId").value.trim(),
      sellerProfileNames: $("sellerProfileNames").value.split(/\r?\n/),
      autoReplyEnabled: $("autoReplyEnabled").checked,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "settings_not_saved");
    }
    $("autoReplyEnabled").checked = response.data?.autoReplyEnabled !== false;
    $("diagnostics").textContent = JSON.stringify(response, null, 2);
    await loadDebug(windowId);
  }

  async function refreshConversation() {
    const button = $("refresh-conversation");
    button.disabled = true;
    button.textContent = "Refreshing conversation…";
    try {
      const response = await send({ type: "REFRESH_ACTIVE_MESSENGER_CONVERSATION" });
      const result = response?.data?.data || response?.data || response;
      if (!response?.ok || result?.ok === false) {
        throw new Error(result?.error || response?.error || "Could not refresh the active conversation.");
      }
      $("diagnostics").textContent = result?.reason
        ? `Conversation refreshed: ${result.reason}.`
        : "Active conversation refreshed.";
      await loadDebug();
    } finally {
      button.disabled = false;
      button.textContent = "Refresh active conversation";
    }
  }

  $("save").addEventListener("click", () => {
    save().catch((err) => {
      $("diagnostics").textContent = String(err?.message || err);
    });
  });

  $("reload-debug").addEventListener("click", () => {
    loadDebug().catch((err) => {
      $("diagnostics").textContent = String(err?.message || err);
    });
  });

  $("refresh-conversation").addEventListener("click", () => {
    refreshConversation().catch((err) => {
      $("diagnostics").textContent = String(err?.message || err);
    });
  });

  $("show-debug").addEventListener("click", async () => {
    const response = await send({ type: "GET_DEBUG_STATE", windowId: await currentWindowId() });
    console.log("[DealerPilot Messenger AI] Debug state:", response);
    $("diagnostics").textContent = JSON.stringify(response, null, 2);
  });

  $("copy-suggested").addEventListener("click", () => {
    copySuggestedReply().catch((err) => {
      $("diagnostics").textContent = String(err?.message || err);
    });
  });

  load().catch((err) => {
    $("diagnostics").textContent = String(err?.message || err);
  });
})();
