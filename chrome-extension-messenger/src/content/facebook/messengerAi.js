(function () {
  const DEFAULT_SETTINGS = Object.freeze({
    dryRun: true,
    autoReplyEnabled: false,
    sellerProfileNames: ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
  });
  const REPLY_QUIET_MS = 7000;
  const OWN_REPLY_GUARD_MS = 120000;

  let captureInFlight = false;
  const lastCaptureHashByThread = new Map();
  const lastAutoSendHashByThread = new Map();
  const pendingBuyerByThread = new Map();
  const lastAutoReplyByThread = new Map();
  const lastSuggestedReplyByThread = new Map();
  let lastDiagnostics = {};

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s*(Enter|Return)\s*,?\s*/i, "")
      .trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { ok: false, error: chrome.runtime.lastError?.message || "no_extension_response" });
      });
    });
  }

  function isFacebookHost(hostname = location.hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "facebook.com" ||
      host.endsWith(".facebook.com");
  }

  function isFacebookMessagesThreadRoute(pathname = location.pathname, hostname = location.hostname) {
    const path = String(pathname || "");
    return isFacebookHost(hostname) &&
      /^\/messages\/t\/[^/?#]+\/?$/i.test(path);
  }

  function getCurrentThreadId(pathname = location.pathname) {
    return globalThis.DealerPilotMessengerAutonomy?.extractThreadId?.(
      pathname,
      location.origin,
    ) || "";
  }

  function safePageUrl() {
    return `${location.origin}${location.pathname}`;
  }

  function normalizeProfileName(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function extractCurrentProfileName(root = document) {
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
        const candidate = cleanText(match?.[1] || "");
        if (candidate && candidate.length <= 80) return candidate;
      }
    }
    return "";
  }

  function validateSellerProfile(root = document, sellerProfileNames = DEFAULT_SETTINGS.sellerProfileNames) {
    const currentProfileName = extractCurrentProfileName(root);
    const current = normalizeProfileName(currentProfileName);
    const expectedProfileNames = sellerProfileNames.length ? sellerProfileNames : DEFAULT_SETTINGS.sellerProfileNames;
    const expected = expectedProfileNames.map(normalizeProfileName).filter(Boolean);
    return {
      currentProfileName,
      expectedProfileNames,
      matched: !!current && expected.includes(current),
    };
  }

  function isReliableBuyerName(name) {
    const cleaned = cleanText(name);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return false;
    if (/^(?:unknown buyer|buyer|facebook|messenger|messages|notifications|settings(?:, help and more)?|open more actions|back to previous page|thread composer|choose an emoji|choose a sticker|choose a gif|compose|chats|aa|unread message|write a message)$/i.test(cleaned)) return false;
    if (/^(?:conversation titled|conversaci[oó]n titulada)\b/i.test(cleaned)) return false;
    if (/\b(?:marketplace|listing|vehicle|facebook|messenger|notifications|settings|group|page|emoji|sticker|gif|compose|chats|message sent)\b/i.test(cleaned)) return false;
    if (/[/$]/.test(cleaned)) return false;
    return true;
  }

  function isUiText(value) {
    return /^(?:messenger|messages|notifications|settings(?:, help and more)?|open more actions|back to previous page|thread composer|choose an emoji|choose a sticker|choose a gif|compose|chats|aa|unread message|write a message|marketplace|see details|more options|send a quick response|tap a response)$/i.test(cleanText(value));
  }

  function activeThreadHeaderDetected(snapshot) {
    if (!globalThis.DealerPilotMessengerAutonomy?.isMessagesThreadRoute?.(location.pathname)) return true;
    const header = cleanText(snapshot?.evidence?.selectedHeaderText || "");
    const buyer = cleanText(snapshot?.buyerName || "");
    if (!header || !buyer || isUiText(header) || isUiText(buyer)) return false;
    const normalizedHeader = normalizeProfileName(header);
    const normalizedBuyer = normalizeProfileName(buyer);
    return normalizedHeader.includes(normalizedBuyer) &&
      (/\b(?:19|20)\d{2}\b/.test(header) ||
        /\b(?:started|inici[oó])\s+(?:this|este)\s+chat\b/i.test(header));
  }

  function isLikelyOwnAiReply(value) {
    const normalized = cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return /^yes\s+(?:-|--)?\s*the car is still available\b/.test(normalized) ||
      /\beasy financing options\b/.test(normalized) ||
      /^i(?:'|’)d be happy to help\b[\s\S]{0,180}\b(?:are you interested|financing)\b/.test(normalized) ||
      /^great\b[\s\S]{0,120}\bbest phone number\b/.test(normalized) ||
      /^perfect\b[\s\S]{0,80}\b(?:we will contact|contact you)\b/.test(normalized) ||
      /^good morning\b[\s\S]{0,120}\b(?:includes vin|all the info)\b/.test(normalized);
  }

  function extractVehicleTitleFromHeader(value) {
    const text = cleanText(value);
    if (!text || !/\b(?:19|20)\d{2}\b/.test(text)) return "";
    const separatorMatch = text.match(/(?:[\u00b7\u2022|]|Â·|â€¢|-)\s*((?:19|20)\d{2}\s+.{2,120})$/i);
    const title = cleanText(separatorMatch?.[1] || text.match(/((?:19|20)\d{2}\s+.{2,120})$/i)?.[1] || "");
    if (!title || /\b(?:marketplace|view buyer|more options|listed on)\b/i.test(title)) return "";
    return title.slice(0, 160);
  }

  function detectListingContext(root = document, evidence = {}) {
    const href = location.href || "";
    const itemMatch = href.match(/https?:\/\/[^/]+\/marketplace\/item\/\d+\/?/i);
    const link = root?.querySelector?.('a[href*="/marketplace/item/"]');
    const listingUrl = itemMatch?.[0] || link?.href || link?.getAttribute?.("href") || "";
    const titleFromSelectedHeader = extractVehicleTitleFromHeader(evidence.selectedHeaderText || "");
    const heading = root?.querySelector?.('[role="heading"], h1, h2, h3');
    const headingText = cleanText(heading?.innerText || heading?.textContent || "");
    const titleFromText = headingText.match(/.{0,80}\b(?:19|20)\d{2}\b.{0,80}/)?.[0] || "";
    return {
      listingUrl: listingUrl ? new URL(listingUrl, location.origin).href : "",
      vehicleTitle: cleanText(titleFromSelectedHeader || titleFromText || headingText).slice(0, 160),
    };
  }

  function normalizeThreadToken(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/https?:\/\/(?:www\.|web\.)?/i, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function firstBuyerMessage(messages = []) {
    return messages.find((message) => message.speaker !== "Dealer")?.text || "";
  }

  function buildThreadRef({ buyerName, vehicleTitle, listingUrl, messages, threadIdentity }) {
    const stableIdentity = normalizeThreadToken(threadIdentity);
    const parts = [
      "marketplace-thread",
      stableIdentity || normalizeThreadToken(listingUrl || location.href),
      normalizeThreadToken(buyerName || "unknown-buyer"),
      normalizeThreadToken(vehicleTitle || "unknown-vehicle"),
      stableIdentity ? "" : normalizeThreadToken(firstBuyerMessage(messages)).slice(0, 40),
    ].filter(Boolean);
    return parts.join("::").slice(0, 240);
  }

  function canonicalMessages(messages) {
    return messages.map((message) => `${message.speaker === "Dealer" ? "Dealer" : "Buyer"}: ${message.text}`);
  }

  function findComposer(root) {
    const candidates = Array.from(
      (root || document).querySelectorAll?.(
        '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label], [contenteditable="true"][data-lexical-editor], textarea[aria-label]',
      ) || [],
    ).filter((box) => {
      const label = `${box.getAttribute?.("aria-label") || ""} ${box.getAttribute?.("aria-placeholder") || ""} ${box.getAttribute?.("placeholder") || ""}`;
      return !/search|buscar|comment|comentario|post|publicaci[oó]n|caption|descripci[oó]n/i.test(label);
    });
    return candidates[0] || null;
  }

  function readComposerText(box) {
    return cleanText(box?.value || box?.innerText || box?.textContent || "");
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertReply(reply, root) {
    const box = findComposer(root);
    if (!box) return { ok: false, reason: "composer_missing", composerDetected: false };
    const existingText = cleanText(readComposerText(box));
    const replacingExistingAiDraft =
      existingText &&
      existingText !== cleanText(reply) &&
      isLikelyOwnAiReply(existingText);
    if (existingText && existingText !== cleanText(reply) && !replacingExistingAiDraft) {
      return { ok: false, reason: "composer_not_empty", composerDetected: true };
    }
    if (existingText && !replacingExistingAiDraft) {
      return {
        ok: true,
        reason: "",
        composerDetected: true,
        composerTextDetected: true,
        reusedExistingDraft: true,
        replacedExistingAiDraft: false,
        box,
      };
    }
    box.focus?.();
    if (box.tagName === "TEXTAREA") {
      setNativeValue(box, reply);
    } else if (document.execCommand) {
      document.execCommand("selectAll", false, undefined);
      document.execCommand("insertText", false, reply);
    } else {
      box.textContent = reply;
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: reply }));
    }
    const composerTextDetected = cleanText(readComposerText(box)) === cleanText(reply);
    return {
      ok: composerTextDetected,
      reason: composerTextDetected ? "" : "composer_insert_unconfirmed",
      composerDetected: true,
      composerTextDetected,
      reusedExistingDraft: false,
      replacedExistingAiDraft: replacingExistingAiDraft === true,
      box,
    };
  }

  function elementIsVisibleAndEnabled(element) {
    if (!element || element.isConnected === false || element.disabled === true) return false;
    if (String(element.getAttribute?.("aria-disabled") || "").toLowerCase() === "true") return false;
    const rect = element.getBoundingClientRect?.();
    if (rect && (Number(rect.width) <= 0 || Number(rect.height) <= 0)) return false;
    const style = globalThis.getComputedStyle?.(element);
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
      return false;
    }
    return true;
  }

  function distanceBetweenElements(first, second) {
    const firstRect = first?.getBoundingClientRect?.();
    const secondRect = second?.getBoundingClientRect?.();
    if (!firstRect || !secondRect) return Number.POSITIVE_INFINITY;
    const firstCenterX = Number(firstRect.left) + Number(firstRect.width) / 2;
    const firstCenterY = Number(firstRect.top) + Number(firstRect.height) / 2;
    const secondCenterX = Number(secondRect.left) + Number(secondRect.width) / 2;
    const secondCenterY = Number(secondRect.top) + Number(secondRect.height) / 2;
    return Math.abs(firstCenterX - secondCenterX) + Math.abs(firstCenterY - secondCenterY);
  }

  function findSendButton(root, box = null) {
    const buttons = Array.from(
      (root || document).querySelectorAll?.(
        '[aria-label*="send" i], [aria-label*="enviar" i], [data-testid*="send" i]',
      ) || [],
    );
    const candidates = buttons.filter((button) => {
      const text = cleanText(button.innerText || button.textContent || button.getAttribute?.("aria-label") || "");
      return elementIsVisibleAndEnabled(button) &&
        !/quick response|respuesta rápida|tap a response|availability|disponible/i.test(text);
    });
    if (!box || candidates.length < 2) return candidates[0] || null;
    return candidates
      .map((button, index) => ({ button, index, distance: distanceBetweenElements(button, box) }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)[0]?.button || null;
  }

  async function clickSend(box, root) {
    await sleep(250);
    const sendButton = findSendButton(root, box);
    if (sendButton) {
      sendButton.focus?.();
      if (typeof sendButton.click === "function") {
        sendButton.click();
        return { ok: true, method: "button_click" };
      }
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return { ok: true, method: "button_event" };
    }
    if (!box) return { ok: false, method: "none" };
    box.focus?.();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    return { ok: true, method: "enter" };
  }

  function deliveryIsVisible(reply, messages = []) {
    const expected = cleanText(reply);
    return messages.some((message) => message.speaker === "Dealer" && cleanText(message.text) === expected);
  }

  function snapshotStillActionable(snapshot, payload, settings = DEFAULT_SETTINGS, expectedReply = "") {
    if (!snapshot?.root) return { ok: false, reason: "thread_root_missing" };
    if (snapshot.root.isConnected === false) return { ok: false, reason: "thread_root_detached" };
    if (!isReliableBuyerName(snapshot.buyerName)) return { ok: false, reason: "buyer_name_untrusted" };
    const liveCapture = globalThis.DealerPilotMessengerCapture?.captureFromRoot?.(
      snapshot.root,
      settings.sellerProfileNames,
      document,
    );
    const liveMessages = Array.isArray(liveCapture?.messages) ? liveCapture.messages : snapshot.messages;
    const liveLastMessage = liveMessages[liveMessages.length - 1] || snapshot.lastMessage;
    if (liveLastMessage?.speaker === "Dealer") return { ok: false, reason: "latest_message_not_buyer" };
    const latestText = cleanText(liveLastMessage?.text || "");
    if (!latestText || isUiText(latestText) || isLikelyOwnAiReply(latestText)) {
      return { ok: false, reason: "buyer_message_untrusted" };
    }
    if (payload?.currentMessage && latestText !== cleanText(payload.currentMessage)) {
      return { ok: false, reason: "buyer_message_changed" };
    }
    const composer = findComposer(snapshot.root);
    if (!composer) return { ok: false, reason: "composer_missing" };
    const composerText = cleanText(readComposerText(composer));
    if (
      composerText &&
      composerText !== cleanText(expectedReply) &&
      !isLikelyOwnAiReply(composerText)
    ) {
      return { ok: false, reason: "composer_not_empty" };
    }
    return { ok: true, reason: "" };
  }

  async function sendDebug(stage, details = {}) {
    lastDiagnostics = {
      at: new Date().toISOString(),
      stage,
      sourceUrl: safePageUrl(),
      ...details,
    };
    await send({ type: "MESSENGER_CAPTURE_DEBUG", debug: lastDiagnostics }).catch(() => {});
    return lastDiagnostics;
  }

  function getSettingsFromResponse(response) {
    return {
      ...DEFAULT_SETTINGS,
      ...(response?.ok ? response.data : {}),
    };
  }

  async function getSettings() {
    return getSettingsFromResponse(await send({ type: "GET_SETTINGS" }));
  }

  function createCaptureSnapshot(settings = DEFAULT_SETTINGS) {
    const captureApi = globalThis.DealerPilotMessengerCapture;
    const capture = captureApi?.capture?.({
      document,
      location,
      sellerNameCandidates: settings.sellerProfileNames,
    }) || {
      root: null,
      scope: null,
      buyerName: "",
      messages: [],
      evidence: {
        threadRootDetected: false,
        messageScopeDetected: false,
        extractionMode: "none",
      },
    };
    const context = detectListingContext(capture.root || document, capture.evidence || {});
    const sellerProfile = validateSellerProfile(document, settings.sellerProfileNames);
    const messages = Array.isArray(capture.messages) ? capture.messages : [];
    const lastMessage = messages[messages.length - 1] || null;
    const buyerMessageDetected = !!lastMessage && lastMessage.speaker !== "Dealer";
    const evidence = {
      ...(capture.evidence || {}),
      sellerProfileName: sellerProfile.currentProfileName,
      sellerProfileMatched: sellerProfile.matched,
      latestMessageDirection: lastMessage?.speaker === "Dealer" ? "dealer" : buyerMessageDetected ? "buyer" : "none",
      composerDetected: !!findComposer(capture.root),
    };
    return {
      ...capture,
      context,
      sellerProfile,
      messages,
      lastMessage,
      buyerMessageDetected,
      evidence,
    };
  }

  function createCaptureSnapshots(settings = DEFAULT_SETTINGS) {
    const captureApi = globalThis.DealerPilotMessengerCapture;
    if (!captureApi?.captureAll) return [createCaptureSnapshot(settings)];
    const captures = captureApi.captureAll({
      document,
      location,
      sellerNameCandidates: settings.sellerProfileNames,
    });
    return captures.map((capture) => {
      const context = detectListingContext(capture.root || document, capture.evidence || {});
      const sellerProfile = validateSellerProfile(document, settings.sellerProfileNames);
      const messages = Array.isArray(capture.messages) ? capture.messages : [];
      const lastMessage = messages[messages.length - 1] || null;
      const buyerMessageDetected = !!lastMessage && lastMessage.speaker !== "Dealer";
      const evidence = {
        ...(capture.evidence || {}),
        sellerProfileName: sellerProfile.currentProfileName,
        sellerProfileMatched: sellerProfile.matched,
        latestMessageDirection: lastMessage?.speaker === "Dealer" ? "dealer" : buyerMessageDetected ? "buyer" : "none",
        composerDetected: !!findComposer(capture.root),
      };
      return {
        ...capture,
        context,
        sellerProfile,
        messages,
        lastMessage,
        buyerMessageDetected,
        evidence,
      };
    });
  }

  function validateSnapshot(snapshot) {
    const routeAllowed = isFacebookMessagesThreadRoute();
    const conversationThreadDetected = snapshot.evidence.threadRootDetected === true;
    const buyerNameDetected = isReliableBuyerName(snapshot.buyerName);
    const activeHeaderDetected = activeThreadHeaderDetected(snapshot);
    const marketplaceContextDetected =
      !!snapshot.context.listingUrl ||
      /\/marketplace\//i.test(location.pathname || "") ||
      /\bmarketplace\b/i.test(cleanText(snapshot.root?.getAttribute?.("aria-label") || ""));
    const sellerProfileDetected = !!cleanText(snapshot.sellerProfile.currentProfileName);
    const sellerIsCurrentUser = sellerProfileDetected ? snapshot.sellerProfile.matched === true : true;
    const missing = [
      routeAllowed ? null : "route_not_allowed",
      conversationThreadDetected ? null : "conversation_thread_missing",
      snapshot.buyerMessageDetected ? null : "buyer_message_missing",
      buyerNameDetected ? null : "buyer_name_missing",
      activeHeaderDetected ? null : "active_thread_header_missing",
      sellerIsCurrentUser ? null : "seller_profile_mismatch",
      marketplaceContextDetected ? null : "marketplace_context_missing",
    ].filter(Boolean);
    return {
      ok: missing.length === 0,
      missing,
      routeAllowed,
      conversationThreadDetected,
      buyerMessageDetected: snapshot.buyerMessageDetected,
      buyerNameDetected,
      activeThreadHeaderDetected: activeHeaderDetected,
      sellerProfileDetected,
      sellerIsCurrentUser,
      marketplaceContextDetected,
    };
  }

  function scoreSnapshot(snapshot) {
    const validation = validateSnapshot(snapshot);
    const evidence = snapshot.evidence || {};
    const rect = evidence.selectedRootRect || {};
    const area = Math.max(0, Number(rect.width) || 0) * Math.max(0, Number(rect.height) || 0);
    const header = cleanText(evidence.selectedHeaderText || "");
    const buyerName = cleanText(snapshot.buyerName || "");
    const currentMessage = cleanText(snapshot.lastMessage?.text || "");
    let score = 0;

    if (validation.ok) score += 1000;
    score -= validation.missing.length * 140;
    if (validation.conversationThreadDetected) score += 120;
    if (validation.buyerNameDetected) score += 180;
    if (validation.buyerMessageDetected) score += 220;
    if (evidence.messageScopeDetected === true) score += 80;
    if (evidence.composerDetected === true) score += 90;
    if (header) score += 100;
    if (/(?:[\u00b7\u2022|]|Â·|â€¢)\s*(?:\$?\d|19\d{2}|20\d{2}|Marketplace\b)/i.test(header)) score += 160;
    if (evidence.latestMessageDirection === "buyer") score += 180;
    if (snapshot.messages.length > 0) score += Math.min(snapshot.messages.length, 6) * 20;
    if (snapshot.context?.listingUrl) score += 60;
    if (snapshot.context?.vehicleTitle) score += 40;
    if (area >= 60000) score += 60;
    if (area > 0 && area < 60000) score -= 180;
    if (isUiText(buyerName)) score -= 700;
    if (isUiText(currentMessage)) score -= 500;
    if (!validation.activeThreadHeaderDetected) score -= 900;
    if (/^(?:settings|messenger|messages|notifications|chats)\b/i.test(buyerName)) score -= 1000;
    if (!header) score -= 120;
    if (!buyerName) score -= 180;
    if (!currentMessage) score -= 220;
    if (isLikelyOwnAiReply(buyerName) || isLikelyOwnAiReply(currentMessage)) score -= 800;

    return {
      score,
      validation,
      reasons: validation.missing,
    };
  }

  function selectWinningSnapshot(snapshots = []) {
    const ranked = snapshots
      .map((snapshot, index) => ({ snapshot, index, ...scoreSnapshot(snapshot) }))
      .sort((left, right) => {
        const diff = right.score - left.score;
        if (diff) return diff;
        return left.index - right.index;
      });
    return ranked[0] || null;
  }

  function buildIntakePayload(snapshot, validation, detectedAtMs = Date.now()) {
    const messages = snapshot.messages;
    const currentMessage = cleanText(snapshot.lastMessage?.text || "");
    const externalThreadRef = buildThreadRef({
      buyerName: snapshot.buyerName,
      vehicleTitle: snapshot.context.vehicleTitle,
      listingUrl: snapshot.context.listingUrl || location.href,
      messages,
      threadIdentity: getCurrentThreadId()
        ? `facebook-messages-thread-${getCurrentThreadId()}`
        : snapshot.evidence.threadIdentity,
    });
    const visibleMessages = canonicalMessages(messages);
    const captureHash = JSON.stringify({
      thread: externalThreadRef,
      currentMessage,
      visibleMessages,
    });
    return {
      externalThreadRef,
      sourceUrl: location.href,
      buyerName: snapshot.buyerName || undefined,
      dealerId: 1,
      messageDetectedAt: new Date(detectedAtMs).toISOString(),
      routeAllowed: validation.routeAllowed,
      conversationThreadDetected: validation.conversationThreadDetected,
      buyerMessageDetected: validation.buyerMessageDetected,
      buyerNameDetected: validation.buyerNameDetected,
      sellerIsCurrentUser: validation.sellerIsCurrentUser,
      marketplaceContextDetected: validation.marketplaceContextDetected,
      currentMessage,
      visibleMessages,
      chatText: visibleMessages.join("\n").slice(-4000),
      detectedVehicleTitle: snapshot.context.vehicleTitle || undefined,
      detectedMarketplaceListingUrl: snapshot.context.listingUrl || undefined,
      messageHash: captureHash,
      idempotencyKey: captureHash,
    };
  }

  function extractSuggestedReply(response) {
    return response?.data?.suggestedReply || response?.data?.data?.suggestedReply || "";
  }

  async function maybeSendReply(reply, payload, snapshot, threadKey, settings = DEFAULT_SETTINGS) {
    if (!reply || payload.messageHash === lastAutoSendHashByThread.get(threadKey)) {
      return { autoSent: false, reason: "reply_or_capture_not_actionable" };
    }
    const actionable = snapshotStillActionable(snapshot, payload, settings, reply);
    if (!actionable.ok) {
      return { autoSent: false, reason: actionable.reason };
    }
    const inserted = insertReply(reply, snapshot.root);
    if (!inserted.ok) {
      return { autoSent: false, reason: inserted.reason, ...inserted };
    }
    const sendResult = await clickSend(inserted.box, snapshot.root);
    if (!sendResult.ok) {
      return { autoSent: false, reason: "send_dispatch_failed", sendMethod: sendResult.method };
    }
    await sleep(900);
    const liveCapture = globalThis.DealerPilotMessengerCapture?.captureFromRoot?.(
      snapshot.root,
      settings.sellerProfileNames,
      document,
    );
    const liveComposer = findComposer(snapshot.root) || inserted.box;
    const liveMessages = Array.isArray(liveCapture?.messages) ? liveCapture.messages : snapshot.messages;
    const delivered = !readComposerText(liveComposer) || deliveryIsVisible(reply, liveMessages);
    if (!delivered) {
      return {
        autoSent: false,
        reason: "delivery_unconfirmed",
        composerDetected: true,
        composerTextDetected: true,
        composerDraftReused: inserted.reusedExistingDraft === true,
        composerDraftReplaced: inserted.replacedExistingAiDraft === true,
        sendMethod: sendResult.method,
        deliveryConfirmed: false,
      };
    }
    lastAutoSendHashByThread.set(threadKey, payload.messageHash);
    lastAutoReplyByThread.set(threadKey, {
      text: cleanText(reply),
      at: Date.now(),
    });
    return {
      autoSent: true,
      reason: "",
      composerDetected: true,
      composerTextDetected: true,
      composerDraftReused: inserted.reusedExistingDraft === true,
      composerDraftReplaced: inserted.replacedExistingAiDraft === true,
      sendMethod: sendResult.method,
      deliveryConfirmed: true,
    };
  }

  function buildBuyersState(snapshots = [], winnerIndex = -1) {
    return snapshots.map((snapshot) => ({
      buyerName: snapshot.buyerName || "",
      messageCount: snapshot.messages.length,
      latestMessageDirection: snapshot.evidence.latestMessageDirection || "none",
      selectedHeaderText: snapshot.evidence.selectedHeaderText || "",
      threadRootDetected: snapshot.evidence.threadRootDetected === true,
      messageScopeDetected: snapshot.evidence.messageScopeDetected === true,
      composerDetected: snapshot.evidence.composerDetected === true,
      vehicleTitle: snapshot.context?.vehicleTitle || "",
      marketplaceUrl: snapshot.context?.listingUrl || "",
      confidenceScore: scoreSnapshot(snapshot).score,
      selectedForProcessing: snapshots.indexOf(snapshot) === winnerIndex,
    }));
  }

  function buildDebugBase({ automatic, settings, snapshot, validation, snapshots, winnerIndex }) {
    return {
      automatic,
      dryRun: settings.dryRun === true,
      autoReplyEnabled: settings.autoReplyEnabled === true,
      activeConversationCount: snapshots.length,
      buyersDetected: buildBuyersState(snapshots, winnerIndex),
      selectedConversationIndex: winnerIndex,
      selectedConversationScore: scoreSnapshot(snapshot).score,
      messageCount: snapshot.messages.length,
      buyerName: snapshot.buyerName || "",
      buyerNameDetected: validation.buyerNameDetected,
      threadRootDetected: snapshot.evidence.threadRootDetected === true,
      messageScopeDetected: snapshot.evidence.messageScopeDetected === true,
      messageExtractionMode: snapshot.evidence.extractionMode || "none",
      latestMessageDirection: snapshot.evidence.latestMessageDirection || "none",
      selectedHeaderText: snapshot.evidence.selectedHeaderText || "",
      selectedRootTextPreview: snapshot.evidence.selectedRootTextPreview || "",
      selectedRootRect: snapshot.evidence.selectedRootRect || null,
      selectedScopeRect: snapshot.evidence.selectedScopeRect || null,
      sellerProfileName: snapshot.sellerProfile.currentProfileName || "",
      sellerProfileMatched: snapshot.sellerProfile.matched === true,
      sellerProfileDetected: validation.sellerProfileDetected === true,
      composerDetected: snapshot.evidence.composerDetected === true,
      vehicleTitle: snapshot.context.vehicleTitle || "",
      marketplaceUrl: snapshot.context.listingUrl || "",
      threadId: getCurrentThreadId() || null,
      autonomy: globalThis.__dealerPilotMessengerAutonomyController?.getState?.() || null,
    };
  }

  async function processSnapshot({ automatic, detectedAtMs, settings, snapshot, snapshots, winnerIndex }) {
    const validation = validateSnapshot(snapshot);
    const debug = buildDebugBase({ automatic, settings, snapshot, validation, snapshots, winnerIndex });

    if (!validation.ok) {
      const reason = validation.missing[0] || "invalid_sales_context";
      await sendDebug("blocked", { ...debug, reason, validationGates: validation });
      return { skipped: true, reason, validation, debug };
    }

    const payload = buildIntakePayload(snapshot, validation, detectedAtMs);
    const threadKey = payload.externalThreadRef;
    const latestText = cleanText(snapshot.lastMessage?.text || "");
    const lastAutoReply = lastAutoReplyByThread.get(threadKey) || {};
    const recentlySentOwnReply =
      !!latestText &&
      latestText === lastAutoReply.text &&
      Date.now() - lastAutoReply.at < OWN_REPLY_GUARD_MS;
    if (recentlySentOwnReply) {
      await sendDebug("blocked", { ...debug, reason: "own_reply_guard" });
      return { skipped: true, reason: "own_reply_guard" };
    }

    if (automatic) {
      if (payload.messageHash === lastAutoSendHashByThread.get(threadKey)) {
        await sendDebug("blocked", { ...debug, reason: "duplicate_auto_send_hash" });
        return { skipped: true, reason: "duplicate_auto_send_hash" };
      }
      const now = Date.now();
      const pending = pendingBuyerByThread.get(threadKey) || {};
      if (payload.messageHash !== pending.hash) {
        pendingBuyerByThread.set(threadKey, {
          hash: payload.messageHash,
          since: now,
          detectedAt: detectedAtMs,
        });
        await sendDebug("waiting_quiet_window", debug);
        return { skipped: true, reason: "waiting_quiet_window" };
      }
      if (now - pending.since < REPLY_QUIET_MS) {
        await sendDebug("waiting_quiet_window", debug);
        return { skipped: true, reason: "waiting_quiet_window" };
      }
      payload.messageDetectedAt = new Date(pending.detectedAt || detectedAtMs).toISOString();
    }

    if (settings.dryRun) {
      lastCaptureHashByThread.set(threadKey, payload.messageHash);
      await sendDebug("dry_run_capture", {
        ...debug,
        backendIntakeSent: false,
        backendIntakeReceived: false,
        reason: "dry_run_enabled",
        payloadPreview: {
          externalThreadRef: payload.externalThreadRef,
          buyerName: payload.buyerName,
          currentMessage: payload.currentMessage,
        },
      });
      return { ok: true, dryRun: true, payload };
    }

    await sendDebug("intake_sending", {
      ...debug,
      backendIntakeSent: false,
      backendIntakeReceived: false,
    });
    const response = await send({ type: "CONVERSATION_INTAKE", ...payload });
    if (!response?.ok) {
      const errorDetails = {
        message: response?.error || "no_extension_response",
        status: response?.status || null,
        data: response?.data || null,
        raw: response || null,
      };
      await sendDebug("intake_failed", {
        ...debug,
        backendIntakeSent: true,
        backendIntakeReceived: false,
        reason: errorDetails.message,
        errorStatus: errorDetails.status,
        errorData: errorDetails.data,
        rawError: errorDetails.raw,
      });
      return { ok: false, error: errorDetails.message, errorDetails };
    }
    if (response.data?.skipped) {
      lastCaptureHashByThread.set(threadKey, payload.messageHash);
      await sendDebug("intake_skipped", {
        ...debug,
        backendIntakeSent: true,
        backendIntakeReceived: true,
        reason: response.data.reason || "backend_skipped",
      });
      return { skipped: true, reason: response.data.reason || "backend_skipped" };
    }

    lastCaptureHashByThread.set(threadKey, payload.messageHash);
    pendingBuyerByThread.delete(threadKey);
    const lastSuggestedReply = extractSuggestedReply(response);
    lastSuggestedReplyByThread.set(threadKey, lastSuggestedReply);

    if (!settings.autoReplyEnabled) {
      await sendDebug("auto_send_blocked", {
        ...debug,
        aiReplyReceived: !!lastSuggestedReply,
        backendIntakeSent: true,
        backendIntakeReceived: true,
        autoSent: false,
        reason: "auto_reply_disabled",
      });
      return { ok: true, suggestedReply: lastSuggestedReply, autoSent: false, reason: "auto_reply_disabled" };
    }

    const sendResult = await maybeSendReply(lastSuggestedReply, payload, snapshot, threadKey, settings);
    await sendDebug(sendResult.autoSent ? "intake_ok" : "auto_send_blocked", {
      ...debug,
      ...sendResult,
      aiReplyReceived: !!lastSuggestedReply,
      backendIntakeSent: true,
      backendIntakeReceived: true,
    });
    return { ok: true, suggestedReply: lastSuggestedReply, ...sendResult };
  }

  async function captureConversationOnce(options = {}) {
    const automatic = options.automatic !== false;
    const detectedAtMs = Date.now();
    if (options.expectedThreadId && getCurrentThreadId() !== options.expectedThreadId) {
      return {
        skipped: true,
        reason: "thread_route_mismatch",
        expectedThreadId: options.expectedThreadId,
        currentThreadId: getCurrentThreadId() || null,
      };
    }
    const settings = await getSettings();
    const snapshots = createCaptureSnapshots(settings);
    const winning = selectWinningSnapshot(snapshots);
    if (!winning) {
      return {
        skipped: true,
        reason: "conversation_snapshot_missing",
        conversationCount: 0,
        buyersDetected: [],
        results: [],
      };
    }
    const result = await processSnapshot({
      automatic,
      detectedAtMs,
      settings,
      snapshot: winning.snapshot,
      snapshots,
      winnerIndex: winning.index,
    });
    return {
      ...result,
      conversationCount: snapshots.length,
      buyersDetected: buildBuyersState(snapshots, winning.index),
      winnerScore: winning.score,
      results: [result],
    };
  }

  async function captureConversation(options = {}) {
    if (captureInFlight) return { skipped: true, reason: "capture_in_flight" };
    captureInFlight = true;
    try {
      return await captureConversationOnce(options);
    } finally {
      captureInFlight = false;
    }
  }

  function start() {
    if (!isFacebookMessagesThreadRoute()) return;
    getSettings().then((settings) => {
      globalThis.DealerPilotMessengerAutonomy.start({
        processThread: captureConversation,
        sellerProfileNames: settings.sellerProfileNames,
      });
    }).catch(console.warn);
  }

  globalThis.DealerPilotMessengerAi = Object.freeze({
    buildIntakePayload,
    captureConversation,
    cleanText,
    createCaptureSnapshot,
    findComposer,
    getCurrentThreadId,
    getLastDiagnostics: () => lastDiagnostics,
    insertReply,
    isFacebookMessagesThreadRoute,
    selectWinningSnapshot,
    validateSellerProfile,
    validateSnapshot,
    _state: () => ({
      lastCaptureHashByThread: Object.fromEntries(lastCaptureHashByThread),
      lastAutoSendHashByThread: Object.fromEntries(lastAutoSendHashByThread),
      pendingBuyerByThread: Object.fromEntries(pendingBuyerByThread),
      lastSuggestedReplyByThread: Object.fromEntries(lastSuggestedReplyByThread),
    }),
  });

  if (!globalThis.__DEALERPILOT_MESSENGER_AI_TEST__) {
    start();
  }
})();
