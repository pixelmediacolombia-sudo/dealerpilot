import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import test from "node:test";
import sofiaRouter from "./sofiaMarketplace.ts";

const secret = "local-test-secret-do-not-use-in-production";
process.env.SOFIA_MARKETPLACE_HMAC_SECRET = secret;
process.env.SOFIA_MARKETPLACE_MODE = "shadow";

function payload() {
  return {
    envelope_version: "1.0",
    idempotency_key: "e2e-thread:msg-44",
    dealer: { dealer_id: "alpha-motorsport", marketplace_identity_id: "fb_profile_1", location: "Manassas, VA" },
    lead: { lead_id: "lead-e2e", buyer_display_name: "Ma", language_detected: "en" },
    thread: { thread_id: "e2e-thread", listing_id: "listing-e2e", listing_title: "2020 Tesla Model Y", turn_number: 3 },
    vehicle: { matched: true, year: 2020, make: "Tesla", model: "Model Y", price: 19500, vdp_url: "https://dealer.example/vdp/1", status: "available" },
    messages: [
      { role: "buyer", text: "$3k" },
      { role: "dealer", text: "We have plans starting at $1,000, $2,000, and $3,000 down." },
      { role: "buyer", text: "227-258-8199" },
    ],
  };
}

function signature(body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function startServer() {
  const app = express();
  app.use(express.raw({ type: "application/json" }));
  app.use(sofiaRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("Marketplace turn endpoint authenticates, returns shadow decision, and replays idempotently", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/sofia/v1/marketplace/turn`;
  const body = JSON.stringify(payload());

  const invalid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "X-1987-Signature": "bad" }, body });
  assert.equal(invalid.status, 401);

  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "X-1987-Signature": signature(body) }, body });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-sofia-mode"), "shadow");
  const firstDecision = await first.json();
  assert.equal(firstDecision.handoff.trigger, true);
  assert.equal(firstDecision.level, "A");
  assert.doesNotMatch(firstDecision.reply_text, /\?/);

  const replay = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "X-1987-Signature": signature(body) }, body });
  assert.deepEqual(await replay.json(), firstDecision);
});
