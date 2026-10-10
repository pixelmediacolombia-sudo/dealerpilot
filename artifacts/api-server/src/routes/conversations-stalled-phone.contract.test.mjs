import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("Alpha Manassas qualification follows the new required order", () => {
  assert.match(source, /QUALIFICATION FUNNEL FOR ALPHA MANASSAS/);
  assert.match(source, /function historyHasBuyerPhone\(/);
  assert.match(source, /function extractBuyerQualification\(/);
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
  assert.match(source, /hasPhoneNumber\(latest, storePhone\) \|\| buyerPhoneAlreadyKnown/);
  assert.match(source, /phoneCaptured/);
  assert.match(source, /status: phoneCaptured \? "completed" : "active"/);
  assert.match(source, /status: phoneCaptured \? "COMPLETED" : "IN_PROGRESS"/);
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
    "phone capture must not be suppressed before the terminal farewell is generated",
  );
});

test("down-payment qualification is retired from the conversational decision path", () => {
  assert.doesNotMatch(source, /function extractDownPaymentAmount/);
  assert.doesNotMatch(source, /down_payment_request|down_payment_low|down_payment_declined/);
  assert.doesNotMatch(source, /Approved Down-Payment Configuration|approvedDownPaymentConfiguration/);
  assert.doesNotMatch(source, /How much do you have available for the down payment/);
  assert.doesNotMatch(source, /¿Con cuánto cuentas para el enganche\?/);
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

test("VIN replies continue with the next question without requesting the buyer phone", () => {
  const guardStart = source.indexOf('if (stage === "vin_inquiry")', source.indexOf("function isAiReplyAligned"));
  const guardEnd = source.indexOf('if (stage === "mileage_inquiry")', guardStart);
  assert.ok(guardStart >= 0);
  assert.ok(guardEnd > guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /asksWhatElse/);
  assert.match(guard, /would you like to know/);
  assert.match(guard, /!\/phone\|number\|tel/);
  assert.match(guard, /if \(vehicleFacts\?\.vin\)/);
  assert.match(guard, /asksForBuyerPhone/);
  assert.match(source, /case "vin_inquiry":[\s\S]{0,220}dealer_phone=/);
  assert.match(source, /stage === "vin_inquiry"/);
  assert.match(source, /!\(stage === "vin_inquiry" && vehicleFacts\?\.vin\)/);
  assert.match(source, /Answer directly with the feed-backed VIN \$\{vehicleFacts\.vin\}[\s\S]*ask what else the buyer would like to know/);
  assert.match(source, /Do not give the dealership phone, ask for the buyer's phone number/);
  assert.match(source, /El VIN es \$\{vehicleFacts\.vin\}\. ¿Qué más te gustaría saber\?/);
  assert.match(source, /The VIN is \$\{vehicleFacts\.vin\}\. What else would you like to know\?/);
  assert.match(source, /Nuestros agentes de ventas pueden ayudarte con ese dato\. También puedes llamar a Alpha Motorsports al \$\{storePhone\}\. ¿A qué número te contactamos\?/);
  assert.match(source, /Our sales agents can help with that detail\. You can also call Alpha Motorsports at \$\{storePhone\}\. What number should we use to reach you\?/);
  assert.match(source, /const vin = vehicleFacts\?\.vin\?\.trim\(\);[\s\S]{0,240}if \(vin\)/);
  assert.match(source, /Our sales agents can help with that detail\. You can also call Alpha Motorsports at \$\{configuredPhone\}\. What number should we use to reach you\?/);
});

test("unresolved vehicle-detail replies give Alpha's phone and request the buyer phone", () => {
  const phoneStageStart = source.indexOf("function stageRequiresStorePhone");
  const phoneStageEnd = source.indexOf("function isConversationClosingBuyerAcknowledgement", phoneStageStart);
  assert.ok(phoneStageStart >= 0);
  assert.ok(phoneStageEnd > phoneStageStart);
  const phoneStages = source.slice(phoneStageStart, phoneStageEnd);
  assert.match(phoneStages, /stage === "open_question"/);
  assert.match(phoneStages, /stage === "advisor_question"/);

  assert.match(source, /Nuestros agentes de ventas se comunicarán contigo para responder esa pregunta específica\. ¿Cuál es el mejor número para comunicarnos contigo\?/);
  assert.match(source, /What is the best phone number to reach you\?/);
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
