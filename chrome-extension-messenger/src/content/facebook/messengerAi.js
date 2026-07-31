(function () {
  const DEFAULT_SETTINGS = Object.freeze({
    dryRun: true,
    autoReplyEnabled: false,
    sellerProfileNames: ["Alpha Manassas", "Alpha Motorsport", "Andres Ibanez"],
  });
  const REPLY_QUIET_MS = 7000;
  const OWN_REPLY_GUARD_MS = 120000;
  const SEND_EVIDENCE_TIMEOUT_MS = 8000;
  const SEND_EVIDENCE_INTERVAL_MS = 300;
  const DEFAULT_STORE_PHONE = "+1 703-763-4675";

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
    return /^(?:messenger|messages|notifications|settings(?:, help and more)?|open more actions|back to previous page|thread composer|choose an emoji|choose a sticker|choose a gif|compose|chats|aa|unread message|write a message|marketplace|see details|more options|send a quick response|tap a response|message sent|mensaje enviado|joined facebook(?: in \d{4})?|se uni[oó] a facebook(?: en \d{4})?)$/i.test(cleanText(value));
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

  function marketplaceHeaderContextDetected(snapshot) {
    if (!globalThis.DealerPilotMessengerAutonomy?.isMessagesThreadRoute?.(location.pathname)) return false;
    if (!activeThreadHeaderDetected(snapshot)) return false;
    const header = cleanText(snapshot?.evidence?.selectedHeaderText || "");
    const vehicleTitle = cleanText(snapshot?.context?.vehicleTitle || "");
    return /\b(?:19|20)\d{2}\b/.test(header) && /\b(?:19|20)\d{2}\b/.test(vehicleTitle || header);
  }

  function isLikelyOwnAiReply(value) {
    const normalized = cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return /^yes\s+(?:-|--)?\s*the car is still available\b/.test(normalized) ||
      /\beasy financing options\b/.test(normalized) ||
      /^we don'?t handle ratings here\b/.test(normalized) ||
      /\b(?:id|tax id|passport|pasaporte).{0,120}\b(?:bank account|cuenta bancaria|cuenta de banco)\b/.test(normalized) ||
      /\ban advisor can confirm\b/.test(normalized) ||
      /\byou can discuss that with an advisor\b/.test(normalized) ||
      /\beso lo puedes discutir con un asesor\b/.test(normalized) ||
      /\bnuestro equipo puede darte la informacion correspondiente\b/.test(normalized) ||
      /\bour team can provide the corresponding information\b/.test(normalized) ||
      /^sorry to hear that\b[\s\S]{0,220}\bbest phone number\b/.test(normalized) ||
      /^sorry to hear that\b[\s\S]{0,220}\bfinance team can help\b/.test(normalized) ||
      /\bwhat'?s the best phone number\b[\s\S]{0,160}\b(?:finance team|advisor|contact|reach you|help)\b/.test(normalized) ||
      /^i(?:'|’)d be happy to help\b[\s\S]{0,180}\b(?:are you interested|financing)\b/.test(normalized) ||
      /^great\b[\s\S]{0,120}\bbest phone number\b/.test(normalized) ||
      /^perfect\b[\s\S]{0,80}\b(?:we will contact|contact you)\b/.test(normalized) ||
      /^good morning\b[\s\S]{0,120}\b(?:includes vin|all the info)\b/.test(normalized);
  }

  function isRequirementsInquiry(value) {
    const normalized = cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return /\b(?:q|que|what).{0,40}(?:necesit|need|required|requisit|document).{0,120}(?:aplicar|apply|application)?/.test(normalized) ||
      /\b(?:requisitos?|requirements?|documentos?|documents?).{0,120}(?:aplicar|apply|application|financ)/.test(normalized);
  }

  function normalizeLanguageText(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function detectLikelyLanguage(value) {
    const raw = cleanText(value).toLowerCase();
    const normalized = normalizeLanguageText(value);
    if (!normalized) return "unknown";
    if (/[¿¡ñáéíóúü]/i.test(raw)) return "es";

    const spanishTokens = normalized.match(/\b(?:esa|ese|eso|esta|este|tiene|tienen|techo|panoramico|precio|cuanto|cual|donde|cuando|puedo|quisiera|busco|necesito|aplicar|requisitos|documentos|pasaporte|cuenta|bancaria|hola|buenas|gracias|financiar|financiamiento|carro|vehiculo|asesor|numero|telefono)\b/g) || [];
    const englishTokens = normalized.match(/\b(?:this|that|does|have|has|roof|panoramic|price|cash|what|where|when|could|would|need|apply|requirements|documents|passport|bank|account|hello|thanks|financing|car|vehicle|advisor|number|phone|reach|you|your)\b/g) || [];
    if (spanishTokens.length >= 2 && spanishTokens.length > englishTokens.length) return "es";
    if (englishTokens.length >= 2 && englishTokens.length > spanishTokens.length) return "en";
    return "unknown";
  }

  function isTerminalAcknowledgement(value) {
    const normalized = normalizeLanguageText(value)
      .replace(/[.,!?;:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return /^(?:(?:ok|okay|perfecto|listo|esta bien|todo bien)\s+)?(?:gracias|muchas gracias)$/.test(normalized) ||
      /^(?:(?:ok|okay|perfect|got it|all right)\s+)?(?:thanks|thank you)$/.test(normalized);
  }

  function isFacebookRatingCard(value) {
    const normalized = normalizeLanguageText(value);
    return /\byou can now rate each other\b/.test(normalized) ||
      /\bpeople may rate one another\b/.test(normalized) ||
      /\brate [\p{L}][\p{L}\s.'’\-]{1,80}$/u.test(normalized);
  }

  function replyMirrorsBuyerLanguage(reply, currentMessage) {
    const buyerLanguage = detectLikelyLanguage(currentMessage);
    const replyLanguage = detectLikelyLanguage(reply);
    return buyerLanguage === "unknown" || replyLanguage === "unknown" || buyerLanguage === replyLanguage;
  }

  function replyRepeatsConversation(reply, messages, currentMessage) {
    const normalizedReply = normalizeLanguageText(reply);
    if (!normalizedReply || normalizedReply.length < 4) return false;
    if (messages.some((message) => normalizeLanguageText(message.text) === normalizedReply)) return true;
    const normalizedCurrent = normalizeLanguageText(currentMessage);
    return !!normalizedCurrent &&
      normalizedCurrent.length >= 15 &&
      normalizedReply.includes(normalizedCurrent);
  }

  function requirementsReplyFor(value) {
    const normalized = cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const spanish = /\b(?:q|que|necesit|aplicar|requisit|documentos?|pasaporte|cuenta bancaria|cuenta de banco)\b/.test(normalized);
    return spanish
      ? `Solo necesitas tu ID y una cuenta bancaria activa; puede ser pasaporte o Tax ID. ¿Cuál es el mejor número de teléfono para ayudarte con la aplicación? También puedes llamarnos al ${DEFAULT_STORE_PHONE}.`
      : `You only need your ID and an active bank account; a passport or Tax ID works. What's the best phone number to help with the application? You can also call us at ${DEFAULT_STORE_PHONE}.`;
  }

  function repairSuggestedReplyForBuyerIntent(reply, payload) {
    if (isRequirementsInquiry(payload?.currentMessage || "")) {
      return requirementsReplyFor(payload.currentMessage);
    }
    return reply;
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
    return {
      ok: true,
      reason: "",
      composerDetected: true,
      composerTextDetected: false,
      reusedExistingDraft: false,
      replacedExistingAiDraft: replacingExistingAiDraft === true,
      needsWrite: true,
      box,
    };
  }

  async function sendThroughComposer(box, replyText, needsWrite) {
    if (!box) return { ok: false, method: "none", reason: "composer_missing" };
    box.scrollIntoView?.({ block: "center", behavior: "instant" });
    await sleep(200);
    const rect = box.getBoundingClientRect?.();
    if (!rect || Number(rect.width) <= 0 || Number(rect.height) <= 0) {
      return { ok: false, method: "none", reason: "composer_not_visible" };
    }
    const coordinates = {
      x: Number(rect.left) + Number(rect.width) / 2,
      y: Number(rect.top) + Number(rect.height) / 2,
    };
    if (needsWrite) {
      const writeResponse = await send({
        type: "DEBUGGER_COMPOSER_WRITE",
        ...coordinates,
        text: replyText,
      }).catch(() => ({ ok: false }));
      if (!writeResponse?.ok || !writeResponse?.data?.ok) {
        return {
          ok: false,
          method: "debugger_composer_write",
          reason: writeResponse?.data?.error || writeResponse?.error || "debugger_write_failed",
        };
      }
      const mainWorldConfirmed = cleanText(writeResponse.data.writtenText) === cleanText(replyText);
      const writeStarted = Date.now();
      while (Date.now() - writeStarted <= 2500) {
        if (mainWorldConfirmed || cleanText(readComposerText(box)) === cleanText(replyText)) break;
        await sleep(100);
      }
      if (!mainWorldConfirmed && cleanText(readComposerText(box)) !== cleanText(replyText)) {
        return { ok: false, method: "debugger_composer_write", reason: "composer_write_unconfirmed" };
      }
    }
    const submitResponse = await send({
      type: "DEBUGGER_COMPOSER_SUBMIT",
      ...coordinates,
    }).catch(() => ({ ok: false }));
    if (!submitResponse?.ok || !submitResponse?.data?.ok) {
      return {
        ok: false,
        method: "debugger_composer_submit",
        reason: submitResponse?.data?.error || submitResponse?.error || "debugger_submit_failed",
      };
    }
    return {
      ok: true,
      method: submitResponse.data.method || "debugger_main_world_submit",
      composerWriteConfirmed: needsWrite === true,
    };
  }

  function deliveryIsVisible(reply, messages = []) {
    const expected = normalizeLanguageText(reply);
    return messages.some((message) => {
      if (message.speaker !== "Dealer") return false;
      const actual = normalizeLanguageText(message.text);
      return actual === expected || actual.includes(expected) || expected.includes(actual);
    });
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
    const snapshotDealerCount = snapshot.messages.filter((m) => m.speaker === "Dealer").length;
    const liveDealerCount = liveMessages.filter((m) => m.speaker === "Dealer").length;
    if (liveDealerCount > snapshotDealerCount) {
      return { ok: false, reason: "new_dealer_message_in_history" };
    }
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
    if (composerText) {
      const threadKey = payload?.externalThreadRef || "";
      const prevReply = cleanText(lastSuggestedReplyByThread.get(threadKey) || "");
      const matchesExpected = composerText === cleanText(expectedReply) || (prevReply && composerText === prevReply);
      if (!matchesExpected && !isLikelyOwnAiReply(composerText)) {
        return { ok: false, reason: "composer_not_empty" };
      }
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

  function deduplicateSnapshots(snapshots = []) {
    const unique = new Map();
    const keys = new Map();
    for (const snapshot of snapshots) {
      const key = JSON.stringify({
        buyerName: normalizeLanguageText(snapshot.buyerName || ""),
        vehicleTitle: normalizeLanguageText(snapshot.context?.vehicleTitle || ""),
        header: normalizeLanguageText(snapshot.evidence?.selectedHeaderText || ""),
        latestSpeaker: snapshot.lastMessage?.speaker === "Dealer" ? "dealer" : "buyer",
        latestMessage: normalizeLanguageText(snapshot.lastMessage?.text || ""),
      });
      keys.set(snapshot, key);
      const existing = unique.get(key);
      if (!existing || scoreSnapshot(snapshot).score > scoreSnapshot(existing).score) {
        unique.set(key, snapshot);
      }
    }
    return snapshots.filter((snapshot) => unique.get(keys.get(snapshot)) === snapshot);
  }

  function validateSnapshot(snapshot) {
    const routeAllowed = isFacebookMessagesThreadRoute();
    const conversationThreadDetected = snapshot.evidence.threadRootDetected === true;
    const buyerNameDetected = isReliableBuyerName(snapshot.buyerName);
    const activeHeaderDetected = activeThreadHeaderDetected(snapshot);
    const marketplaceContextDetected =
      !!snapshot.context.listingUrl ||
      /\/marketplace\//i.test(location.pathname || "") ||
      /\bmarketplace\b/i.test(cleanText(snapshot.root?.getAttribute?.("aria-label") || "")) ||
      marketplaceHeaderContextDetected(snapshot);
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
    const buyerMessages = messages.filter((message) => message.speaker !== "Dealer");
    const autoActionKey = JSON.stringify({
      thread: externalThreadRef,
      currentMessage,
      buyerMessages: canonicalMessages(buyerMessages).join("\n"),
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
      autoActionKey,
      idempotencyKey: captureHash,
    };
  }

  function extractSuggestedReply(response) {
    return response?.data?.suggestedReply || response?.data?.data?.suggestedReply || "";
  }

  async function maybeSendReply(reply, payload, snapshot, threadKey, settings = DEFAULT_SETTINGS) {
    const autoActionKey = payload.autoActionKey || payload.messageHash;
    if (!reply || autoActionKey === lastAutoSendHashByThread.get(threadKey)) {
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
    const sendResult = await sendThroughComposer(inserted.box, reply, inserted.needsWrite === true);
    if (!sendResult.ok) {
      return {
        autoSent: false,
        reason: sendResult.reason || "send_dispatch_failed",
        sendMethod: sendResult.method,
      };
    }
    const started = Date.now();
    let delivered = false;
    let liveComposer = inserted.box;
    let liveMessages = snapshot.messages;
    while (Date.now() - started <= SEND_EVIDENCE_TIMEOUT_MS) {
      const liveCapture = globalThis.DealerPilotMessengerCapture?.captureFromRoot?.(
        snapshot.root,
        settings.sellerProfileNames,
        document,
      );
      liveComposer = findComposer(snapshot.root) || inserted.box;
      liveMessages = Array.isArray(liveCapture?.messages) ? liveCapture.messages : snapshot.messages;
      delivered = deliveryIsVisible(reply, liveMessages) ||
        ((inserted.reusedExistingDraft === true || sendResult.composerWriteConfirmed === true) &&
          !readComposerText(liveComposer));
      if (delivered) break;
      await sleep(SEND_EVIDENCE_INTERVAL_MS);
    }
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
    lastAutoSendHashByThread.set(threadKey, autoActionKey);
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

    if (isFacebookRatingCard(payload.currentMessage)) {
      lastCaptureHashByThread.set(threadKey, payload.messageHash);
      pendingBuyerByThread.delete(threadKey);
      await sendDebug("blocked", { ...debug, reason: "facebook_rating_card" });
      return { skipped: true, reason: "facebook_rating_card" };
    }

    if (isTerminalAcknowledgement(payload.currentMessage)) {
      lastCaptureHashByThread.set(threadKey, payload.messageHash);
      pendingBuyerByThread.delete(threadKey);
      await sendDebug("blocked", { ...debug, reason: "terminal_acknowledgement" });
      return { skipped: true, reason: "terminal_acknowledgement" };
    }

    if (automatic) {
      const autoActionKey = payload.autoActionKey || payload.messageHash;
      if (autoActionKey === lastAutoSendHashByThread.get(threadKey)) {
        await sendDebug("blocked", { ...debug, reason: "duplicate_auto_send_hash" });
        return { skipped: true, reason: "duplicate_auto_send_hash" };
      }
      const now = Date.now();
      const pending = pendingBuyerByThread.get(threadKey) || {};
      if (autoActionKey !== pending.hash) {
        pendingBuyerByThread.set(threadKey, {
          hash: autoActionKey,
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
    const lastSuggestedReply = repairSuggestedReplyForBuyerIntent(extractSuggestedReply(response), payload);
    if (lastSuggestedReply && !replyMirrorsBuyerLanguage(lastSuggestedReply, payload.currentMessage)) {
      await sendDebug("auto_send_blocked", {
        ...debug,
        aiReplyReceived: true,
        backendIntakeSent: true,
        backendIntakeReceived: true,
        autoSent: false,
        reason: "suggested_reply_language_mismatch",
      });
      return {
        ok: false,
        suggestedReply: "",
        autoSent: false,
        reason: "suggested_reply_language_mismatch",
      };
    }
    lastSuggestedReplyByThread.set(threadKey, lastSuggestedReply);

    if (lastSuggestedReply && deliveryIsVisible(lastSuggestedReply, snapshot.messages)) {
      const autoActionKey = payload.autoActionKey || payload.messageHash;
      lastAutoSendHashByThread.set(threadKey, autoActionKey);
      lastAutoReplyByThread.set(threadKey, { text: cleanText(lastSuggestedReply), at: Date.now() });
      await sendDebug("intake_ok", {
        ...debug,
        aiReplyReceived: true,
        backendIntakeSent: true,
        backendIntakeReceived: true,
        autoSent: true,
        reason: "reply_already_delivered",
        deliveryConfirmed: true,
      });
      return { ok: true, suggestedReply: lastSuggestedReply, autoSent: true, reason: "reply_already_delivered", deliveryConfirmed: true };
    }

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

    if (lastSuggestedReply && replyRepeatsConversation(lastSuggestedReply, snapshot.messages, payload.currentMessage)) {
      lastAutoSendHashByThread.set(threadKey, payload.autoActionKey || payload.messageHash);
      await sendDebug("auto_send_blocked", {
        ...debug,
        aiReplyReceived: true,
        backendIntakeSent: true,
        backendIntakeReceived: true,
        autoSent: false,
        reason: "reply_repeats_conversation",
        suggestedReplyPreview: cleanText(lastSuggestedReply).slice(0, 200),
      });
      return { ok: false, suggestedReply: "", autoSent: false, reason: "reply_repeats_conversation" };
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
    const snapshots = deduplicateSnapshots(createCaptureSnapshots(settings));
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

  async function restoreAutoSendState() {
    const response = await send({ type: "LOAD_AUTO_SEND_STATE" }).catch(() => ({}));
    if (response?.ok && response.data) {
      const { sendHashes, replies } = response.data;
      if (sendHashes) {
        for (const [key, value] of Object.entries(sendHashes)) {
          lastAutoSendHashByThread.set(key, value);
        }
      }
      if (replies) {
        for (const [key, value] of Object.entries(replies)) {
          lastAutoReplyByThread.set(key, value);
        }
      }
    }
  }

  function start() {
    if (!isFacebookMessagesThreadRoute()) return;
    restoreAutoSendState().then(() => {
      getSettings().then((settings) => {
        globalThis.DealerPilotMessengerAutonomy.start({
          processThread: captureConversation,
          sellerProfileNames: settings.sellerProfileNames,
        });
      }).catch(console.warn);
    }).catch(console.warn);
    setInterval(() => {
      const sendHashes = Object.fromEntries(lastAutoSendHashByThread);
      const replies = Object.fromEntries(lastAutoReplyByThread);
      send({ type: "SAVE_AUTO_SEND_STATE", sendHashes, replies }).catch(() => {});
    }, 30000);
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
    isFacebookRatingCard,
    isTerminalAcknowledgement,
    replyMirrorsBuyerLanguage,
    replyRepeatsConversation,
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
