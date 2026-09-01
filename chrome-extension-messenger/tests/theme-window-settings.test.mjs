import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/shared/theme.js", import.meta.url),
  "utf8",
);

function createThemeHarness({ storage, windowId, themes }) {
  const chrome = {
    runtime: {
      sendMessage(message, callback) {
        assert.equal(message.type, "GET_SETTINGS");
        callback({
          ok: true,
          data: {
            backendUrl: "https://app.1987dealerpilot.com",
            dealerId: windowId === 11 ? 1 : 2,
            windowId,
          },
        });
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
    fetch: async (url) => ({
      ok: true,
      async json() {
        const dealerId = Number(new URL(url).pathname.split("/").at(-2));
        return themes[dealerId];
      },
    }),
    URL,
    Date,
    setInterval() {},
  });
  vm.runInContext(source, context, { filename: "theme.js" });
  return context.DealerPilotTheme;
}

test("Dealer DNA theme cache is isolated by browser window", async () => {
  const storage = {};
  const themes = {
    1: { dealerId: 1, primaryColors: ["#d97706"], secondaryColors: ["#172554"], accentColors: ["#22c55e"] },
    2: { dealerId: 2, primaryColors: ["#0e7490"], secondaryColors: ["#164e63"], accentColors: ["#f97316"] },
  };
  const alpha = createThemeHarness({ storage, windowId: 11, themes });
  const secondDealer = createThemeHarness({ storage, windowId: 22, themes });

  const alphaTheme = await alpha.loadAndApply();
  const secondDealerTheme = await secondDealer.loadAndApply();

  assert.equal(alphaTheme.dealerId, 1);
  assert.equal(secondDealerTheme.dealerId, 2);
  assert.equal(storage["dealerTheme:11"].primary, "#d97706");
  assert.equal(storage["dealerTheme:22"].primary, "#0e7490");
  assert.equal(storage.dealerTheme, undefined);
});
