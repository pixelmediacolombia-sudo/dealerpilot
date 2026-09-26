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
  assert.match(source, /Approved Down-Payment Configuration/);
  assert.match(source, /approvedDownPaymentConfiguration/);
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

test("availability questions ask what the buyer wants to know before phone handoff", () => {
  assert.match(source, /function buyerAskedAvailability\(latest: string\)/);
  assert.match(source, /sigue.*estando.*disponible/);
  assert.match(source, /if \(buyerAskedAvailability\(latest\)\) return false;/);
  assert.match(source, /if \(buyerAskedAvailability\(latest\)\) return "availability";/);
  assert.match(source, /Hola, somos \$\{dealerName\}\. Sí, el \$\{vehicle\} está disponible\. ¿Qué te gustaría saber\?/);
});

test("price questions are classified before the generic open-question fallback", () => {
  const resolverStart = source.indexOf("function resolveSalesReplyStage(");
  const resolverEnd = source.indexOf("function formatVehicleDisplayName", resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.ok(resolver.indexOf("if (buyerAskedPriceInquiry(latest)) return \"price_inquiry\";") < resolver.indexOf("if (buyerHasOpenQuestion(latest)) return \"open_question\""));
  assert.match(source, /marketplaceAskingPrice/);
  assert.match(source, /price: vehicleFacts\.price \?\? parsedAskingPrice/);
});

test("the dealership phone cannot trigger the buyer phone farewell", () => {
  assert.match(source, /function extractBuyerPhoneNumber\(text: string, storePhone = ""\)/);
  assert.match(source, /The dealership phone is intentionally included in many handoff prompts/);
  assert.match(source, /if \(storeDigits && phoneDigits === storeDigits\) return null/);
  assert.match(source, /const extractedPhone = extractBuyerPhoneNumber\(inbound, storePhone\)/);
  assert.match(source, /const immediateHandoffReason = resolveImmediateHandoffReason\(inbound, storePhone\)/);
  assert.match(source, /resolveSalesReplyStage\(visibleMessages, currentMessage, downPaymentPolicy, storePhone\)/);
});

test("dealer-hours replies include hours, welcome, and both phone options", () => {
  assert.match(source, /Nuestro horario es .*Te esperamos.*mejor n[uú]mero.*llamarnos al \$\{storePhone\}/);
  assert.match(source, /Our hours are .*look forward to seeing you.*best number.*call us at \$\{storePhone\}/);
  const guardStart = source.indexOf('if (stage === "dealer_hours")', source.indexOf("function isAiReplyAligned"));
  const guardEnd = source.indexOf('if (stage === "trade_in_request")', guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /replyIncludesStorePhone\(reply, storePhone\)/);
  assert.match(guard, /look forward|esperamos/);
});

test("availability greeting uses the dealer loaded by dealerId", () => {
  assert.match(source, /name: dealersTable\.name/);
  assert.match(source, /where\(eq\(dealersTable\.id, dealerId\)\)/);
  assert.match(source, /getMessengerDealerPolicy\(dealerId\)/);
  assert.match(source, /const dealerName = messengerPolicy\.displayName \|\| targetDealer\.name/);
  assert.match(source, /testDealerName = getMessengerDealerPolicy\(v\.dealerId\)\.displayName/);
  assert.match(source, /dealerName: string = "Alpha Motorsports"/);
  assert.match(source, /Hola, somos \$\{dealerName\}/);
  assert.match(source, /Hello, this is \$\{dealerName\}/);
});

test("trade-in replies request vehicle photos and both phone options", () => {
  const stageStart = source.indexOf('if (stage === "trade_in_request")', source.indexOf("function isAiReplyAligned"));
  const stageEnd = source.indexOf('if (stage === "payment_methods_request")', stageStart);
  assert.ok(stageStart >= 0);
  assert.ok(stageEnd > stageStart);
  const guard = source.slice(stageStart, stageEnd);

  assert.match(guard, /requestsPhotos/);
  assert.match(guard, /asksForBuyerPhone/);
  assert.match(guard, /replyIncludesStorePhone\(reply, storePhone\)/);
  assert.match(source, /trade_in_vehicle_photos/);
  assert.match(source, /Envíanos fotos del vehículo que quieres dar a cuenta/);
  assert.match(source, /Send us photos of the vehicle you want to trade in/);
  assert.match(source, /trade_in_request:[\s\S]{0,420}best phone number[\s\S]{0,180}dealership phone/);
});
