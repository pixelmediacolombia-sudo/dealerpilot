import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Alpha Page Publisher is isolated from Marketplace URLs", () => {
  const manifest = JSON.parse(read("../manifest.json"));
  assert.equal(manifest.name, "DealerPilot Alpha Page Publisher");
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://business.facebook.com/latest/composer*"]);

  const background = read("../src/background/pagePublisher.js");
  assert.match(background, /business\.facebook\.com\/latest\/composer/);
  assert.doesNotMatch(background, /marketplace\/create\/vehicle/);
});

test("content script refuses to click Publish automatically", () => {
  const content = read("../content/content.js");
  assert.match(content, /Human review is required before Publish/);
  assert.match(content, /manually click Publish/);
  assert.match(content, /waitForComposerTarget/);
  assert.doesNotMatch(content, /\.click\(\)[\s\S]{0,120}(Publish|publish)/);
});

test("popup uses Alpha page payload endpoints", () => {
  const popup = read("../popup/popup.js");
  assert.match(popup, /\/api\/alpha-page-publisher\/vehicles\?limit=30/);
  assert.match(popup, /\/api\/alpha-page-publisher\/vehicles\/\$\{vehicleId\}\/payload/);
  assert.match(popup, /OPEN_ALPHA_COMPOSER/);
});

test("popup exposes normal and JSON debuggers", () => {
  const html = read("../popup/popup.html");
  const popup = read("../popup/popup.js");
  const background = read("../src/background/pagePublisher.js");
  assert.match(html, /Alpha Debugger/);
  assert.match(html, /id="jsonDebug"/);
  assert.match(popup, /GET_DEBUG_STATE/);
  assert.match(background, /lastAlphaPageDraftDebug/);
  assert.match(background, /lastAlphaPageError/);
});
