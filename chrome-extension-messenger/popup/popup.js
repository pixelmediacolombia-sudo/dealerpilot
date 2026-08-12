(function () {
  const $ = (id) => document.getElementById(id);

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message || "no_extension_response" });
      });
    });
  }

  async function load() {
    const response = await send({ type: "GET_SETTINGS" });
    const settings = response.ok ? response.data : {};
    $("backendUrl").value = settings.backendUrl || "https://1987dealerpilot.com";
    $("dealerId").value = Number.isInteger(Number(settings.dealerId)) && Number(settings.dealerId) > 0 ? String(Number(settings.dealerId)) : "1";
    $("sessionId").value = settings.sessionId || "";
    $("sellerProfileNames").value = (settings.sellerProfileNames || []).join("\n");
    $("dryRun").checked = settings.dryRun !== false;
    $("autoReplyEnabled").checked = settings.autoReplyEnabled === true;

    await loadDebug();
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

  async function loadDebug() {
    const response = await send({ type: "GET_DEBUG_STATE" });
    const state = response.ok ? response.data : {};
    const settings = state.settings || {};
    const debug = state.lastMessengerCaptureDebug || {};
    const intake = state.lastConversationIntake || {};
    const mode = settings.dryRun
      ? "Dry run"
      : settings.autoReplyEnabled
        ? "Auto reply enabled"
        : "Suggest only";

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
    setDebugValue(
      "dbg-images",
      imageCount
        ? `Cand ${imageCount} | Msg ${imageMessageCount}${debug.latestIsImage ? " | latest" : ""}`
        : "None",
      imageMessageCount ? "warn" : imageCount ? "" : "ok",
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
    const response = await send({
      type: "SAVE_SETTINGS",
      backendUrl: $("backendUrl").value,
      dealerId: Number($("dealerId").value),
      sessionId: $("sessionId").value.trim(),
      sellerProfileNames: $("sellerProfileNames").value.split(/\r?\n/),
      dryRun: $("dryRun").checked,
      autoReplyEnabled: $("autoReplyEnabled").checked,
    });
    $("diagnostics").textContent = JSON.stringify(response, null, 2);
    await loadDebug();
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

  $("show-debug").addEventListener("click", async () => {
    const response = await send({ type: "GET_DEBUG_STATE" });
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
