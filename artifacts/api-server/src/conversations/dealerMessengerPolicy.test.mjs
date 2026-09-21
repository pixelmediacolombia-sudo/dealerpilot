import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getEffectiveMessengerKnowledge,
  getMessengerDealerPolicy,
  buildLuckiGeneralOnlyReply,
  isLuckiMazdaPhone,
  isLuckiReplySafe,
  LUCKI_MAZDA_PHONE,
} from "./dealerMessengerPolicy.ts";

test("Lucki Messenger policy is dealer-scoped and contains no Alpha defaults", () => {
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
