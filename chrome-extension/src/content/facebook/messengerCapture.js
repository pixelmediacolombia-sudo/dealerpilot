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

  const UI_TEXT = /^(?:marketplace|see details|ver detalles|more options|m[aá]s opciones|send a quick response|tap a response|enviar una respuesta|write to|escribe a|search|buscar|inbox|bandeja de entrada|selling|selling|buying|comprando|vendiendo)$/i;

  function textOf(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
          break;
        }
        parent = parent.parentElement;
      }
    }
    return [...candidates, ...composerRoots]
      .sort((left, right) => {
        const a = rectOf(left); const b = rectOf(right);
        return (a.width * a.height) - (b.width * b.height);
      })[0] || null;
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
      const text = textOf(bubble);
      const rect = rectOf(bubble);
      if (!text || text.length < 2 || UI_TEXT.test(text)) continue;
      const leftGap = Math.max(0, rect.left - scopeRect.left);
      const rightGap = Math.max(0, scopeRect.right - rect.right);
      rows.push({ top: rect.top, speaker: rightGap + 12 < leftGap ? "Dealer" : (buyerName || "Buyer"), text });
    }
    return rows.sort((a, b) => a.top - b.top).map(({ speaker, text }) => ({ speaker, text }));
  }

  function extractBuyerName(root) {
    const heading = root?.querySelector?.('[role="heading"], h1, h2, h3, [aria-level]');
    const fallback = root?.getAttribute?.("aria-label") || "";
    const value = textOf(heading) || (/marketplace|conversation|conversaci\u00f3n/i.test(fallback) ? "" : fallback);
    return value.split(/\s+[\u00b7\u2022|]\s+/)[0].trim();
  }

  function capture({ document, location, sellerNameCandidates = [] }) {
    const root = findThreadRoot({ document, location });
    const scope = findMessageScope(root);
    const buyerName = extractBuyerName(root);
    const semantic = Array.from(scope?.querySelectorAll?.(STRUCTURED_MESSAGE_SELECTORS.join(", ")) || [])
      .filter(isVisible)
      .map((element) => parseDescriptor(element, sellerNameCandidates))
      .filter(Boolean);
    const messages = semantic.length ? semantic : scope ? readVisualMessages(scope, buyerName) : [];
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
      },
    };
  }

  globalThis.DealerPilotMessengerCapture = Object.freeze({
    capture,
    findThreadRoot,
    findMessageScope,
    readVisualMessages,
  });
})();
