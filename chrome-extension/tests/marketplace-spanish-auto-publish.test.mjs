import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const content = readFileSync(
  new URL("../src/content/facebook/publisherFlow.js", import.meta.url),
  "utf8",
);
const queueClient = readFileSync(
  new URL("../src/background/queueClient.js", import.meta.url),
  "utf8",
);
const photoProxy = readFileSync(
  new URL("../src/background/photoProxy.js", import.meta.url),
  "utf8",
);

test("Marketplace filler recognizes Spanish vehicle form labels", () => {
  for (const keyword of [
    "a\u00f1o",
    "marca",
    "modelo",
    "precio",
    "descripci\u00f3n",
    "ubicaci\u00f3n",
    "millaje",
    "carrocer\u00eda",
    "color exterior",
    "color interior",
    "tipo de combustible",
    "transmisi\u00f3n",
    "estado del veh\u00edculo",
    "t\u00edtulo limpio",
  ]) {
    assert.match(content, new RegExp(keyword, "i"), `missing Spanish keyword: ${keyword}`);
  }
});

test("Marketplace vehicle type matches Spanish car-truck options without warning fallback", () => {
  const aliasesStart = content.indexOf("const CAR_ALIASES = [");
  const aliasesEnd = content.indexOf("];", aliasesStart);
  const aliasesBlock = content.slice(aliasesStart, aliasesEnd);
  assert.match(aliasesBlock, /"auto\/camioneta"/);
  assert.match(aliasesBlock, /"camioneta"/);
  assert.match(content, /CAR_ALIASES\.includes\(needle\)/);
  assert.ok(
    aliasesStart < content.indexOf('No exact match for "${target}"', aliasesStart),
    "Spanish car/truck aliases must be considered before warning fallback",
  );
});

