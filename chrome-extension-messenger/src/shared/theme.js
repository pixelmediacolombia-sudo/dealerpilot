(function () {
  "use strict";

  const DEFAULT_BACKEND_URL = "https://1987dealerpilot.com";
  const DEFAULT_THEME = {
    primaryColors: ["#7658d6"],
    secondaryColors: ["#20243b"],
    accentColors: ["#42b883"],
  };
  const THEME_STORAGE_KEY = "dealerTheme";
  const REFRESH_MS = 5 * 60 * 1000;

  function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  function firstColor(values, fallback) {
    return Array.isArray(values) && values.find(isHexColor) || fallback;
  }

  function adjustColor(hex, amount) {
    if (!isHexColor(hex)) return hex;
    const value = hex.slice(1);
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    return "#" + channels.map((channel) => Math.max(0, Math.min(255, channel + amount)).toString(16).padStart(2, "0")).join("");
  }

  function normalizeTheme(payload) {
    const primary = firstColor(payload && payload.primaryColors, DEFAULT_THEME.primaryColors[0]);
    const secondary = firstColor(payload && payload.secondaryColors, DEFAULT_THEME.secondaryColors[0]);
    const accent = firstColor(payload && payload.accentColors, DEFAULT_THEME.accentColors[0]);
    const primaryDark = firstColor(payload && payload.primaryColors && payload.primaryColors.slice(1), adjustColor(primary, -26));
    const navyDeep = firstColor(payload && payload.secondaryColors && payload.secondaryColors.slice(1), adjustColor(secondary, -22));
    return {
      primary,
      primaryDark,
      primarySoft: adjustColor(primary, 145),
      secondary,
      navyDeep,
      accent,
      dealerId: Number.isInteger(payload && payload.dealerId) ? payload.dealerId : 1,
      dealerName: typeof (payload && payload.dealerName) === "string" ? payload.dealerName : null,
      logoUrl: typeof (payload && payload.logoUrl) === "string" ? payload.logoUrl : null,
    };
  }

  function targetElement() {
    if (typeof document === "undefined") return null;
    if (location.protocol === "chrome-extension:") return document.documentElement;
    return document.getElementById("mai-panel") || document.querySelector("[data-dealerpilot-theme]");
  }

  function applyTheme(theme, target) {
    const element = target || targetElement();
    if (!element || !element.style) return false;
    const values = {
      "--dp-violet": theme.primary,
      "--dp-violet-dark": theme.primaryDark,
      "--dp-violet-soft": theme.primarySoft,
      "--dp-navy": theme.secondary,
      "--dp-navy-strong": theme.navyDeep,
      "--dp-navy-deep": theme.navyDeep,
      "--dp-accent": theme.accent,
    };
    Object.entries(values).forEach(([name, value]) => element.style.setProperty(name, value));
    if (theme.logoUrl && location.protocol === "chrome-extension:") {
      element.style.setProperty("--dp-logo-url", "url(" + JSON.stringify(theme.logoUrl) + ")");
    }
    return true;
  }

  async function backendUrl() {
    const stored = await chrome.storage.local.get("backendUrl");
    return (stored.backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  }

  async function dealerId() {
    const stored = await chrome.storage.local.get("dealerId");
    const value = Number(stored.dealerId);
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  async function fetchTheme() {
    const base = await backendUrl();
    const id = await dealerId();
    const response = await fetch(base + "/api/dealers/" + encodeURIComponent(id) + "/theme", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Theme request failed: " + response.status);
    return normalizeTheme(await response.json());
  }

  async function loadAndApply() {
    const cached = await chrome.storage.local.get(THEME_STORAGE_KEY);
    if (cached[THEME_STORAGE_KEY]) {
      applyTheme(normalizeTheme(cached[THEME_STORAGE_KEY]));
    }
    try {
      const theme = await fetchTheme();
      await chrome.storage.local.set({
        [THEME_STORAGE_KEY]: Object.assign({}, theme, { fetchedAt: new Date().toISOString() }),
      });
      applyTheme(theme);
      return theme;
    } catch (error) {
      return cached[THEME_STORAGE_KEY] ? normalizeTheme(cached[THEME_STORAGE_KEY]) : null;
    }
  }

  let refreshInFlight = null;
  const guardedLoadAndApply = () => {
    if (!refreshInFlight) {
      refreshInFlight = loadAndApply().finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  };

  const api = Object.freeze({ applyTheme, loadAndApply: guardedLoadAndApply, normalizeTheme });
  globalThis.DealerPilotTheme = api;

  if (typeof document !== "undefined") {
    const run = () => { void guardedLoadAndApply(); };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }

    if (location.protocol !== "chrome-extension:") {
      const observer = new MutationObserver(() => {
        if (targetElement()) void loadAndApply();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    globalThis.setInterval(run, REFRESH_MS);
  }
})();
