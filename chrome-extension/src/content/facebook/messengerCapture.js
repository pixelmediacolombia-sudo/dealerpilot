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

  const INBOX_UI_TEXT = /^(?:marketplace|inbox|bandeja de entrada|selling|vendiendo|buying|comprando|notifications|notificaciones|browse all|explorar todo|create new listing|crear publicaci[oÃ³]n|search marketplace|buscar en marketplace)$/i;
  const VEHICLE_YEAR = /\b(?:19|20)\d{2}\b/;

  const UI_TEXT = /^(?:marketplace|view buyer|ver comprador|view seller|ver vendedor|mark as pending|marcar como pendiente|see details|ver detalles|more options|m[aá]s opciones|send a quick response|tap a response|enviar una respuesta|write to|escribe a|search|buscar|inbox|bandeja de entrada|selling|selling|buying|comprando|vendiendo)$/i;
  const THREAD_CONTROL_TEXT = /(?:view\s*buyer|ver\s+(?:al\s+)?comprador|view\s*seller|ver\s+(?:al\s+)?vendedor|mark\s*as\s*pending|marcar\s*como\s*pendiente|more\s*options|m[aá]s\s*opciones|see\s*details|ver\s*detalles)/gi;
  const SELLER_SURFACE_POSITIVE = /\b(?:view\s*buyer|ver\s+(?:al\s+)?comprador|mark\s*as\s*pending|marcar\s*como\s*pendiente)\b/i;
  const SELLER_SURFACE_NEGATIVE = /\b(?:view\s*seller|ver\s+(?:al\s+)?vendedor)\b/i;

  function textOf(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanControlText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(THREAD_CONTROL_TEXT, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function descriptorText(element) {
    return [
      element?.getAttribute?.("aria-label") || "",
      element?.getAttribute?.("title") || "",
      textOf(element),
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function surfaceEvidence(root) {
    if (!root) {
      return {
        sellerSurfaceDetected: false,
        sellerSurfaceRejected: false,
        sellerSurfaceEvidence: [],
      };
    }
    const nodes = Array.from(root.querySelectorAll?.("[aria-label], [title], button, [role=\"button\"], a") || []);
    const evidence = nodes
      .filter((element) => {
        const role = element.getAttribute?.("role") || "";
        const tag = String(element.tagName || "").toUpperCase();
        const label = [
          element.getAttribute?.("aria-label") || "",
          element.getAttribute?.("title") || "",
        ].join(" ").trim();
        return /^(?:BUTTON|A)$/.test(tag) || /^(?:button|link|menuitem)$/i.test(role) ||
          /^(?:view\s*buyer|ver\s+(?:al\s+)?comprador|view\s*seller|ver\s+(?:al\s+)?vendedor|mark\s*as\s*pending|marcar\s*como\s*pendiente)$/i.test(label);
      })
      .map(descriptorText)
      .filter(Boolean)
      .flatMap((text) => text.match(new RegExp(THREAD_CONTROL_TEXT.source, "gi")) || [])
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text, index, values) => values.findIndex((value) => value.toLowerCase() === text.toLowerCase()) === index);
    const sellerSurfaceRejected = evidence.some((text) => SELLER_SURFACE_NEGATIVE.test(text));
    const positive = evidence.filter((text) => SELLER_SURFACE_POSITIVE.test(text));
    return {
      sellerSurfaceDetected: positive.length > 0 && !sellerSurfaceRejected,
      sellerSurfaceRejected,
      sellerSurfaceEvidence: evidence,
    };
  }

  function looksLikeVehicleTitle(value) {
    const cleaned = cleanControlText(value);
    return /^(?:19|20)\d{2}\s+[A-Za-z0-9]/.test(cleaned) && !/[?!]/.test(cleaned);
  }

  function cleanVehicleTitle(value) {
    const cleaned = cleanControlText(value)
      .replace(/^.*?\$[\d,.]+\s*[-\u2013\u2014]\s*/i, "")
      .replace(/^.*?[\u00b7\u2022|]\s+(?=(?:19|20)\d{2}\b)/, "")
      .trim();
    const yearIndex = cleaned.search(/\b(?:19|20)\d{2}\b/);
    if (yearIndex < 0) return "";
    return cleaned.slice(yearIndex).replace(/[\u00b7\u2022|].*$/, "").trim().slice(0, 100);
  }

  function cleanBuyerName(value) {
    let cleaned = cleanControlText(value)
      .replace(/^(?:conversation\s+(?:with|titled)|conversaci[oó]n\s+(?:con|titulada))\s*/i, "")
      .replace(/\b(?:19|20)\d{2}\b.*$/, "")
      .replace(/\s*[-\u2013\u2014|\u00b7\u2022]\s*$/, "")
      .trim();
    if (/\s+[-\u2013\u2014|\u00b7\u2022]\s+/.test(cleaned)) {
      cleaned = cleaned.split(/\s+[-\u2013\u2014|\u00b7\u2022]\s+/)[0].trim();
    }
    if (
      !cleaned || cleaned.length < 2 || cleaned.length > 80 ||
      UI_TEXT.test(cleaned) || looksLikeVehicleTitle(cleaned) ||
      /\b(?:marketplace|vehicle|listing|facebook)\b/i.test(cleaned) ||
      /[$/]/.test(cleaned)
    ) return "";
    return cleaned;
  }

  function threadHeaderCandidates(root) {
    if (!root) return [];
    const nodes = Array.from(root.querySelectorAll?.('[role="heading"], h1, h2, h3, [aria-level]') || []);
    const labelledRoot = root.getAttribute?.("aria-label") || "";
    return [
      ...(labelledRoot ? [{ element: root, text: labelledRoot, source: "root_aria_label" }] : []),
      ...nodes.filter(isVisible).map((element) => ({
        element,
        text: descriptorText(element),
        source: element.getAttribute?.("role") === "heading" ? "role_heading" : element.tagName.toLowerCase(),
      })),
    ].filter(({ text }) => !!cleanControlText(text));
  }

  function inspectThread(root) {
    const candidates = threadHeaderCandidates(root);
    const buyerCandidate = candidates
      .map((candidate, order) => ({ ...candidate, order, buyerName: cleanBuyerName(candidate.text) }))
      .filter(({ buyerName }) => !!buyerName)
      .sort((left, right) => {
        const leftDirected = /conversation\s+with|conversaci[oó]n\s+con/i.test(left.text) ? 1 : 0;
        const rightDirected = /conversation\s+with|conversaci[oó]n\s+con/i.test(right.text) ? 1 : 0;
        return rightDirected - leftDirected || left.order - right.order;
      })[0] || null;
    const vehicleCandidate = candidates
      .map((candidate) => ({ ...candidate, vehicleTitle: cleanVehicleTitle(candidate.text) }))
      .find(({ vehicleTitle }) => !!vehicleTitle) || null;
    const surface = surfaceEvidence(root);
    return {
      ...surface,
      buyerName: buyerCandidate?.buyerName || "",
      cleanedThreadHeader: buyerCandidate?.buyerName || cleanControlText(candidates[0]?.text || ""),
      cleanedVehicleTitle: vehicleCandidate?.vehicleTitle || "",
      headerSource: buyerCandidate?.source || "",
    };
  }

  function sellerContextIsTrusted(threadEvidence, profileMatched = false) {
    return threadEvidence?.sellerSurfaceRejected !== true &&
      (threadEvidence?.sellerSurfaceDetected === true || profileMatched === true);
  }

  function selectorFor(element) {
    if (!element) return "";
    const role = element.getAttribute?.("role");
    const label = element.getAttribute?.("aria-label");
    const testId = element.getAttribute?.("data-testid");
    const id = element.getAttribute?.("id") || element.id;
    if (id) return `#${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    if (testId) return `[data-testid="${String(testId).slice(0, 100)}"]`;
    if (role && label) return `[role="${role}"][aria-label="${String(label).slice(0, 100)}"]`;
    if (role) return `[role="${role}"]`;
    return String(element.tagName || "div").toLowerCase();
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
    const role = root.getAttribute?.("role") || "";
    const semanticThread = /^(?:dialog|region)$/i.test(role) ||
      /conversation|conversaci[oó]n|chat/i.test(root.getAttribute?.("aria-label") || "");
    const surface = surfaceEvidence(root);
    return !!link || /\bmarketplace\b/i.test(text) || surface.sellerSurfaceEvidence.length > 0 ||
      (marketplaceRoute && semanticThread);
  }

  function isMarketplaceInboxRoute(location) {
    return /\/marketplace\/inbox\b/i.test(location?.pathname || "");
  }

  function isClickableInboxNode(element) {
    if (!element) return false;
    const tagName = String(element.tagName || "").toUpperCase();
    const role = element.getAttribute?.("role") || "";
    return tagName === "A" || tagName === "BUTTON" || /^(?:link|button)$/i.test(role) ||
      typeof element.click === "function";
  }

  function inboxCandidateText(element) {
    return textOf(element).replace(/\s+/g, " ").trim().slice(0, 360);
  }

  function isInboxNavigationText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    return !normalized || INBOX_UI_TEXT.test(normalized) ||
      /^(?:\+?\d+|menu|settings|configuraci[oÃ³]n|help|ayuda)$/i.test(normalized);
  }

  function inboxCandidateScore(element) {
    const text = inboxCandidateText(element);
    if (!isVisible(element) || isInboxNavigationText(text) || text.length < 8 || text.length > 360) return -1;
    if (element.querySelector?.('input, textarea, [contenteditable="true"]')) return -1;
    const descriptor = [
      element.getAttribute?.("aria-label") || "",
      element.getAttribute?.("title") || "",
      element.getAttribute?.("href") || "",
      text,
    ].join(" ");
    const hasVehicle = VEHICLE_YEAR.test(descriptor);
    const hasMarketplace = /\bmarketplace\b/i.test(descriptor);
    const hasUnreadSignal = /\b(?:unread|no le[ií]do|new message|nuevo mensaje)\b/i.test(descriptor);
    const hasPreview = /[?.!]{1}|\b(?:available|unavailable|attachment|interested|information|info|hola|hello|yes|no)\b/i.test(text);
    const hasSeparator = /[\u00b7\u2022|]|\s[-–—]\s/.test(text);
    // Marketplace's seller inbox does not consistently render the listing
    // title in every row.  New/unread threads can be reduced to just the
    // buyer name plus a preview (for example "Attachment Unavailable") while
    // the listing context is only available after opening the thread.  On the
    // dedicated /marketplace/inbox route those rows are still safe candidates;
    // requiring a vehicle year here prevented the extension from ever opening
    // the buyer's first message.
    const hasConversationSignals = hasVehicle || hasMarketplace || hasUnreadSignal || hasSeparator || hasPreview;
    if (!hasConversationSignals) return -1;
    // A Marketplace row contains a listing/buyer label and usually a preview;
    // require one of those signals so sidebar links cannot open as chats.
    if (!hasPreview && !hasSeparator) return -1;
    return (hasVehicle ? 100 : 0) + (hasUnreadSignal ? 40 : 0) + (hasPreview ? 20 : 0) + (hasSeparator ? 10 : 0);
  }

  function findInboxConversationCandidates({ document, location } = {}) {
    if (!isMarketplaceInboxRoute(location)) return [];
    const selector = [
      'a[href*="/marketplace/"]',
      '[role="link"]',
      '[role="button"]',
      'button',
    ].join(", ");
    const raw = Array.from(document?.querySelectorAll?.(selector) || []);
    const candidates = [];
    const seen = new Set();
    for (const node of raw) {
      if (!isClickableInboxNode(node)) continue;
      let candidate = node;
      let parent = node.parentElement;
      while (parent && parent !== document?.body && parent !== document?.documentElement) {
        const parentScore = inboxCandidateScore(parent);
        const nodeScore = inboxCandidateScore(candidate);
        if (parentScore >= nodeScore && inboxCandidateText(parent).length <= 360) candidate = parent;
        parent = parent.parentElement;
      }
      const score = inboxCandidateScore(candidate);
      if (score < 0 || seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push({
        element: candidate,
        text: inboxCandidateText(candidate),
        score,
        order: candidates.length,
        key: [
          candidate.getAttribute?.("href") || "",
          candidate.getAttribute?.("aria-label") || "",
          inboxCandidateText(candidate),
        ].join("|").slice(0, 500),
      });
    }
    return candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  }

  function findInboxConversationCandidate(options = {}) {
    return findInboxConversationCandidates(options)[0] || null;
  }

  function findThreadRoot({ document, location }) {
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
          const composers = Array.from(candidate.querySelectorAll?.(COMPOSER_SELECTORS.join(", ")) || [])
            .filter(isComposer);
          candidates.push({ root: candidate, focused: composers.includes(document?.activeElement) });
        }
      }
    }
    const composerRoots = [];
    for (const composer of Array.from(document?.querySelectorAll?.(COMPOSER_SELECTORS.join(", ")) || []).filter(isComposer)) {
      let parent = composer.parentElement;
      while (parent && parent !== document.documentElement) {
        if (isVisible(parent) && hasComposer(parent) && hasMarketplaceEvidence(parent, marketplaceRoute)) {
          composerRoots.push({ root: parent, focused: composer === document?.activeElement });
          break;
        }
        parent = parent.parentElement;
      }
    }
    const seen = new Set();
    return [...candidates, ...composerRoots]
      .filter(({ root }) => {
        if (seen.has(root)) return false;
        seen.add(root);
        return true;
      })
      .sort((left, right) => {
        if (left.focused !== right.focused) return left.focused ? -1 : 1;
        const a = rectOf(left.root); const b = rectOf(right.root);
        const areaDifference = (a.width * a.height) - (b.width * b.height);
        return areaDifference || b.right - a.right;
      })[0]?.root || null;
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
    const text = String(match?.[2] || match?.[1] || textOf(element)).trim();
    if (!text || UI_TEXT.test(text) || text.length > 500) return null;
    const sender = match?.[1] || "";
    const isDealer = senderIsDealer(sender, sellerNameCandidates) || /\b(?:by\s+you|por\s+t[iú])\b/i.test(descriptor);
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
      const text = textOf(element);
      if (!text || text.length < 2 || text.length > 500 || UI_TEXT.test(text)) return false;
      return !element.querySelector?.('a[href*="/marketplace/item/"], button, [role="button"], [contenteditable="true"], textarea');
    });
  }

  function readVisualMessages(scope, buyerName) {
    const scopeRect = rectOf(scope);
    const seen = new Set();
    const rows = [];
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
      const text = cleanControlText(textOf(bubble));
      const rect = rectOf(bubble);
      if (!text || text.length < 2 || UI_TEXT.test(text) || looksLikeVehicleTitle(text)) continue;
      const scopeCenter = scopeRect.left + (scopeRect.width / 2);
      const bubbleCenter = rect.left + (rect.width / 2);
      const directionThreshold = Math.max(12, Math.min(48, scopeRect.width * 0.04));
      const direction = bubbleCenter > scopeCenter + directionThreshold
        ? "dealer"
        : bubbleCenter < scopeCenter - directionThreshold
          ? "buyer"
          : "unknown";
      if (direction === "unknown") continue;
      rows.push({
        top: rect.top,
        speaker: direction === "dealer" ? "Dealer" : (buyerName || "Buyer"),
        text,
      });
    }
    return rows.sort((a, b) => a.top - b.top).map(({ speaker, text }) => ({ speaker, text }));
  }

  function findThreadIdentity(root, scope) {
    for (const node of [root, scope].filter(Boolean)) {
      for (const attribute of ["data-thread-id", "data-conversation-id", "data-thread-key", "data-fb-thread-id", "id"]) {
        const value = node.getAttribute?.(attribute) || "";
        if (value && !/^(?:mwthread|conversation|message|messenger-thread)$/i.test(value)) return value.slice(0, 180);
      }
      const href = Array.from(node.querySelectorAll?.('a[href], [href]') || [])
        .map((element) => element.getAttribute?.("href") || "")
        .find((value) => /(?:\/messages\/t\/|thread_id=|conversation_id=)/i.test(value));
      if (href) return href.slice(0, 180);
    }
    return "";
  }

  function capture({ document, location, sellerNameCandidates = [] }) {
    const root = findThreadRoot({ document, location });
    const scope = findMessageScope(root);
    const thread = inspectThread(root);
    const buyerName = thread.buyerName;
    const semantic = Array.from(scope?.querySelectorAll?.(STRUCTURED_MESSAGE_SELECTORS.join(", ")) || [])
      .filter(isVisible)
      .map((element) => parseDescriptor(element, sellerNameCandidates))
      .filter(Boolean);
    const messages = semantic.length ? semantic : scope ? readVisualMessages(scope, buyerName) : [];
    const inboundMessage = [...messages].reverse().find((message) => message.speaker !== "Dealer");
    return {
      root,
      scope,
      buyerName,
      messages,
      evidence: {
        threadRootDetected: !!root,
        messageScopeDetected: !!scope,
        messageCandidateCount: semantic.length || (scope ? bubbleTextCandidates(scope).length : 0),
        extractionMode: semantic.length ? "semantic" : messages.length ? "visual_bubbles" : "none",
        latestMessageDirection: messages.at(-1)?.speaker === "Dealer" ? "dealer" : messages.length ? "buyer" : "none",
        activeThreadRootSelector: selectorFor(root),
        sellerSurfaceDetected: thread.sellerSurfaceDetected,
        sellerSurfaceRejected: thread.sellerSurfaceRejected,
        sellerSurfaceEvidence: thread.sellerSurfaceEvidence,
        sellerContextTrusted: sellerContextIsTrusted(thread),
        cleanedThreadHeader: thread.cleanedThreadHeader,
        cleanedVehicleTitle: thread.cleanedVehicleTitle,
        inboundMessageText: inboundMessage?.text || "",
        threadIdentity: findThreadIdentity(root, scope),
      },
    };
  }

  globalThis.DealerPilotMessengerCapture = Object.freeze({
    capture,
    findThreadRoot,
    findMessageScope,
    readVisualMessages,
    inspectThread,
    sellerContextIsTrusted,
    cleanControlText,
    cleanVehicleTitle,
    findThreadIdentity,
    selectorFor,
    findInboxConversationCandidates,
    findInboxConversationCandidate,
  });
})();
