import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const queueSource = readFileSync(
  new URL("../src/background/queueClient.js", import.meta.url),
  "utf8",
);
const themeSource = readFileSync(
  new URL("../src/shared/theme.js", import.meta.url),
  "utf8",
);

test("Publisher resolves dealer settings and heartbeat identity by browser window", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const popup = readFileSync(new URL("../popup/modules/uiActions.js", import.meta.url), "utf8");

  assert.ok(manifest.permissions.includes("windows"));
  assert.match(queueSource, /publisherSettingsWindow:/);
  assert.match(queueSource, /chrome\.windows\?\.getCurrent/);
  assert.match(queueSource, /dealerId: settings\.dealerId/);
  assert.match(queueSource, /sessionId: settings\.sessionId/);
  assert.match(popup, /type: "GET_SETTINGS"/);
  assert.match(popup, /type: "SAVE_SETTINGS"/);
});

function createThemeHarness({ storage, windowId, dealerId, themes }) {
  const chrome = {
    runtime: {
      sendMessage(message, callback) {
        assert.equal(message.type, "GET_SETTINGS");
        callback({ ok: true, data: { backendUrl: "https://app.1987dealerpilot.com", dealerId, windowId } });
      },
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: storage[key] };
          return Object.fromEntries(key.map((entry) => [entry, storage[entry]]));
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
  };
  const context = vm.createContext({
    chrome,
    fetch: async (url) => ({ ok: true, async json() { return themes[dealerId]; } }),
    URL,
    Date,
    setInterval() {},
  });
  vm.runInContext(themeSource, context, { filename: "theme.js" });
  return context.DealerPilotTheme;
}

test("Publisher Dealer DNA colors stay separate by browser window", async () => {
  const storage = {};
  const themes = {
    1: { dealerId: 1, primaryColors: ["#d97706"], secondaryColors: ["#172554"], accentColors: ["#22c55e"] },
    2: { dealerId: 2, primaryColors: ["#0e7490"], secondaryColors: ["#164e63"], accentColors: ["#f97316"] },
  };
  const alpha = createThemeHarness({ storage, windowId: 11, dealerId: 1, themes });
  const secondDealer = createThemeHarness({ storage, windowId: 22, dealerId: 2, themes });

  await alpha.loadAndApply();
  await secondDealer.loadAndApply();

  assert.equal(storage["dealerTheme:11"].primary, "#d97706");
  assert.equal(storage["dealerTheme:22"].primary, "#0e7490");
  assert.equal(storage.dealerTheme, undefined);
});
