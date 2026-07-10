import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const content = readFileSync(new URL("../content/content.js", import.meta.url), "utf8");

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

test("Make can fall back to a text input instead of requiring a combobox", () => {
  assert.match(content, /fillTextOrSelectComboboxStep\s*\(/);
  assert.match(content, /"make"[\s\S]*\["make", "marca"\][\s\S]*\["make", "marca"\]/);
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
  assert.match(content, /waitForEnabledButtonByText\(NEXT_TEXTS, 12000\)/);
  assert.match(content, /after waiting 12 seconds/);
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

test("Next diagnostics only flag exact empty dropdown placeholders", () => {
  assert.match(content, /const placeholderLike = new Set\(\[/);
  assert.match(content, /placeholderLike\.has\(text\)/);
  assert.doesNotMatch(
    content,
    /text\.startsWith\(`\$\{p\} `\)/,
    "filled controls like Año 2021 must not be reported as blocked placeholders",
  );
});

test("Successful publish wakes the queue for the next eligible job", () => {
  const completeIndex = content.indexOf('type: "COMPLETE_JOB"');
  const pollIndex = content.indexOf('type: "POLL_NOW"');
  const failIndex = content.indexOf('type: "FAIL_JOB"');
  assert.notEqual(completeIndex, -1, "COMPLETE_JOB call is missing");
  assert.notEqual(pollIndex, -1, "POLL_NOW call is missing");
  assert.ok(pollIndex > completeIndex, "POLL_NOW must only happen after completion succeeds");
  assert.ok(pollIndex > failIndex, "POLL_NOW must not be part of the failure path");
  assert.match(content, /Checking the queue for the next eligible job/);
  assert.match(content, /Claiming the next eligible job/);
});
