import assert from "node:assert/strict";
import test from "node:test";
import { detectConversationLanguage, detectLanguage } from "./language.ts";

test("recognizes a short Spanish cash answer", () => {
  assert.equal(detectLanguage("De un solo pago"), "es");
});

test("keeps a Spanish reply after a phone-only buyer message", () => {
  assert.equal(detectConversationLanguage("703-763-4675", ["Cash", "De un solo pago"]), "es");
});

test("recognizes Elyse's detailed English question", () => {
  assert.equal(
    detectLanguage("Can you confirm the exact trim, clean-title/CARFAX status, and full out-the-door price?"),
    "en",
  );
});
