import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/background/messengerClient.js", import.meta.url),
  "utf8",
);
const popupSource = readFileSync(
  new URL("../popup/popup.js", import.meta.url),
  "utf8",
);

function createHarness(windowId = 47) {
  const storage = {};
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: storage[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          return { ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    windows: {
      async getCurrent() {
        return { id: windowId };
      },
      async getAll() {
        return [{ id: windowId }];
      },
    },
    tabs: {
      async query() {
        return [];
      },
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} },
    },
  };
  const context = vm.createContext({
    chrome,
    DealerPilotMessengerApiClient: { async apiPost() { return {}; } },
    crypto: { randomUUID: () => "messenger-settings-test" },
    Date,
    console: { warn() {}, log() {}, error() {} },
  });
  vm.runInContext(source, context, { filename: "messengerClient.js" });
  return { handlers: context.DealerPilotMessengerHandlers, storage };
}

test("auto reply settings survive save and reload in the active window", async () => {
  const { handlers, storage } = createHarness();
  const sender = { tab: { windowId: 47 } };

  await handlers.SAVE_SETTINGS({
    dryRun: false,
    autoReplyEnabled: true,
    dealerId: 1,
    sessionId: "alpha",
  }, sender);

  const reloadedSettings = await handlers.GET_SETTINGS({}, sender);
  const debugState = await handlers.GET_DEBUG_STATE({}, sender);

  assert.equal(reloadedSettings.dryRun, false);
  assert.equal(reloadedSettings.autoReplyEnabled, true);
  assert.equal(debugState.settings.dryRun, false);
  assert.equal(debugState.settings.autoReplyEnabled, true);
  assert.equal(storage["messengerSettingsWindow:47"].dryRun, false);
  assert.equal(storage["messengerSettingsWindow:47"].autoReplyEnabled, true);
});

test("popup always addresses settings to the current browser window", () => {
  assert.match(popupSource, /GET_SETTINGS", windowId/);
  assert.match(popupSource, /GET_DEBUG_STATE", windowId/);
  assert.match(popupSource, /type: "SAVE_SETTINGS",\n\s+windowId,/);
});
