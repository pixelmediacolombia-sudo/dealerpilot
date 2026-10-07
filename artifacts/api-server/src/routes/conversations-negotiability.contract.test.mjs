import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("negotiability intent is classified before generic price/open-question routing", () => {
  assert.match(source, /detectNegotiabilityIntent/);
  assert.match(source, /ASK_NEGOTIABLE/);
  const negotiabilityCheck = source.indexOf('if (buyerAskedNegotiability(latest)) return "negotiability_inquiry";');
  const priceCheck = source.indexOf('if (buyerAskedPriceInquiry(latest)) return "price_inquiry";');
  const openQuestionCheck = source.indexOf('if (buyerHasOpenQuestion(latest)) return "open_question";');
  assert.ok(negotiabilityCheck >= 0);
  assert.ok(negotiabilityCheck < priceCheck);
  assert.ok(negotiabilityCheck < openQuestionCheck);
});

test("the negotiability first reply does not interrupt later phone capture", () => {
  assert.match(source, /negotiability_inquiry/);
  assert.match(source, /price is negotiable|precio es negociable/);
  assert.match(source, /what would you like to know|qué te gustaría saber/);
  assert.match(source, /if \(hasPhoneNumber\(latest, storePhone\)\) return "phone_received";/);
  assert.match(source, /closeAfterDelivery = immediateHandoffReason === "buyer_phone_received"/);
});
