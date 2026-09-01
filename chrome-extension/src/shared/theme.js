(function () {
  "use strict";

  const DEFAULT_BACKEND_URL = "https://app.1987dealerpilot.com";
  const THEME_STORAGE_KEY = "dealerTheme";
  const REFRESH_MS = 30 * 1000;

  function storageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  function themeStorageKey(settings = {}) {
    const id = Number(settings.windowId);
    return Number.isInteger(id) && id >= 0 ? THEME_STORAGE_KEY + ":" + id : THEME_STORAGE_KEY;
  }

  function normalizeThemeBackendUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  const DEFAULT_THEME = {
    primaryColors: ["#7658d6"],
    secondaryColors: ["#20243b"],
    accentColors: ["#42b883"],
  };

  function normalizeHexColor(value) {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    const hex = match[1].toLowerCase();
    return "#" + (hex.length === 3 ? hex.split("").map((channel) => channel + channel).join("") : hex);
  }

  function firstColor(values, fallback) {
    return Array.isArray(values) && values.map(normalizeHexColor).find(Boolean) || fallback;
  }

  function hexToHsl(hex) {
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255);
    const [r, g, b] = channels;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) return [0, 0, lightness];
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return [hue / 6, saturation, lightness];
  }

  function withLightness(hex, lightness) {
    const [hue, saturation] = hexToHsl(hex);
    const channel = (value) => Math.round(value * 100);
    return `hsl(${Math.round(hue * 360)} ${channel(saturation)}% ${channel(lightness)}%)`;
  }

  function mixWithWhite(hex, amount) {
    const value = hex.slice(1);
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    return "#" + channels.map((channel) => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, "0")).join("");
  }

  function readableForeground(hex) {
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16));
    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return luminance > 150 ? "#24283b" : "#ffffff";
  }

  function normalizeTheme(payload) {
    const primary = firstColor(payload && payload.primaryColors, DEFAULT_THEME.primaryColors[0]);
    const secondary = firstColor(payload && payload.secondaryColors, DEFAULT_THEME.secondaryColors[0]);
    const accent = firstColor(payload && payload.accentColors, DEFAULT_THEME.accentColors[0]);
    const primaryDark = firstColor(payload && payload.primaryColors && payload.primaryColors.slice(1), withLightness(primary, 0.38));
    const navy = withLightness(secondary, 0.16);
    const navyDeep = firstColor(payload && payload.secondaryColors && payload.secondaryColors.slice(1), withLightness(secondary, 0.10));
    return {
      primary,
      primaryDark,
      primarySoft: mixWithWhite(primary, 0.9),
      primaryForeground: readableForeground(primary),
      secondary: navy,
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
      "--dp-violet-foreground": theme.primaryForeground,
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

  async function extensionSettings() {
    const runtime = globalThis.chrome?.runtime;
    if (runtime?.sendMessage) {
      try {
        const response = await new Promise((resolve) => {
          runtime.sendMessage({ type: "GET_SETTINGS" }, (result) => resolve(result || null));
        });
        if (response?.ok && response.data) return response.data;
      } catch {}
    }
    const storage = storageArea();
    return storage ? storage.get(["backendUrl", "dealerId"]) : {};
  }

  async function backendUrl(settings = null) {
    const current = settings || await extensionSettings();
    return normalizeThemeBackendUrl(current.backendUrl) || DEFAULT_BACKEND_URL;
  }

  async function dealerId(settings = null) {
    const current = settings || await extensionSettings();
    const value = Number(current.dealerId);
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  async function fetchTheme(settings = null) {
    const current = settings || await extensionSettings();
    const base = await backendUrl(current);
    const id = await dealerId(current);
    const response = await fetch(base + "/api/dealers/" + encodeURIComponent(id) + "/theme", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Theme request failed: " + response.status);
    return normalizeTheme(await response.json());
  }

  async function loadAndApply() {
    const storage = storageArea();
    const settings = await extensionSettings();
    const themeKey = themeStorageKey(settings);
    const cached = storage ? await storage.get(themeKey) : {};
    if (cached[themeKey]) {
      applyTheme(normalizeTheme(cached[themeKey]));
    }
    try {
      const theme = await fetchTheme(settings);
      if (storage) await storage.set({
        [themeKey]: Object.assign({}, theme, { fetchedAt: new Date().toISOString() }),
      });
      applyTheme(theme);
      return theme;
    } catch (error) {
      return cached[themeKey] ? normalizeTheme(cached[themeKey]) : null;
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
