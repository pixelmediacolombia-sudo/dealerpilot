import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoots = [
  "manifest.json",
  "background.js",
  "content",
  "popup",
  "src",
].map((entry) => join(root, entry));

function listTextFiles(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === "icons") continue;
      entries.push(...listTextFiles(path));
    } else if (/\.(?:js|json|html|css|mjs|md)$/i.test(name)) {
      entries.push(path);
    }
  }
  return entries;
}

test("Messenger AI extension contains no publishing endpoints or vehicle publishing modules", () => {
  const files = runtimeRoots.flatMap((entry) => statSync(entry).isDirectory() ? listTextFiles(entry) : [entry]);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");

  assert.doesNotMatch(source, /\/api\/publishing\/jobs/i);
  assert.doesNotMatch(source, /marketplace\/create\/vehicle/i);
  assert.doesNotMatch(source, /photoUploader|photoProxy|formFiller|publisherFlow/i);
  assert.doesNotMatch(source, /CLAIM_JOB|COMPLETE_JOB|POLL_ASSIGNED_JOB/i);
  assert.match(source, /\/api\/conversations\/intake/);
});

test("manifest loads only Messenger AI runtime files", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);

  assert.equal(manifest.name, "DealerPilot Messenger AI");
  assert.deepEqual(scripts, [
    "src/shared/theme.js",
    "src/content/facebook/messengerCapture.js",
    "src/content/facebook/messengerAutonomy.js",
    "src/content/facebook/messengerAi.js",
    "content/content.js",
  ]);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://www.facebook.com/messages*",
    "https://web.facebook.com/messages*",
    "https://facebook.com/messages*",
    "https://www.facebook.com/marketplace/inbox*",
    "https://web.facebook.com/marketplace/inbox*",
    "https://facebook.com/marketplace/inbox*",
  ]);
  assert.equal(manifest.background.service_worker, "background.js");
});

test("Publisher runtime no longer contains Messenger AI handlers", () => {
  const publisherFiles = [
    "chrome-extension/manifest.json",
    "chrome-extension/src/background/queueClient.js",
    "chrome-extension/src/content/facebook/publisherFlow.js",
    "chrome-extension/popup/popup.html",
    "chrome-extension/popup/modules/uiActions.js",
  ].map((file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")).join("\n");

  assert.doesNotMatch(publisherFiles, /CONVERSATION_INTAKE|SEND_MESSAGE_CONTEXT|MESSENGER_CAPTURE_DEBUG/);
  assert.doesNotMatch(publisherFiles, /MESSENGER_CLAIM_AVAILABILITY_ACTION|GET_CONVERSATION_LEAD/);
  assert.doesNotMatch(publisherFiles, /lastMessengerCaptureDebug|lastMessengerDetectionDebug|messengerDetected/);
  assert.doesNotMatch(publisherFiles, /Read Chat|Suggested reply|AI auto reply sent/);
});
