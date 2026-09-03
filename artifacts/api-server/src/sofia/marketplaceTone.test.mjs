import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVehiclePhotoRequestReply,
  detectVehicleRequestKind,
  extractCarfaxUrlFromSourceRaw,
  hasConcreteCashOffer,
  hasDownPaymentAmount,
  hasVisitDaySignal,
  hasVehicleValueFact,
  isConciseMarketplaceReply,
  vehicleValueFact,
} from "./marketplaceTone.ts";

const facts = {
  title: "2020 Acura ILX",
  mileage: 18070,
  exteriorColor: "Gray",
  vdpUrl: "https://www.alphamotorsport.net/used-2020-ACURA-ILX--fredericksburg-virginia-22408/vd/648674",
};

test("recognizes the PDF's visit-day shortcut", () => {
  assert.equal(hasVisitDaySignal("Very interested! In Va beach so would need to come on weekend"), true);
  assert.equal(hasVisitDaySignal("What is the range when charged to 100 percent?"), false);
});

test("recognizes down-payment and concrete cash signals without treating phone as money", () => {
  assert.equal(hasDownPaymentAmount("I can put $3k down"), true);
  assert.equal(hasDownPaymentAmount("Call me at 703-763-4675"), false);
  assert.equal(hasConcreteCashOffer("I can pay cash with $5,000"), true);
});

test("routes photo and Carfax requests independently", () => {
  assert.equal(detectVehicleRequestKind("Do you have more photos?"), "photos");
  assert.equal(detectVehicleRequestKind("Can I get more information?"), "photos");
  assert.equal(detectVehicleRequestKind("Me das más información?"), "photos");
  assert.equal(detectVehicleRequestKind("Can I see the Carfax?"), "carfax");
  assert.equal(detectVehicleRequestKind("Any issues with it?"), "carfax");
  assert.equal(detectVehicleRequestKind("Is it available?"), null);
});

test("photo requests without a ficha ask for the buyer phone and include Alpha's phone", () => {
  const phone = "+1 703-763-4675";
  const english = buildVehiclePhotoRequestReply("en", phone);
  const spanish = buildVehiclePhotoRequestReply("es", phone);

  assert.match(english, /vehicle photos/);
  assert.match(english, /best phone number/);
  assert.match(english, /\+1 703-763-4675/);
  assert.doesNotMatch(english, /what would you like to know/i);
  assert.match(spanish, /fotos del veh[ií]culo/);
  assert.match(spanish, /mejor n[uú]mero/);
  assert.match(spanish, /\+1 703-763-4675/);
  assert.doesNotMatch(spanish, /qu[eé] te gustar[ií]a saber/i);
});

test("uses feed-backed mileage or color as the value fact", () => {
  assert.equal(vehicleValueFact(facts, "en"), "18,070 miles");
  assert.equal(vehicleValueFact(facts, "es"), "18,070 millas");
  assert.equal(hasVehicleValueFact("Yes, it has 18,070 miles. What would you like to know?", facts), true);
});

test("does not manufacture a Carfax link and keeps replies short", () => {
  assert.equal(extractCarfaxUrlFromSourceRaw(JSON.stringify({ description: "Clean Carfax" })), null);
  assert.equal(extractCarfaxUrlFromSourceRaw(JSON.stringify({ carfaxUrl: "https://example.com/carfax/ABC" })), "https://example.com/carfax/ABC");
  assert.equal(isConciseMarketplaceReply("Yes, it is available with 18,070 miles. What would you like to know?"), true);
  assert.equal(isConciseMarketplaceReply("A".repeat(421)), false);
});
