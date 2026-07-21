(function () {
  const DEBUG_STORAGE_KEY = "debugMode";

  async function isDebugEnabled() {
    try {
      const result = await chrome.storage.local.get(DEBUG_STORAGE_KEY);
      return result[DEBUG_STORAGE_KEY] === true;
    } catch (_) {
      return false;
    }
  }

  function info(...args) {
    console.log("[DealerPilot AI]", ...args);
  }

  function warn(...args) {
    console.warn("[DealerPilot AI]", ...args);
  }

  function error(...args) {
    console.error("[DealerPilot AI]", ...args);
  }

  async function debug(...args) {
    if (await isDebugEnabled()) {
      console.debug("[DealerPilot AI][DEBUG]", ...args);
    }
  }

  globalThis.DealerPilotLogger = { debug, error, info, isDebugEnabled, warn };
})();
