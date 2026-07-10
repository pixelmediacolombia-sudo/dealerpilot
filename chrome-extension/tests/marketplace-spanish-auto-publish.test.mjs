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
