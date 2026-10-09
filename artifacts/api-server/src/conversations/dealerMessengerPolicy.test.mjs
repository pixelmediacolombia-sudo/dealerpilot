import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALPHA_MOTORSPORTS_DEALER_ID,
  buildStrongPurchaseIntentReply,
  getEffectiveMessengerKnowledge,
  getMessengerDealerPolicy,
  buildLuckiGeneralOnlyReply,
  isLuckiMazdaPhone,
  isLuckiReplySafe,
  LUCKI_MAZDA_PHONE,
} from "./dealerMessengerPolicy.ts";

test("Lucki Messenger policy is dealer-scoped and contains no Alpha defaults", () => {
  assert.equal(ALPHA_MOTORSPORTS_DEALER_ID, 1);
  assert.equal(getMessengerDealerPolicy(ALPHA_MOTORSPORTS_DEALER_ID).displayName, "Alpha Motorsports");
  const policy = getMessengerDealerPolicy(2);
  assert.equal(policy.displayName, "Lucki Mazda");
  assert.equal(policy.phone, LUCKI_MAZDA_PHONE);
  assert.equal(policy.location, "Woodbridge, VA");
  assert.equal(policy.generalQuestionsOnly, true);
  assert.equal(getMessengerDealerPolicy(1).displayName, "Alpha Motorsports");
});

test("Lucki gets runtime phone, location, and clean-title knowledge without changing stored knowledge", () => {
  const stored = {};
  const effective = getEffectiveMessengerKnowledge(2, stored);
  assert.deepEqual(stored, {});
  assert.equal(effective.en.phone, LUCKI_MAZDA_PHONE);
  assert.equal(effective.en.address, "Woodbridge, VA");
  assert.equal(effective.en.title, "All vehicles have a clean title");
  const contaminated = getEffectiveMessengerKnowledge(2, {
    en: { phone: "+1 703-763-4675", address: "9120 Euclid Ave, Manassas, VA 20110" },
  });
  assert.equal(contaminated.en.phone, LUCKI_MAZDA_PHONE);
  assert.equal(contaminated.en.address, "Woodbridge, VA");
  assert.equal(getEffectiveMessengerKnowledge(1, {}).en, undefined);
});

test("Lucki safe reply guard blocks Alpha and financing/down-payment leakage", () => {
  assert.equal(isLuckiMazdaPhone("+1 571-774-7848"), true);
  assert.equal(isLuckiReplySafe("Hello, this is Lucki Mazda. The vehicle is available."), true);
  assert.equal(isLuckiReplySafe("Alpha Motorsports in Manassas"), false);
  assert.equal(isLuckiReplySafe("What is your down payment?"), false);
  assert.equal(isLuckiReplySafe("We can discuss financing."), false);
});

test("strong-purchase reply is dealer-configured for Alpha", () => {
  const reply = buildStrongPurchaseIntentReply({
    language: "es",
    dealerName: "Alpha Motorsports",
    storePhone: "+1 703-763-4675",
  });

  assert.match(reply, /Sí, podemos considerar tu oferta en efectivo/i);
  assert.match(reply, /nuestros asesores pueden comunicarse contigo/i);
  assert.match(reply, /mejor número para llamarte/i);
  assert.match(reply, /Alpha Motorsports al \+1 703-763-4675/i);
  assert.doesNotMatch(reply, /Lucki|571-774-7848|specific question/i);
});

test("Lucki reply path answers approved general facts without Alpha or qualification terms", () => {
  const base = {
    language: "en",
    vehicleTitle: "2026 Mazda CX-50 2.5 S Preferred",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {
      price: 25000,
      mileage: 12,
      vin: "TESTVIN123",
      vdpUrl: "https://www.luckimazda.com/viewdetails/vehicle",
      exteriorColor: "Black",
    },
    hasCleanTitleInventory: true,
  };
  const replies = [
    buildLuckiGeneralOnlyReply({ ...base, currentMessage: "Is it available?" }),
    buildLuckiGeneralOnlyReply({ ...base, currentMessage: "Does it have a clean title?" }),
    buildLuckiGeneralOnlyReply({ ...base, currentMessage: "What is the down payment?" }),
    buildLuckiGeneralOnlyReply({ ...base, currentMessage: "What is the financing?" }),
    buildLuckiGeneralOnlyReply({ ...base, currentMessage: "What is the VIN number?" }),
    buildLuckiGeneralOnlyReply({ ...base, currentMessage: "Can I see the photos?" }),
  ];
  assert.match(replies[0], /Lucki Mazda/);
  assert.match(replies[1], /clean title/);
  for (const reply of replies) {
    assert.equal(isLuckiReplySafe(reply), true, reply);
    assert.doesNotMatch(reply, /Alpha|Manassas|down payment|financing/i);
  }
});

