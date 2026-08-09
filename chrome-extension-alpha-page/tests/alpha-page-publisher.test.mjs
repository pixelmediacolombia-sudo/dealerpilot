import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("DealerPilot Page Publisher is isolated from Marketplace URLs", () => {
  const manifest = JSON.parse(read("../manifest.json"));
  assert.equal(manifest.name, "DealerPilot Page Publisher");
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
  assert.match(content, /nudgeComposerScroll/);
  assert.match(content, /getComposerDiagnostics/);
  assert.doesNotMatch(content, /\.click\(\)[\s\S]{0,120}(Publish|publish)/);
});

test("content script uploads photos before looking for Business Suite text field", () => {
  const content = read("../content/content.js");
  const fillDraft = content.slice(content.indexOf("async function fillDraft"));
  assert.ok(fillDraft.indexOf("await uploadPhotos(payload, backendUrl)") < fillDraft.indexOf("await waitForTextField()"));
});

test("photo input discovery accepts Meta file inputs without image attributes", () => {
  const content = read("../content/content.js");
  assert.match(content, /preferred \|\| inputs\[inputs\.length - 1\]/);
  assert.match(content, /collectSearchRoots/);
  assert.match(content, /element\.shadowRoot/);
  assert.match(content, /element\.contentDocument/);
  assert.match(content, /HTMLInputElement\.prototype, "files"/);
  assert.match(content, /"photos_assigned"/);
});

test("photo upload falls back to an intercepted trusted Business Suite file chooser", () => {
  const manifest = JSON.parse(read("../manifest.json"));
  const content = read("../content/content.js");
  const background = read("../src/background/pagePublisher.js");
  assert.ok(manifest.permissions.includes("debugger"));
  assert.ok(manifest.permissions.includes("downloads"));
  assert.match(content, /ALPHA_DEBUGGER_UPLOAD/);
  assert.match(background, /Page\.setInterceptFileChooserDialog/);
  assert.match(background, /Page\.fileChooserOpened/);
  assert.match(background, /DOM\.setFileInputFiles/);
  assert.match(background, /Input\.dispatchMouseEvent/);
});

test("Business Suite custom Facebook editor is revealed and filled through CDP", () => {
  const content = read("../content/content.js");
  const background = read("../src/background/pagePublisher.js");
  assert.match(content, /customize post for facebook and instagram/);
  assert.match(content, /ALPHA_DEBUGGER_CLICK/);
  assert.match(content, /ALPHA_DEBUGGER_FILL_TEXT/);
  assert.match(content, /findHiddenTextField/);
  assert.match(content, /clickTextRegion/);
  assert.match(content, /forceRevealTextField/);
  assert.match(content, /hidden_field_found/);
  assert.match(background, /async function dispatchTrustedClick/);
  assert.match(background, /async function fillTextThroughDebugger/);
  assert.match(background, /Input\.insertText/);
});

test("text field search reaches cross-origin composer frames through CDP", () => {
  const content = read("../content/content.js");
  const background = read("../src/background/pagePublisher.js");
  assert.match(background, /ALPHA_DEBUGGER_FIND_TEXT_FIELD/);
  assert.match(background, /Page\.getFrameTree/);
  assert.match(background, /Runtime\.evaluate/);
  assert.match(background, /securityOrigin !== mainOrigin/);
  assert.match(content, /findTextFieldAcrossFrames/);
  assert.match(content, /cross_frame_search/);
  assert.match(content, /auditIframes/);
});

test("composer can be diagnosed with frame tree, hints, history, and screenshots", () => {
  const content = read("../content/content.js");
  const background = read("../src/background/pagePublisher.js");
  const popup = read("../popup/popup.js");
  assert.match(background, /ALPHA_DEBUGGER_FRAME_TREE/);
  assert.match(background, /ALPHA_DEBUGGER_CAPTURE/);
  assert.match(background, /Page\.captureScreenshot/);
  assert.match(background, /alphaPageDebugHistory/);
  assert.match(background, /lastAlphaPageScreenshot/);
  assert.match(content, /text_hint_clicking/);
  assert.match(content, /tryClickHint/);
  assert.match(content, /syntheticField/);
  assert.match(content, /buildDomDump/);
  assert.match(content, /findHiddenTextFieldCandidates/);
  assert.match(content, /describeTextFieldAncestors/);
  assert.match(content, /textAncestors/);
  assert.match(popup, /showScreenshot/);
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
