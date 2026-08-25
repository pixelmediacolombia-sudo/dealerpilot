import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketplaceTurnDecision,
  classifyMarketplaceLevel,
  extractMarketplaceFacts,
} from "./marketplaceTurn.ts";

function envelope(overrides = {}) {
  return {
    envelope_version: "1.0",
    idempotency_key: "thread-1:msg-1",
    dealer: {
      dealer_id: "alpha-motorsport",
      marketplace_identity_id: "fb-profile-1",
      location: "9120 Euclid Ave, Manassas, VA",
      phone: "+1 703-763-4675",
    },
    lead: { lead_id: "lead-1", buyer_display_name: "Ma", language_detected: "en" },
    thread: { thread_id: "thread-1", listing_id: "listing-1", listing_title: "2020 Tesla Model Y", turn_number: 3 },
    vehicle: {
      matched: true,
      vin: "5YJYGDEE1LF000000",
      stock: "AM2291",
      year: 2020,
      make: "Tesla",
      model: "Model Y",
      price: 19500,
      vdp_url: "https://alphamotorsport.com/inventory/5YJYGDEE1LF000000",
      status: "available",
    },
    messages: [],
    ...overrides,
  };
}

test("standalone K down payment is captured and a new phone triggers immediate handoff", () => {
  const result = buildMarketplaceTurnDecision(envelope({
    messages: [
      { role: "buyer", text: "$3k" },
      { role: "dealer", text: "We have plans starting at $1,000, $2,000, and $3,000 down." },
      { role: "buyer", text: "227-258-8199" },
    ],
  }));
  assert.equal(result.facts.down_payment_available, 3000);
  assert.equal(result.facts.phone, "+12272588199");
  assert.equal(result.level, "A");
  assert.equal(result.handoff.trigger, true);
  assert.equal(result.next_step, "handoff");
  assert.doesNotMatch(result.reply_text, /\?/);
});

test("an open vehicle question is answered without inventing a number or requesting a phone", () => {
  const result = buildMarketplaceTurnDecision(envelope({
    messages: [
      { role: "dealer", text: "Hello, this is Alpha Motorsports." },
      { role: "buyer", text: "What is the range when charged to 100 percent?" },
    ],
  }));
  assert.equal(result.answered_buyer_question, true);
  assert.match(result.reply_text, /exact detail|inventario facts|inventory facts/i);
  assert.doesNotMatch(result.reply_text, /phone|n[uú]mero/i);
  assert.equal((result.reply_text.match(/\?/g) ?? []).length, 1);
  assert.match(result.reply_text, /https:\/\/alphamotorsport\.com/);
});

test("cash price answers use the supplied source and never offer financing", () => {
  const result = buildMarketplaceTurnDecision(envelope({
    known_facts: { price_role: "down_payment" },
    thread: { thread_id: "thread-1", listing_id: "listing-1", listing_title: "2021 Toyota Tacoma", listing_price_shown: 2500 },
    vehicle: { matched: true, year: 2021, make: "Toyota", model: "Tacoma", price: 14900, status: "available" },
    messages: [{ role: "buyer", text: "What is the real cash price?" }],
  }));
  assert.match(result.reply_text, /\$2,500/);
  assert.match(result.reply_text, /\$14,900/);
  assert.doesNotMatch(result.reply_text, /financ/i);
});

test("requirements mention passport or ID and proof of income", () => {
  const result = buildMarketplaceTurnDecision(envelope({
    messages: [{ role: "buyer", text: "What documents do I need?" }],
  }));
  assert.match(result.reply_text, /passport|pasaporte/i);
  assert.match(result.reply_text, /proof of income|comprobante de ingresos/i);
});

test("facts and level remain label-only when no phone is available", () => {
  const facts = extractMarketplaceFacts(envelope({ messages: [{ role: "buyer", text: "I am interested" }] }));
  assert.equal(facts.phone, null);
  assert.equal(classifyMarketplaceLevel(facts), "C");
});