test("Lucki greets as Lucki Mazda for standalone greetings", () => {
  const base = {
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: true,
  };

  const english = buildLuckiGeneralOnlyReply({ ...base, language: "en", currentMessage: "Hi" });
  const spanish = buildLuckiGeneralOnlyReply({ ...base, language: "es", currentMessage: "Hola" });

  assert.match(english, /Lucki Mazda/);
  assert.match(spanish, /Lucki Mazda/);
  assert.doesNotMatch(english, /Alpha|Manassas/i);
  assert.doesNotMatch(spanish, /Alpha|Manassas/i);
});

test("Lucki first Marketplace cash offer greets, requests buyer phone, and gives Lucki phone", () => {
  const reply = buildLuckiGeneralOnlyReply({
    language: "en",
    currentMessage: "Hi, I am interested about your listing. I would like to make an offer of $11000 in cash. Please let me know if it works for you.",
    vehicleTitle: "2016 Honda HR-V",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: true,
    firstDealerReply: true,
  });

  assert.match(reply, /^Hello, this is Lucki Mazda\./);
  assert.match(reply, /cash offer/i);
  assert.match(reply, /best phone number/i);
  assert.match(reply, /Lucki Mazda at \+15717747848/);
  assert.equal((reply.match(/\?/g) || []).length, 1);
  assert.equal(isLuckiReplySafe(reply), true);
});

test("Lucki recognizes a short cash-now offer and answers affirmatively", () => {
  const reply = buildLuckiGeneralOnlyReply({
    language: "en",
    currentMessage: "19 k cash today?",
    vehicleTitle: "2021 Mazda CX-5",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: true,
    firstDealerReply: true,
  });

  assert.match(reply, /^Hello, this is Lucki Mazda\./);
  assert.match(reply, /Yes, we can consider your cash offer/i);
  assert.match(reply, /sales advisors can contact you/i);
  assert.match(reply, /best phone number/i);
  assert.match(reply, /Lucki Mazda at \+15717747848/i);
  assert.doesNotMatch(reply, /specific question|Alpha|Manassas/i);
});

test("Lucki does not restart the greeting on a later cash offer", () => {
  const reply = buildLuckiGeneralOnlyReply({
    language: "en",
    currentMessage: "I can offer $11,000 cash.",
    vehicleTitle: "2016 Honda HR-V",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: true,
    firstDealerReply: false,
  });

  assert.doesNotMatch(reply, /^Hello|^Lucki Mazda\./i);
  assert.match(reply, /Lucki Mazda at \+15717747848/);
});

test("Lucki phone receipt uses the terminal handoff without another question", () => {
  const reply = buildLuckiGeneralOnlyReply({
    language: "en",
    currentMessage: "9297565466",
    vehicleTitle: "2016 Honda HR-V",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: true,
  });

  assert.match(reply, /Lucki Mazda sales agent will contact you shortly/i);
  assert.match(reply, /Goodbye, and have a great day/i);
  assert.doesNotMatch(reply, /\?/);
});

test("Lucki first unanswered question greets as Lucki and requests both phone options", () => {
  const reply = buildLuckiGeneralOnlyReply({
    language: "en",
    currentMessage: "Does it have adaptive cruise control?",
    vehicleTitle: "2016 Honda HR-V",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: true,
    firstDealerReply: true,
  });

  assert.match(reply, /^Hello, this is Lucki Mazda\./);
  assert.match(reply, /best phone number to reach you/i);
  assert.match(reply, /call Lucki Mazda at \+15717747848/i);
  assert.doesNotMatch(reply, /Alpha|Manassas/i);
});

test("Lucki answers an unavailable clean-title detail with its own handoff", () => {
  const reply = buildLuckiGeneralOnlyReply({
    language: "es",
    currentMessage: "¿Tiene garantía?",
    vehicleTitle: "2016 Honda HR-V",
    storePhone: LUCKI_MAZDA_PHONE,
    vehicleFacts: {},
    hasCleanTitleInventory: false,
    firstDealerReply: true,
  });

  assert.match(reply, /^Hola, somos Lucki Mazda\./);
  assert.match(reply, /mejor número para comunicarnos contigo/i);
  assert.match(reply, /Lucki Mazda al \+15717747848/i);
  assert.doesNotMatch(reply, /Alpha|Manassas/i);
});
