import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNegotiabilityReply,
  detectNegotiabilityIntent,
} from "./negotiability.ts";
import { detectLanguage } from "./language.ts";

test("negotiability questions are classified as ASK_NEGOTIABLE", () => {
  for (const message of [
    "Es negociable?",
    "¿El precio es negociable?",
    "negociable",
    "Can you negotiate the price?",
    "Do you accept offers?",
  ]) {
    assert.equal(detectNegotiabilityIntent(message), "ASK_NEGOTIABLE", message);
  }
});

test("the first Spanish reply greets, confirms negotiability, and asks what to know", () => {
  const reply = buildNegotiabilityReply("es");
  assert.match(reply, /hola, somos alpha motorsports/i);
  assert.match(reply, /precio es negociable/i);
  assert.match(reply, /qué te gustaría saber/i);
  assert.doesNotMatch(reply, /tel[eé]fono|n[uú]mero|llamar|agente/i);
});

test("the English reply preserves the same first-turn contract", () => {
  const reply = buildNegotiabilityReply("en");
  assert.match(reply, /hello, this is alpha motorsports/i);
  assert.match(reply, /price is negotiable/i);
  assert.match(reply, /what would you like to know/i);
  assert.doesNotMatch(reply, /phone|number|sales agent/i);
});

test("standalone negotiability wording keeps the buyer language", () => {
  assert.equal(detectLanguage("negociable"), "es");
  assert.equal(detectLanguage("negotiable"), "en");
});
