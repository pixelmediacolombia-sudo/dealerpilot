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

function createHarness(windowId = 47, storage = {}) {
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
    autoReplyEnabled: true,
    dealerId: 1,
    sessionId: "alpha",
  }, sender);

  const reopenedPopup = createHarness(47, storage);
  const reloadedSettings = await reopenedPopup.handlers.GET_SETTINGS({}, sender);
  const debugState = await reopenedPopup.handlers.GET_DEBUG_STATE({}, sender);

  assert.equal(reloadedSettings.autoReplyEnabled, true);
  assert.equal(debugState.settings.autoReplyEnabled, true);
  assert.equal(storage["messengerSettingsWindow:47"].autoReplyEnabled, true);
});

test("a pre-isolation dealer session remains usable and migrates on first window save", async () => {
  const storage = {
    backendUrl: "https://app.1987dealerpilot.com",
    dealerId: 7,
    sessionId: "legacy-alpha-session",
    sellerProfileNames: ["Legacy Alpha"],
    autoReplyEnabled: true,
  };
  const firstWindow = createHarness(47, storage);

  const beforeSave = await firstWindow.handlers.GET_SETTINGS({}, { tab: { windowId: 47 } });

  assert.equal(beforeSave.dealerId, 7);
  assert.equal(beforeSave.sessionId, "legacy-alpha-session");
  assert.deepEqual(beforeSave.sellerProfileNames, ["Legacy Alpha"]);
  assert.equal(beforeSave.autoReplyEnabled, true);

  await firstWindow.handlers.SAVE_SETTINGS({ autoReplyEnabled: true }, { tab: { windowId: 47 } });
  assert.equal(storage["messengerSettingsWindow:47"].sessionId, "legacy-alpha-session");

  const reopened = createHarness(47, storage);
  const afterSave = await reopened.handlers.GET_SETTINGS({}, { tab: { windowId: 47 } });
  assert.equal(afterSave.sessionId, "legacy-alpha-session");
  assert.deepEqual(afterSave.sellerProfileNames, ["Legacy Alpha"]);
});

test("reply mode stays enabled when the same profile uses another window", async () => {
  const storage = { autoReplyEnabled: false };
  const firstWindow = createHarness(47, storage);
  const secondWindow = createHarness(63, storage);

  await firstWindow.handlers.SAVE_SETTINGS({ dryRun: false, autoReplyEnabled: true }, { tab: { windowId: 47 } });
  const settings = await secondWindow.handlers.GET_SETTINGS({}, { tab: { windowId: 63 } });

  assert.equal(settings.autoReplyEnabled, true);
  assert.equal(storage["messengerSettingsWindow:63"], undefined);
});

test("each window id preserves its own reply mode after both popups close", async () => {
  const storage = {};
  const alpha = createHarness(47, storage);
  const secondDealer = createHarness(63, storage);

  await alpha.handlers.SAVE_SETTINGS({ autoReplyEnabled: true }, { tab: { windowId: 47 } });
  await secondDealer.handlers.SAVE_SETTINGS({ autoReplyEnabled: false }, { tab: { windowId: 63 } });

  const reopenedAlpha = createHarness(47, storage);
  const reopenedSecondDealer = createHarness(63, storage);
  const alphaSettings = await reopenedAlpha.handlers.GET_SETTINGS({}, { tab: { windowId: 47 } });
  const secondSettings = await reopenedSecondDealer.handlers.GET_SETTINGS({}, { tab: { windowId: 63 } });

  assert.equal(alphaSettings.autoReplyEnabled, true);
  assert.equal(secondSettings.autoReplyEnabled, false);
  assert.equal(storage["messengerSettingsWindow:47"].autoReplyEnabled, true);
  assert.equal(storage["messengerSettingsWindow:63"].autoReplyEnabled, false);
});

test("a missing window id never writes settings into window zero", async () => {
  const { handlers, storage } = createHarness(null, {});

  await assert.rejects(
    () => handlers.SAVE_SETTINGS({ autoReplyEnabled: true }, {}),
    /window_id_unavailable_settings_not_saved/,
  );
  assert.equal(storage["messengerSettingsWindow:0"], undefined);
  assert.equal(storage.autoReplyEnabled, undefined);
});

test("auto reply remains independent per session and accepts an explicit off state", async () => {
  const { handlers, storage } = createHarness(47, {});

  const settings = await handlers.SAVE_SETTINGS({
    autoReplyEnabled: false,
  }, { tab: { windowId: 47 } });

  assert.equal(settings.autoReplyEnabled, false);
  assert.equal(storage["messengerSettingsWindow:47"].autoReplyEnabled, false);
});

test("Messenger settings no longer expose a dry run control", () => {
  assert.doesNotMatch(popupSource, /dryRun|Dry run/);
});

test("popup always addresses settings to the current browser window", () => {
  assert.match(popupSource, /GET_SETTINGS", windowId/);
  assert.match(popupSource, /GET_DEBUG_STATE", windowId/);
  assert.match(popupSource, /type: "SAVE_SETTINGS",\n\s+windowId,/);
  assert.match(popupSource, /tabs\?\.query\?\.\(\{ active: true, currentWindow: true \}\)/);
  assert.match(popupSource, /await loadDebug\(windowId\)/);
  assert.match(popupSource, /settings\.autoReplyEnabled !== false/);
  assert.match(popupSource, /response\.data\?\.autoReplyEnabled !== false/);
  assert.match(popupSource, /settings_not_saved/);
});
