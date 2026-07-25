(function () {
  // Messenger DOM capture is deliberately isolated from the Marketplace
  // publisher. Facebook changes this surface often, while the publisher's
  // form automation must remain untouched.
  const MESSAGE_SCOPE_SELECTORS = [
    '[role="log"]',
    '[aria-live="polite"][aria-label*="message" i]',
    '[aria-live="polite"][aria-label*="mensaje" i]',
    '[aria-live="polite"][aria-label*="conversation" i]',
    '[aria-live="polite"][aria-label*="conversación" i]',
    '[data-pagelet*="conversation" i]',
    '[data-testid*="conversation" i]',
  ];

  const COMPOSER_SELECTORS = [
    '[contenteditable="true"]',
    'textarea',
  ];

  const STRUCTURED_MESSAGE_SELECTORS = [
    '[aria-label*="message" i]',
    '[aria-label*="mensaje" i]',
    '[data-testid*="message" i]',
    '[data-testid*="messenger" i]',
  ];

  const UI_TEXT = /^(?:marketplace|messenger|messages|notifications|settings(?:, help and more)?|see details|ver detalles|more options|m[aá]s opciones|open more actions|back to previous page|thread composer|choose an emoji|choose a sticker|choose a gif|compose|chats|aa|unread message|write a message|escribe un mensaje|send a quick response|tap a response|enviar una respuesta|write to|escribe a|search|buscar|inbox|bandeja de entrada|selling|buying|comprando|vendiendo)$/i;

  function textOf(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanDisplayName(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^(?:conversation with|conversaci[oó]n con)\s+/i, "")
      .replace(/^(?:conversation titled|conversaci[oó]n titulada)\s+/i, "")
      .replace(/^(?:write to|escribe a)\s+/i, "")
      .trim();
  }

  function cleanMessageText(value) {
    let text = String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s*(?:Enter|Return)\s*,?\s*/i, "")
      .trim();
    if (/^(?:message sent|mensaje enviado)[\s.]*$/i.test(text)) return "";
    const sentMatch = text.match(/(?:message sent|mensaje enviado)[^:]{0,180}:\s*([\s\S]+)$/i);
    if (sentMatch) text = sentMatch[1].trim();
    return text
      .replace(/^\s*(?:message sent|mensaje enviado)\s+(?:at\s+)?(?:\d{1,2}:\d{2}|\d{1,2})\s*(?:am|pm)?\s+(?:by|por)\s+[^:]{1,80}:\s*/i, "")
      .replace(/^\s*(?:\d{1,2}:\d{2}|\d{1,2})\s*(?:am|pm)?\s+(?:by|por)\s+[^:]{1,80}:\s*/i, "")
      .replace(/^\s*[^.]{2,80}\s+(?:started|inici[oó])\s+(?:this|este)\s+chat\.?\s*$/i, "")
      .replace(/\s+(?:Enter|Return)\s*,?\s*(?:message sent|mensaje enviado)[\s\S]*$/i, "")
      .trim();
  }

  function isMessageMetadataText(value) {
    const text = cleanMessageText(value);
    if (!text) return true;
    return /^(?:message sent|mensaje enviado)?\s*(?:at\s+)?(?:\d{1,2}:\d{2}|\d{1,2})\s*(?:am|pm)?\s+(?:by|por)\s+[^:]{1,80}\.?$/i.test(text) ||
      /^[^.]{2,80}\s+(?:started|inici[oó])\s+(?:this|este)\s+chat\.?$/i.test(text);
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function rectOf(element) {
    return element?.getBoundingClientRect?.() || { left: 0, right: 0, top: 0, width: 0, height: 0 };
  }

  function isComposer(element) {
    if (!element || !isVisible(element)) return false;
    const descriptor = [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("aria-placeholder"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("data-lexical-editor"),
    ].filter(Boolean).join(" ");
    return !/search|buscar|comment|comentario|post|publicaci[oó]n|caption|descripci[oó]n/i.test(descriptor);
  }

  function hasComposer(root) {
    return COMPOSER_SELECTORS.some((selector) =>
      Array.from(root?.querySelectorAll?.(selector) || []).some(isComposer),
    );
  }

  function hasMarketplaceEvidence(root, marketplaceRoute) {
    if (!root) return false;
    const link = root.querySelector?.('a[href*="/marketplace/item/"]');
    const text = `${root.getAttribute?.("aria-label") || ""} ${textOf(root)}`;
    return !!link || /\bmarketplace\b/i.test(text) || marketplaceRoute;
  }

  function hasBuyerHeaderEvidence(root) {
    const text = textOf(root);
    return /[\p{L}][\p{L}\s.'-]{1,80}\s*(?:[\u00b7\u2022|]|Â·|â€¢)\s*(?:\$?\d|19\d{2}|20\d{2}|Marketplace\b)/u.test(text) ||
      /\b(?:view buyer|ver perfil del comprador)\b/i.test(text);
  }

  function rootCandidateScore(root, marketplaceRoute) {
    if (!root || !isVisible(root)) return -Infinity;
    const rect = rectOf(root);
    const area = rect.width * rect.height;
    const role = root.getAttribute?.("role") || "";
    let score = 0;
    if (role === "dialog") score += 120;
    if (/conversation|conversaci/i.test(root.getAttribute?.("aria-label") || "")) score += 80;
    if (hasBuyerHeaderEvidence(root)) score += 120;
    if (hasComposer(root)) score += 40;
    if (hasMarketplaceEvidence(root, marketplaceRoute)) score += 30;
    if (role === "main") score -= 90;
    if (rect.width < 260 || rect.height < 260 || area < 60000) score -= 120;
    if (area > 1200000) score -= 40;
    return score;
  }

  function findThreadRoots({ document, location }) {
    const marketplaceRoute = /\/marketplace\/(?:inbox|you\/selling|you\/buying|item\/\d+)/i.test(location?.pathname || "");
    const semantic = [
      '[role="region"][aria-label*="conversation" i]',
      '[role="region"][aria-label*="conversación" i]',
      '[role="dialog"]',
      '[role="main"]',
    ];
    const candidates = [];
    for (const selector of semantic) {
      for (const candidate of Array.from(document?.querySelectorAll?.(selector) || [])) {
        if (isVisible(candidate) && hasComposer(candidate) && hasMarketplaceEvidence(candidate, marketplaceRoute)) {
          candidates.push(candidate);
        }
      }
    }
    const composerRoots = [];
    for (const composer of Array.from(document?.querySelectorAll?.(COMPOSER_SELECTORS.join(", ")) || []).filter(isComposer)) {
      let parent = composer.parentElement;
      while (parent && parent !== document.documentElement) {
        if (isVisible(parent) && hasComposer(parent) && hasMarketplaceEvidence(parent, marketplaceRoute)) {
          composerRoots.push(parent);
        }
        parent = parent.parentElement;
      }
    }
    const seen = new Set();
    return [...candidates, ...composerRoots]
      .filter((candidate) => {
        if (seen.has(candidate)) return false;
        seen.add(candidate);
        return true;
      })
      .sort((left, right) => {
        const scoreDiff = rootCandidateScore(right, marketplaceRoute) - rootCandidateScore(left, marketplaceRoute);
        if (scoreDiff) return scoreDiff;
        const a = rectOf(left); const b = rectOf(right);
        return (a.width * a.height) - (b.width * b.height);
      });
  }

  function findThreadRoot({ document, location }) {
    return findThreadRoots({ document, location })[0] || null;
  }

  function scoreScope(scope, root) {
    if (!scope || !isVisible(scope)) return -1;
    const structured = scope.querySelectorAll?.(STRUCTURED_MESSAGE_SELECTORS.join(", ")).length || 0;
    const textNodes = scope.querySelectorAll?.('div[dir="auto"], span[dir="auto"], [data-lexical-text]').length || 0;
    const area = rectOf(scope);
    const rootArea = Math.max(1, rectOf(root).width * rectOf(root).height);
    const areaPenalty = (area.width * area.height) / rootArea;
    return (structured * 10) + Math.min(textNodes, 40) - areaPenalty;
  }

  function findMessageScope(root) {
    if (!root) return null;
    const explicit = Array.from(root.querySelectorAll?.(MESSAGE_SCOPE_SELECTORS.join(", ")) || [])
      .filter(isVisible)
      .sort((left, right) => scoreScope(right, root) - scoreScope(left, root));
    if (explicit[0]) return explicit[0];

    const scrollables = Array.from(root.querySelectorAll?.("div, section, main") || [])
      .filter((element) => {
        if (!isVisible(element)) return false;
        const style = window.getComputedStyle?.(element);
        const rect = rectOf(element);
        return /auto|scroll/i.test(style?.overflowY || "") && rect.height > 80;
      })
      .sort((left, right) => scoreScope(right, root) - scoreScope(left, root));
    return scrollables[0] || root;
  }

  function senderIsDealer(sender, sellerNameCandidates = []) {
    const normalized = String(sender || "").trim().toLowerCase();
    if (!normalized) return false;
    if (/^(?:you|tú|ti|tuyo|tuy[o ]?|yo)$/.test(normalized)) return true;
    return sellerNameCandidates.some((candidate) => {
      const left = normalized.replace(/\s+/g, " ");
      const right = String(candidate || "").trim().toLowerCase().replace(/\s+/g, " ");
      return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `);
    });
  }

  function parseDescriptor(element, sellerNameCandidates) {
    const labels = [
      element.getAttribute?.("aria-label") || "",
      ...Array.from(element.querySelectorAll?.("[aria-label]") || []).map((node) => node.getAttribute("aria-label") || ""),
    ].filter(Boolean);
    const descriptor = labels.find((label) => /(?:\bby\b|\bpor\b|message sent|mensaje enviado)/i.test(label)) || "";
    if (!descriptor) return null;
    const match = descriptor.match(/(?:\bby\b|\bpor\b)\s+([^:]{1,100}):\s*(.+)$/i) ||
      descriptor.match(/(?:message sent|mensaje enviado)[^:]*:\s*(.+)$/i);
    if (!match && isMessageMetadataText(descriptor)) return null;
    const sender = match?.[1] || "";
    const isDealer = senderIsDealer(sender, sellerNameCandidates) || /\b(?:by\s+you|por\s+t[iú])\b/i.test(descriptor);
    const text = cleanMessageText(match?.[2] || match?.[1] || textOf(element));
    if (!text || UI_TEXT.test(text) || text.length > 500 || isMessageMetadataText(text)) return null;
    if (isLikelyAutoReplyText(text) && !isDealer) return null;
    return { speaker: isDealer ? "Dealer" : "Buyer", text };
  }

  function bubbleTextCandidates(scope) {
    const selectors = [
      'div[dir="auto"]',
      'span[dir="auto"]',
      '[data-lexical-text]',
    ];
    let elements = Array.from(scope.querySelectorAll?.(selectors.join(", ")) || []).filter(isVisible);
    if (!elements.length) {
      elements = Array.from(scope.querySelectorAll?.("div, span") || []).filter((element) => {
        if (!isVisible(element)) return false;
        const text = textOf(element);
        return text.length >= 2 && text.length <= 500 && !UI_TEXT.test(text) && !element.querySelector("input, textarea, [contenteditable='true']");
      });
    }
    return elements.filter((element) => {
      const text = cleanMessageText(textOf(element));
      if (!text || text.length < 2 || text.length > 500 || UI_TEXT.test(text) || isMessageMetadataText(text)) return false;
      if (/^(?:send a quick response|tap a response|yes, are you inter|in talks\. i'll let you|sorry, it'?s not av)/i.test(text)) return false;
      return !element.querySelector?.('a[href*="/marketplace/item/"], button, [role="button"], [contenteditable="true"], textarea');
    });
  }

  function normalizeForMatch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isLikelyAutoReplyText(value) {
    const normalized = normalizeForMatch(cleanMessageText(value));
    return /^yes\s+(?:-|--|—)?\s*the car is still available\b/.test(normalized) ||
      /\beasy financing options\b/.test(normalized) ||
      /^perfect\b[\s\S]{0,80}\b(?:we will contact|contact you)\b/.test(normalized) ||
      /^good morning\b[\s\S]{0,120}\b(?:includes vin|all the info)\b/.test(normalized);
  }

  function isLikelyBuyerNameCandidate(value) {
    const cleaned = cleanDisplayName(value);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return false;
    if (UI_TEXT.test(cleaned)) return false;
    if (/^(?:aa|messenger|messages|notifications|settings(?:, help and more)?|open more actions|back to previous page|thread composer|choose an emoji|choose a sticker|choose a gif|compose|chats|unread message|write a message|escribe un mensaje)$/i.test(cleaned)) return false;
    if (/[?!:;]/.test(cleaned)) return false;
    if (isLikelyAutoReplyText(cleaned)) return false;
    const normalized = normalizeForMatch(cleaned);
    if (/\b(?:marketplace|facebook|messenger|messages|notifications|settings|help|listing|vehicle|toyota|honda|chevrolet|ford|tesla|rav4|camry|civic|equinox|tacoma|model y|available|interested|financing|message|sent|send|buyer|seller|response|emoji|sticker|gif|compose|chats|disponible|interesa|numero|vehiculo)\b/.test(normalized)) {
      return false;
    }
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length > 4) return false;
    return /[\p{L}]/u.test(cleaned);
  }

  function extractHeaderText(root) {
    const candidates = [
      root?.querySelector?.('[role="heading"], h1, h2, h3, [aria-level]'),
      ...Array.from(root?.querySelectorAll?.('[role="heading"], h1, h2, h3, [aria-level], div[dir="auto"], span[dir="auto"]') || []),
    ].filter((candidate) => candidate && !candidate.matches?.('[contenteditable="true"], textarea'));
    for (const candidate of candidates) {
      const value = cleanDisplayName(textOf(candidate) || candidate.getAttribute?.("aria-label") || "");
      if (!value || UI_TEXT.test(value) || value.length > 160) continue;
      if (/^(?:marketplace|\$?\d|see details|view buyer|more options)\b/i.test(value)) continue;
      if (/(?:[\u00b7\u2022|]|Â·|â€¢)\s*(?:\$?\d|19\d{2}|20\d{2}|Marketplace\b)/i.test(value)) {
        return value;
      }
      if (/\s+(?:started|inici[oÃ³])\s+(?:this|este)\s+chat\b/i.test(value)) {
        return value;
      }
    }
    return "";
  }

  function extractInboxPreviewMessage(document, buyerName) {
    const buyer = cleanDisplayName(buyerName);
    const normalizedBuyer = normalizeForMatch(buyer);
    if (!normalizedBuyer || normalizedBuyer.length < 2) return null;
    const candidates = Array.from(document?.querySelectorAll?.('div[dir="auto"], span[dir="auto"], [aria-label]') || [])
      .filter(isVisible)
      .map((element) => textOf(element) || element.getAttribute?.("aria-label") || "")
      .map((text) => cleanMessageText(text))
      .filter((text) => text.length >= 4 && text.length <= 700);

    for (const text of candidates) {
      const normalized = normalizeForMatch(text);
      if (!normalized.includes(normalizedBuyer)) continue;
      if (!/(?:19|20)\d{2}|marketplace|toyota|honda|chevrolet|ford|tesla|rav4|camry|civic|equinox|tacoma/i.test(text)) continue;
      const afterVehicle = text
        .replace(new RegExp(`^\\s*${buyer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[·•|-]\\s*`, "i"), "")
        .replace(/^(?:19|20)\d{2}\s+[\s\S]{0,80}?\s{2,}/, "")
        .replace(/^[\s\S]{0,120}?\b(?:ev|rav4|camry|civic|tacoma|model y)\b\s*/i, "")
        .trim();
      const fallbackMatch = text.match(new RegExp(`${buyer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]{0,160}?(are you still interested\\?|what(?:'s| is) the best number[\\s\\S]{0,120}\\?|hola[\\s\\S]{0,120}\\?|me interesa[\\s\\S]{0,160}\\?|(?:¿|\\?)?todav[ií]a[\\s\\S]{0,160}\\?|is this available\\?)`, "i"));
      const message = cleanDisplayName(fallbackMatch?.[1] || afterVehicle);
      if (message && message.length >= 4 && message.length <= 240 && !UI_TEXT.test(message)) {
        return { speaker: buyer, text: message };
      }
    }
    return null;
  }

  function extractMessageLikeText(value) {
    const text = cleanMessageText(value);
    if (isMessageMetadataText(text)) return "";
    if (isLikelyAutoReplyText(text)) return "";
    const match = text.match(
      /(hola[\s\S]{0,160}\?|me interesa[\s\S]{0,180}\?|(?:Â¿|\?)?todav[iÃ­]a[\s\S]{0,180}\?|are you still interested\?|what(?:'s| is) the best number[\s\S]{0,140}\?|is this available\?)/i,
    );
    const tolerantSpanishAvailability = text.match(/(?:Â¿|Ã‚Â¿|\?)?todav[\s\S]{0,180}\?/i);
    return cleanMessageText(match?.[1] || tolerantSpanishAvailability?.[0] || "");
  }

  function isClearlyOwnSide(element, scope) {
    if (!element || !scope) return false;
    const scopeRect = rectOf(scope);
    const rect = rectOf(element);
    const minDealerOffset = Math.max(48, scopeRect.width * 0.18);
    const leftGap = Math.max(0, rect.left - scopeRect.left);
    const rightGap = Math.max(0, scopeRect.right - rect.right);
    return leftGap > rightGap + minDealerOffset &&
      rect.left > scopeRect.left + (scopeRect.width * 0.35);
  }

  function extractVisibleBuyerMessages(root, documentRef, buyerName, scope) {
    const buyer = cleanDisplayName(buyerName);
    if (!buyer) return [];
    const rootSources = Array.from(root?.querySelectorAll?.('div[dir="auto"], span[dir="auto"], [aria-label]') || [])
      .filter(isVisible);
    const sources = rootSources.length ? rootSources : Array.from(documentRef?.querySelectorAll?.('div[dir="auto"], span[dir="auto"], [aria-label]') || [])
      .filter(isVisible);
    const seen = new Set();
    return sources
      .map((element) => ({
        text: extractMessageLikeText(textOf(element) || element.getAttribute?.("aria-label") || ""),
        top: rectOf(element).top || 0,
        ownSide: isClearlyOwnSide(element, scope),
      }))
      .filter((candidate) => candidate.text && !candidate.ownSide && candidate.text.length >= 4 && !UI_TEXT.test(candidate.text))
      .sort((left, right) => left.top - right.top)
      .filter((candidate) => {
        const key = normalizeForMatch(candidate.text);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((candidate) => ({ speaker: buyer, text: candidate.text }));
  }

  function readVisualMessages(scope, buyerName) {
    const scopeRect = rectOf(scope);
    const seen = new Set();
    const rows = [];
    const minDealerOffset = Math.max(48, scopeRect.width * 0.18);
    for (const textElement of bubbleTextCandidates(scope)) {
      let bubble = textElement;
      while (bubble.parentElement && bubble.parentElement !== scope && textOf(bubble.parentElement).length <= 520) {
        const parent = bubble.parentElement;
        const rect = rectOf(parent);
        if (rect.width <= Math.max(720, scopeRect.width * 0.95) && rect.height <= 360) bubble = parent;
        else break;
      }
      if (seen.has(bubble)) continue;
      seen.add(bubble);
      const text = cleanMessageText(textOf(bubble));
      const rect = rectOf(bubble);
      const leftGap = Math.max(0, rect.left - scopeRect.left);
      const rightGap = Math.max(0, scopeRect.right - rect.right);
      const clearlyRightAligned =
        leftGap > rightGap + minDealerOffset &&
        rect.left > scopeRect.left + (scopeRect.width * 0.35);
      if (!text || text.length < 2 || UI_TEXT.test(text)) continue;
      if (isLikelyAutoReplyText(text) && !clearlyRightAligned) continue;
      rows.push({ top: rect.top, speaker: clearlyRightAligned ? "Dealer" : (buyerName || "Buyer"), text });
    }
    return rows.sort((a, b) => a.top - b.top).map(({ speaker, text }) => ({ speaker, text }));
  }

  function extractBuyerName(root) {
    const fallback = root?.getAttribute?.("aria-label") || "";
    const headerText = extractHeaderText(root);
    if (headerText) {
      const startedMatch = headerText.match(/^(.{2,80}?)\s+(?:started|inici[oÃ³])\s+(?:this|este)\s+chat\b/i);
      if (startedMatch) return cleanDisplayName(startedMatch[1]);
      const listingHeaderMatch = headerText.match(/^(.{2,80}?)\s*(?:[\u00b7\u2022|]|Â·|â€¢)\s*(?:\$?\d|19\d{2}|20\d{2}|Marketplace\b)/i);
      const listingHeaderName = cleanDisplayName(listingHeaderMatch?.[1] || "");
      if (listingHeaderName && isLikelyBuyerNameCandidate(listingHeaderName)) {
        return listingHeaderName;
      }
    }
    const candidates = [
      root?.querySelector?.('[role="heading"], h1, h2, h3, [aria-level]'),
      ...Array.from(root?.querySelectorAll?.('div[dir="auto"], span[dir="auto"], [aria-label]') || []),
    ].filter((candidate) => candidate && !candidate.matches?.('[contenteditable="true"], textarea'));
    for (const candidate of candidates) {
      const value = cleanDisplayName(textOf(candidate) || candidate.getAttribute?.("aria-label") || "");
      if (!value || UI_TEXT.test(value) || value.length > 140) continue;
      const startedMatch = value.match(/^(.{2,80}?)\s+(?:started|inici[oó])\s+(?:this|este)\s+chat\b/i);
      if (startedMatch) return cleanDisplayName(startedMatch[1]);
      const listingHeaderMatch = value.match(/^(.{2,80}?)\s*(?:[\u00b7\u2022|]|Â·|â€¢)\s*(?:\$?\d|19\d{2}|20\d{2}|Marketplace\b)/i);
      const listingHeaderName = cleanDisplayName(listingHeaderMatch?.[1] || "");
      if (listingHeaderName && isLikelyBuyerNameCandidate(listingHeaderName)) {
        return listingHeaderName;
      }
      if (isLikelyBuyerNameCandidate(value)) {
        return value;
      }
    }
    if (/marketplace|conversation|conversaci[oó]n/i.test(fallback)) return "";
    return cleanDisplayName(fallback).split(/\s+[\u00b7\u2022|]\s+/)[0].trim();
  }

  function captureFromRoot(root, sellerNameCandidates = [], documentRef = null) {
    const scope = findMessageScope(root);
    const headerText = extractHeaderText(root);
    const buyerName = extractBuyerName(root);
    const semantic = Array.from(scope?.querySelectorAll?.(STRUCTURED_MESSAGE_SELECTORS.join(", ")) || [])
      .filter(isVisible)
      .map((element) => parseDescriptor(element, sellerNameCandidates))
      .filter(Boolean);
    const rawMessages = semantic.length ? semantic : scope ? readVisualMessages(scope, buyerName) : [];
    const messages = rawMessages.map((message) =>
      message.speaker === "Buyer" && buyerName ? { ...message, speaker: buyerName } : message,
    );
    const visibleBuyerMessages = extractVisibleBuyerMessages(root, documentRef, buyerName, scope);
    const hasBuyerMessage = messages.some((message) => message.speaker !== "Dealer");
    const inboxPreview = !hasBuyerMessage && !visibleBuyerMessages.length
      ? extractInboxPreviewMessage(documentRef, buyerName)
      : null;
    const finalMessages = messages.filter((message) =>
      message.speaker !== "Dealer" || !visibleBuyerMessages.some((buyerMessage) => buyerMessage.text === message.text),
    );
    if (inboxPreview && !finalMessages.some((message) => message.speaker !== "Dealer" && message.text === inboxPreview.text)) {
      finalMessages.push(inboxPreview);
    }
    for (const visibleBuyerMessage of visibleBuyerMessages) {
      if (!finalMessages.some((message) => message.speaker !== "Dealer" && message.text === visibleBuyerMessage.text)) {
        finalMessages.push(visibleBuyerMessage);
      }
    }
    return {
      root,
      scope,
      buyerName,
      messages: finalMessages,
      evidence: {
        threadRootDetected: !!root,
        messageScopeDetected: !!scope,
        selectedHeaderText: headerText,
        selectedRootTextPreview: cleanMessageText(textOf(root)).slice(0, 260),
        selectedRootRect: rectOf(root),
        selectedScopeRect: rectOf(scope),
        messageCandidateCount: semantic.length || (scope ? bubbleTextCandidates(scope).length : 0),
        inboxPreviewFallback: !!inboxPreview,
        extractionMode: semantic.length ? "semantic" : finalMessages.length ? inboxPreview ? "visual_bubbles_inbox_preview" : "visual_bubbles" : "none",
        latestMessageDirection: finalMessages.at(-1)?.speaker === "Dealer" ? "dealer" : finalMessages.length ? "buyer" : "none",
      },
    };
  }

  function capture({ document, location, sellerNameCandidates = [] }) {
    return captureFromRoot(findThreadRoot({ document, location }), sellerNameCandidates, document);
  }

  function captureAll({ document, location, sellerNameCandidates = [] }) {
    const roots = findThreadRoots({ document, location });
    if (!roots.length) return [captureFromRoot(null, sellerNameCandidates, document)];
    return roots.map((root) => captureFromRoot(root, sellerNameCandidates, document));
  }

  globalThis.DealerPilotMessengerCapture = Object.freeze({
    capture,
    captureAll,
    captureFromRoot,
    findThreadRoot,
    findThreadRoots,
    findMessageScope,
    readVisualMessages,
  });
})();
