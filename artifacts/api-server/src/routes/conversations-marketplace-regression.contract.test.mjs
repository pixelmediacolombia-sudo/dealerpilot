import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("location questions outrank generic open-question classification", () => {
  const locationCheck = source.indexOf('if (buyerAskedLocation(latest)) return "address_request";');
  const genericCheck = source.indexOf('if (buyerHasOpenQuestion(latest)) return "open_question";');
  assert.ok(locationCheck >= 0);
  assert.ok(genericCheck >= 0);
  assert.ok(locationCheck < genericCheck);
  assert.ok(source.includes("where are you(?: located)?"));
  assert.ok(source.includes("where (?:is|are).{0,40}located"));
  assert.ok(source.includes("where(?:'s| is)"));
});

test("a bare down-payment number uses the preceding dealer question context", () => {
  assert.match(source, /standaloneNumericAmount/);
  assert.match(source, /standaloneNumericAmount && downPaymentQuestionAsked/);
  assert.match(source, /extractDownPaymentAmount\(latest, askedForDownPayment\)/);
  assert.match(source, /if \(amount !== null\) return "request_phone"/);
  assert.doesNotMatch(source, /down_payment_amount_received/);
});

test("phone capture closes with a neutral handoff and no follow-up question", () => {
  const stageStart = source.indexOf('if (hasPhoneNumber(latest)) return "phone_received";');
  assert.ok(stageStart >= 0);
  assert.doesNotMatch(
    source.slice(stageStart, stageStart + 120),
    /!buyerPhoneAlreadyKnown/,
    "the current phone turn must not be treated as already known",
  );
  assert.match(source, /phone_received: "The buyer provided a phone number[\s\S]*brief goodbye/);
  assert.match(source, /Thanks for your number\. A sales agent will reach out to you shortly\. We remain available\./);
  assert.match(source, /Gracias por tu número\. Un agente de ventas te contactará en breve\. Quedamos atentos\./);
  assert.match(source, /closeConversationAfterDelivery: retryStage === "store_phone_requested" \|\| retryStage === "phone_received"/);
  assert.match(source, /const closeAfterDelivery = immediateHandoffReason === "buyer_phone_received" \|\| \[/);
  assert.doesNotMatch(source, /closeConversationAfterDelivery: [^\n]*qualified_exit/);
});

test("qualified buyers are asked for their phone and the thread stays open until phone capture", () => {
  const qualifiedExit = source.indexOf('if (stage === "qualified_exit")');
  assert.ok(qualifiedExit >= 0);
  const qualifiedReply = source.slice(qualifiedExit, source.indexOf('if (stage === "request_phone")', qualifiedExit));
  assert.match(qualifiedReply, /cumples con los requisitos/);
  assert.match(qualifiedReply, /mejor n[uú]mero de tel[eé]fono/);
  assert.match(qualifiedReply, /\?[^\n]*\$\{storePhone\}/);
  assert.match(source, /best phone number to reach you/);
  assert.match(source, /shouldAskBuyerPhoneAfterQualification/);
  assert.match(source, /qualified_exit: askForBuyerPhone/);
  assert.match(source, /already requested earlier, so do not ask for it again/);
  assert.match(source, /If the current stage is qualified_exit and the buyer's phone has not been requested earlier/);
});

test("buyer language detection includes natural Spanish vehicle questions", () => {
  const languageSource = readFileSync(new URL("../conversations/language.ts", import.meta.url), "utf8");
  assert.ok(languageSource.includes("|es|son|"));
  assert.ok(languageSource.includes("cuatro"));
  assert.ok(languageSource.includes("cilindros"));
  assert.ok(languageSource.includes("seis"));
});

test("answer-repair stage prevents repeating the generic phone fallback", () => {
  assert.match(source, /buyerRequestsAnswerToPendingQuestion/);
  assert.match(source, /question_repair/);
  assert.match(source, /Do not repeat the previous generic sales-agent or phone-number wording/);
  assert.match(source, /buildQuestionRepairFallback/);
});
