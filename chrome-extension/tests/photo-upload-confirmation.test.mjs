import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const publisherFlowSource = readFileSync(
  new URL("../src/content/facebook/publisherFlow.js", import.meta.url),
  "utf8",
);

function loadPhotoEvidenceHelpers() {
  const start = publisherFlowSource.indexOf("  function readFacebookPhotoCounter");
  const end = publisherFlowSource.indexOf("  async function waitForPhotoThumbnails", start);
  assert.ok(start >= 0 && end > start, "photo evidence helpers must remain extractable");

  const context = vm.createContext({});
  vm.runInContext(
    `${publisherFlowSource.slice(start, end)}\n` +
      "globalThis.__photoEvidence = {" +
      "readFacebookPhotoCounter," +
      "collectFacebookPhotoEvidence," +
      "compareFacebookPhotoEvidence," +
      "readExistingFacebookPhotoEvidence" +
      "};",
    context,
    { filename: "publisherFlow-photo-evidence.js" },
  );
  return context.__photoEvidence;
}

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.src = attributes.src || "";
    this.currentSrc = attributes.currentSrc || this.src;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === "src") {
      this.src = value;
      this.currentSrc = value;
    }
  }
}

class FakeRoot {
  constructor({ text = "", matches = new Map() } = {}) {
    this.body = { innerText: text };
    this.matches = matches;
  }

  querySelectorAll(selector) {
    return this.matches.get(selector) || [];
  }
}

test("the empty Add photos icon is not accepted as an uploaded thumbnail", () => {
  const helpers = loadPhotoEvidenceHelpers();
  const placeholder = new FakeElement({
    "aria-label": "Add photos",
    src: "https://static.xx.fbcdn.net/photo-placeholder.svg",
  });
  const root = new FakeRoot({
    text: "Photos 0/20",
    // This is the broad selector that previously produced the false positive.
    matches: new Map([['[aria-label*="photo" i] img', [placeholder]]]),
  });

  const snapshot = helpers.collectFacebookPhotoEvidence(root);
  const result = helpers.readExistingFacebookPhotoEvidence(root);
  assert.equal(snapshot.counter, 0);
  assert.equal(snapshot.nodes.size, 0);
  assert.equal(result.confirmed, false);
});

test("a newly rendered Facebook remove-photo control confirms a real preview", () => {
  const helpers = loadPhotoEvidenceHelpers();
  const baseline = helpers.collectFacebookPhotoEvidence(new FakeRoot());
  const removeControl = new FakeElement({ "aria-label": "Remove photo" });
  const current = helpers.collectFacebookPhotoEvidence(new FakeRoot({
    text: "1 photo",
    matches: new Map([['[aria-label*="remove photo" i]', [removeControl]]]),
  }));

  const result = helpers.compareFacebookPhotoEvidence(current, baseline);
  assert.equal(result.confirmed, true);
  assert.equal(result.count, 1);
  assert.equal(result.source, "photo_counter");
});

test("a reused preview node must change signature before it counts as new evidence", () => {
  const helpers = loadPhotoEvidenceHelpers();
  const preview = new FakeElement({
    "data-testid": "media-attachment-preview",
    style: "background-image: none",
  });
  const selector = '[data-testid="media-attachment-preview"]';
  const root = new FakeRoot({ matches: new Map([[selector, [preview]]]) });
  const baseline = helpers.collectFacebookPhotoEvidence(root);

  const unchanged = helpers.compareFacebookPhotoEvidence(
    helpers.collectFacebookPhotoEvidence(root),
    baseline,
  );
  assert.equal(unchanged.confirmed, false);

  preview.setAttribute("style", 'background-image: url("blob:facebook-photo")');
  const changed = helpers.compareFacebookPhotoEvidence(
    helpers.collectFacebookPhotoEvidence(root),
    baseline,
  );
  assert.equal(changed.confirmed, true);
  assert.equal(changed.source, "new_thumbnail_dom");
});

test("publishing waits for stable post-injection evidence and rejects broad placeholders", () => {
  const helperStart = publisherFlowSource.indexOf("  function readFacebookPhotoCounter");
  const waitEnd = publisherFlowSource.indexOf("  // ── Auto-retry helper", helperStart);
  const photoConfirmationSource = publisherFlowSource.slice(helperStart, waitEnd);
  const uploadStart = publisherFlowSource.indexOf("  async function uploadPhotos");
  const uploadEnd = publisherFlowSource.indexOf("  function readFacebookPhotoCounter", uploadStart);
  const uploadSource = publisherFlowSource.slice(uploadStart, uploadEnd);

  assert.match(photoConfirmationSource, /PHOTO_CONFIRMATION_STABLE_MS = 750/);
  assert.match(photoConfirmationSource, /compareFacebookPhotoEvidence/);
  assert.doesNotMatch(photoConfirmationSource, /\[aria-label\*="photo" i\] img/);
  assert.doesNotMatch(photoConfirmationSource, /data-visualcompletion/);
  assert.doesNotMatch(photoConfirmationSource, /img\[style\*="object-fit"\]/);
  assert.ok(
    uploadSource.indexOf("const photoEvidenceBaseline") < uploadSource.indexOf("input.files = dt.files"),
    "the pre-upload DOM baseline must be captured before files are injected",
  );
  assert.match(uploadSource, /waitForPhotoThumbnails\([\s\S]*photoEvidenceBaseline/);
});