test("Photo proxy 5xx responses are skipped without extension error noise", () => {
  const responseOkStart = photoProxy.indexOf("if (!response.ok)");
  const contentTypeStart = photoProxy.indexOf("if (!contentType.toLowerCase()", responseOkStart);
  const responseOkBlock = photoProxy.slice(responseOkStart, contentTypeStart);
  assert.match(responseOkBlock, /return \{ skipped: true, retryable: response\.status >= 500/);
  assert.doesNotMatch(responseOkBlock, /console\.error/);
  assert.doesNotMatch(responseOkBlock, /throw new Error/);
  assert.match(content, /res\.data\?\.skipped \|\| !res\.data\?\.base64/);
  assert.match(content, /photo \$\{idx \+ 1\}: skipped/);
  assert.doesNotMatch(content, /console\.error\(`\[PHOTO\] proxy FAILED idx/);
});

test("Make can fall back to a text input instead of requiring a combobox", () => {
  assert.match(content, /fillTextOrSelectComboboxStep\s*\(/);
  assert.match(content, /"make"[\s\S]*\["make", "marca"\][\s\S]*\["make", "marca"\]/);
});

test("Year selection continues when Facebook renders make/model as text fields", () => {
  assert.match(content, /function makeModelTextFieldsAreVisible\(\)/);
  assert.match(content, /findField\(\["make", "marca"\]\)/);
  assert.match(content, /findField\(\["model", "modelo"\]\)/);
  assert.match(content, /Skipping next-combobox wait after year because make\/model text fields are already visible/);
});

test("Marketplace connection is ready on any Marketplace route", () => {
  assert.match(queueClient, /const marketplaceDetected = path\.includes\("\/marketplace"\)/);
  assert.match(queueClient, /marketplaceConnected: marketplaceDetected && !isLoginPage/);
  assert.match(content, /const marketplaceConnected = isMarketplaceNow && fbLoggedIn/);
  assert.doesNotMatch(queueClient, /marketplaceConnected: path\.startsWith\("\/marketplace\/create"\)/);
});

test("Auto publish can click localized Next and Publish buttons", () => {
  assert.match(content, /"siguiente"/);
  assert.match(content, /"continuar"/);
  assert.match(content, /"publicar"/);
  assert.match(content, /normalizeText\(el\.innerText \|\| el\.textContent \|\| ""\)/);
});

test("Color fields are treated as non-blocking when the form variant does not render them", () => {
  assert.match(content, /no color control rendered in this form variant/i);
  assert.match(content, /non-blocking/i);
  assert.match(content, /const effectiveMissed = missed\.filter\(\(m\) => fieldPresentOnPage\(m\)\)/);
  assert.match(content, /required fields not selected: \$\{effectiveMissed\.join\(", "\)\}/);
  assert.doesNotMatch(
    content,
    /required fields not selected: \$\{missed\.join\(", "\)\}/,
    "pre-Next validation must not block on raw missed color fields",
  );
  assert.match(content, /skippedMissingControls\.has\("exterior color"\)/);
  assert.match(content, /skippedMissingControls\.has\("interior color"\)/);
});

test("Required vehicle detail dropdowns have Spanish-safe fallbacks", () => {
  assert.match(content, /"used": \["used", "pre-owned", "usado", "usada", "bueno", "aceptable"\]/);
  assert.match(content, /"other": \["other", "otro", "otra", "automatic", "automatica", "transmision automatica"\]/);
  assert.match(content, /fill\.condition \|\| "Good"/);
  assert.match(content, /fill\.fuelType \|\| "Gasoline"/);
  assert.match(content, /fill\.transmission \|\| "Automatic"/);
  assert.match(content, /required vehicle details not selected: \$\{skippedVehicleDetailFields\.join\(", "\)\}/);
  assert.doesNotMatch(
    content,
    /Year and Make may not have been selected/,
    "disabled Next fallback must not blame Year/Make when those fields can already be filled",
  );
});

test("Marketplace clean-title checkbox is handled before Next validation", () => {
  assert.match(content, /function findCheckbox\(keywords\)/);
  assert.match(content, /async function checkCheckboxStep\(label, keywords, isRequired = false\)/);
  assert.match(content, /"clean title"[\s\S]*"titulo limpio"[\s\S]*"este vehiculo tiene titulo limpio"/);
  assert.match(content, /waitForEnabledButtonByText\(NEXT_TEXTS, 20000\)/);
  assert.match(content, /after waiting 20 seconds/);
});

test("Marketplace form state is settled and diagnosed before failing Next", () => {
  assert.match(content, /async function settleMarketplaceFormBeforeNext\(\)/);
  assert.match(content, /dispatchCommitEvents\(el\)/);
  assert.match(content, /await settleMarketplaceFormBeforeNext\(\)/);
  assert.match(content, /function collectDisabledNextDiagnostics\(\)/);
  assert.match(content, /lastNextDisabledDiagnostics/);
  assert.match(content, /Possible blocked controls:/);
});

test("Marketplace description supports Facebook textbox variants", () => {
  assert.match(content, /function setFieldValue\(el, value\)/);
  assert.match(content, /\[role="textbox"\]/);
  assert.match(content, /\[contenteditable="true"\]/);
  assert.match(content, /new InputEvent\("input"/);
  assert.match(content, /description field is visible but empty/);
});

test("Marketplace numeric fields cannot overwrite description textboxes", () => {
  assert.match(content, /function findField\(keywords, options = \{\}\)/);
  assert.match(content, /options\.inputOnly/);
  assert.match(content, /const inputOnly = label === "mileage" \|\| label === "price"/);
  assert.match(content, /waitForField\(keywords, 6000, \{ inputOnly \}\)/);
});

test("Marketplace description is reverified before auto-publish", () => {
  assert.match(content, /async function ensureDescriptionStep\(value\)/);
  assert.match(content, /Description changed or was overwritten - restoring before publish/);
  assert.match(content, /description: restored before publish after final field validation/);
  const ensureIndex = content.indexOf("await ensureDescriptionStep(fill.description)");
  const formCompleteIndex = content.indexOf('event: "form_complete"');
  const autoPublishIndex = content.indexOf("await autoPublishFlow(job");
  assert.ok(ensureIndex > -1, "ensureDescriptionStep call is missing");
  assert.ok(formCompleteIndex > ensureIndex, "description must be verified before form_complete");
  assert.ok(autoPublishIndex > ensureIndex, "description must be verified before autoPublishFlow");
});

test("Next diagnostics only flag exact empty dropdown placeholders", () => {
  assert.match(content, /const placeholderLike = new Set\(\[/);
  assert.match(content, /placeholderLike\.has\(text\)/);
  assert.match(content, /function hasMeaningfulDisplayedValue\(el, placeholderValues = \[\]\)/);
  assert.match(content, /visibleValueCandidates\(el\)/);
  assert.doesNotMatch(
    content,
    /text\.startsWith\(`\$\{p\} `\)/,
    "filled controls like Año 2021 must not be reported as blocked placeholders",
  );
});

test("Marketplace location selects autocomplete suggestions before validating Next", () => {
  assert.match(content, /function setFocusedFieldValue\(el, value\)/);
  assert.match(content, /async function fillLocationStep\(value\)/);
  assert.match(content, /location-suggestions/);
  assert.match(content, /va: "virginia"/);
  assert.match(content, /const optionScore = \(option\) =>/);
  assert.match(content, /firstLine === cityPart/);
  assert.match(content, /text\.includes\("lake "\)/);
  assert.match(content, /location suggestion selected/);
  assert.match(content, /no autocomplete suggestion matched/);
  assert.match(content, /await fillLocationStep\(fill\.location\)/);
  assert.doesNotMatch(
    content,
    /key: "ArrowDown"[\s\S]{0,300}key: "Enter"[\s\S]{0,300}location filled/,
    "location must not force Enter when no autocomplete suggestion was selected",
  );
});

test("Positive Facebook validation text is not treated as a blocking form error", () => {
  assert.match(content, /function scrapeFacebookErrors\(\)/);
  assert.match(content, /isNonBlockingValidationText/);
  assert.match(content, /valid\|valido\|valida/);
  assert.match(content, /invalid\|invalido\|invalida\|error\|required/);
  assert.match(content, /waitForEnabledButtonByText\(NEXT_TEXTS, 20000\)/);
  assert.match(content, /after waiting 20 seconds/);
});

test("Marketplace refuses to publish when the selected year does not verify", () => {
  assert.match(content, /function displayedComboboxMatchesTarget\(label, targetValue, el\)/);
  assert.match(content, /const years = text\.match/);
  assert.match(content, /Selected year does not match target/);
  assert.match(content, /Vehicle identity fields did not verify/);
  assert.match(content, /Refusing to click Next\/Publish/);
});

test("Successful publish wakes the queue for the next eligible job", () => {
  const completeIndex = content.indexOf('type: "COMPLETE_JOB"');
  const pollIndex = content.indexOf('type: "POLL_NOW"', completeIndex);
  const failIndex = content.indexOf('type: "FAIL_JOB"');
  assert.notEqual(completeIndex, -1, "COMPLETE_JOB call is missing");
  assert.notEqual(pollIndex, -1, "POLL_NOW call is missing");
  assert.ok(pollIndex > completeIndex, "POLL_NOW must only happen after completion succeeds");
  assert.ok(pollIndex > failIndex, "POLL_NOW must not be part of the failure path");
  assert.match(content, /Checking the queue for the next eligible job/);
  assert.match(content, /Claiming the next eligible job/);
});

test("Body style is required and truck inventory values map to Spanish Marketplace options", () => {
  assert.match(content, /"truck": \[[^\]]*"pickup truck"[^\]]*"camioneta tipo pickup"/);
  assert.match(content, /"body style"[\s\S]*bodyStyleValue[\s\S]*null,[\s\S]*true,/);
});

test("Form completion and enabled Next are reported before auto-clicking", () => {
  const formComplete = content.indexOf('event: "form_complete"');
  const nextEnabled = content.indexOf('event: "next_enabled"');
  const nextClick = content.indexOf('event: "next_clicked"');
  assert.ok(formComplete > -1, "form_complete progress event is missing");
  assert.ok(nextEnabled > formComplete, "next_enabled must follow form completion");
  assert.ok(nextClick > nextEnabled, "Next must only be reported clicked after it was enabled");
});

test("Incomplete vehicles move to review and the queue continues before Facebook opens", () => {
  assert.match(queueClient, /function findMissingMarketplaceFields\(payload\)/);
  assert.match(queueClient, /Missing required Marketplace data:/);
  assert.match(queueClient, /AUTO_START_SKIPPED_INCOMPLETE/);
  const preflightIndex = queueClient.indexOf("findMissingMarketplaceFields(payload)");
  const tabOpenIndex = queueClient.indexOf('logAudit("MARKETPLACE_TAB_OPENED"', preflightIndex);
  assert.ok(preflightIndex > -1 && tabOpenIndex > preflightIndex, "preflight must run before Facebook opens");
  assert.match(queueClient, /return handlers\.POLL_ASSIGNED_JOB\(\)/);
});

test("A repeated Facebook form failure is reviewed and wakes the next queue job", () => {
  assert.match(content, /retryCount >= 1[\s\S]*MARK_NEEDS_REVIEW[\s\S]*POLL_NOW/);
});

test("The next claimed vehicle reloads a clean Marketplace create form", () => {
  assert.match(queueClient, /chrome\.tabs\.update\(existing\.id, \{[\s\S]*url: MARKETPLACE_CREATE_URL,[\s\S]*active: true/);
  assert.match(queueClient, /MARKETPLACE_FORM_RELOADED_FOR_JOB/);
  assert.match(content, /MARK_NEEDS_REVIEW[\s\S]*window\.location\.replace\("https:\/\/www\.facebook\.com\/marketplace\/create\/vehicle"\)[\s\S]*POLL_NOW/);
});

test("Facebook Your Listings landing captures item URL before completing", () => {
  assert.match(content, /cur\.includes\("\/marketplace\/you\/selling"\)/);
  assert.match(content, /function findMarketplaceListingUrlOnPage\(job\)/);
  assert.match(content, /a\[href\*="\/marketplace\/item\/"\]/);
  assert.match(content, /function marketplaceTextMatchesExpectedListing\(text, expectedTokens\)/);
  assert.match(content, /async function findMarketplaceListingUrlFromSellerDialog\(job\)/);
  assert.match(content, /querySelectorAll\('\[role="dialog"\]'\)/);
  assert.match(content, /findMarketplaceListingUrlOnPage\(job\) \|\|[\s\S]*await findMarketplaceListingUrlFromSellerDialog\(job\)/);
  assert.match(content, /Facebook Your Listings did not expose a Marketplace item URL matching this vehicle/);
  assert.match(content, /publishedLanding: true/);
  assert.match(content, /outcome\.listingUrl \|\| outcome\.blockReason \|\| outcome\.publishedLanding/);
  assert.match(content, /type: "COMPLETE_JOB"[\s\S]*listingUrl/);
  assert.doesNotMatch(content, /return anchors\[0\]\?\.href \|\| null/);
  assert.doesNotMatch(content, /Auto-publish failed and backend fail-sync failed/);
});

test("Facebook Your Listings detects visible vehicle year mismatches", () => {
  assert.match(content, /function detectMarketplaceYearMismatchOnPage\(job\)/);
  assert.match(content, /Facebook appears to show this vehicle as/);
  assert.match(content, /detectMarketplaceYearMismatchOnPage\(job\)/);
  assert.match(content, /closeMarketplaceTabSoon\(\)/);
});
