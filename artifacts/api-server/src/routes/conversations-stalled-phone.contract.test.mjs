import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("Alpha Manassas qualification follows the new required order", () => {
  assert.match(source, /QUALIFICATION FUNNEL FOR ALPHA MANASSAS/);
  assert.match(source, /function historyHasBuyerPhone\(/);
  assert.match(source, /function extractBuyerQualification\(/);
  assert.match(source, /getDownPaymentPolicy/);
  assert.match(source, /function buyerAcceptedCashPurchase/);
  assert.match(source, /never mistake the buyer's phone number for a down payment/i);
  assert.match(source, /cash, contado, or in cash/);
  assert.match(source, /Approved Down-Payment Configuration/);
  assert.match(source, /approvedDownPaymentConfiguration/);
  assert.doesNotMatch(source, /\$1,000|\$2,000|\$3,000/);
  assert.match(source, /this week or this month/);
  assert.match(source, /in 15 days/);
  assert.match(source, /en 15 dias/);
  assert.match(source, /next month/);
  assert.match(source, /el otro mes/);
  assert.match(source, /named month/);
  assert.match(source, /valid ID and proof of income/);
  assert.match(source, /qualified_exit/);
  assert.match(source, /Alpha Manassas dealership phone/);
  assert.doesNotMatch(source, /Fredericksburg/);
  assert.doesNotMatch(source, /active bank account/);
  assert.match(source, /buyerPhoneAlreadyKnown/);
  assert.match(source, /if \(buyerPhoneAlreadyKnown/);
  assert.match(source, /buyerQualification\.downPayment/);
  assert.match(source, /buyerQualification\.timeline/);
  assert.match(source, /buyerQualification\.documents/);
  assert.doesNotMatch(
    source,
    /const closeAfterDelivery = \[\s*"store_phone_requested"/,
    "sharing the dealership phone must not close qualification",
  );
  assert.doesNotMatch(
    source,
    /latestExistingAssistant\?\.content\.trim\(\) !== inbound\.trim\(\) &&\s*!immediateHandoffReason/,
    "receiving the buyer phone must still generate the next qualification question",
  );
});

test("monthly payment targets are not treated as available down payments", () => {
  const extractorStart = source.indexOf("function extractDownPaymentAmount");
  const extractorEnd = source.indexOf("type ImmediateHandoffReason", extractorStart);
  assert.ok(extractorStart >= 0);
  assert.ok(extractorEnd > extractorStart);
  const extractor = source.slice(extractorStart, extractorEnd);
  assert.match(extractor, /monthlyTargetAmount/);
  assert.match(extractor, /per\\s\+month\|monthly\|a\\s\+month/);
  assert.match(extractor, /explicitlyLabeledDownPayment/);
  assert.match(extractor, /monthlyTargetAmount\s+&&\s+!explicitlyLabeledDownPayment/);
});

test("an explicit address request takes priority over stalled phone recovery", () => {
  const addressCheck = source.indexOf('return "address_request"');
  const stalledCheck = source.indexOf('return "stalled_conversation_request_phone"');
  assert.ok(addressCheck >= 0);
  assert.ok(stalledCheck >= 0);
  assert.ok(addressCheck < stalledCheck);
});

test("address replies must include the Manassas address and dealership phone before requesting the buyer phone", () => {
  const guardStart = source.indexOf('if (stage === "address_request")', source.indexOf("function isAiReplyAligned"));
  const guardEnd = source.indexOf('if (stage === "financing_intro")', guardStart);
  assert.ok(guardStart >= 0);
  assert.ok(guardEnd > guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /9120\\s\+euclid\|manassas/);
  assert.match(guard, /available\|disponible/);
  assert.match(guard, /phone\|number\|tel/);
  assert.match(guard, /replyIncludesStorePhone\(reply, storePhone\)/);
});

test("VIN replies give the dealership phone and request the buyer phone", () => {
  const guardStart = source.indexOf('if (stage === "vin_inquiry")', source.indexOf("function isAiReplyAligned"));
  const guardEnd = source.indexOf('if (stage === "mileage_inquiry")', guardStart);
  assert.ok(guardStart >= 0);
  assert.ok(guardEnd > guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /asksForBuyerPhone/);
  assert.match(guard, /replyIncludesStorePhone\(reply, storePhone\)/);
  assert.match(source, /case "vin_inquiry":[\s\S]{0,220}dealer_phone=/);
  assert.match(source, /Give Alpha Motorsports' dealership phone/);
  assert.match(source, /También puedes llamar a Alpha Motorsports al \$\{storePhone\}/);
});

test("unresolved vehicle-detail replies give Alpha's phone and request the buyer phone", () => {
  const phoneStageStart = source.indexOf("function stageRequiresStorePhone");
  const phoneStageEnd = source.indexOf("function isConversationClosingBuyerAcknowledgement", phoneStageStart);
  assert.ok(phoneStageStart >= 0);
  assert.ok(phoneStageEnd > phoneStageStart);
  const phoneStages = source.slice(phoneStageStart, phoneStageEnd);
  assert.match(phoneStages, /stage === "open_question"/);
  assert.match(phoneStages, /stage === "advisor_question"/);

  assert.match(source, /También puedes llamar a Alpha Motorsports al \$\{storePhone\}\. ¿A qué número te contactamos\?/);
  assert.match(source, /You can also call Alpha Motorsports at \$\{storePhone\}\. What number should we use to reach you\?/);
});
