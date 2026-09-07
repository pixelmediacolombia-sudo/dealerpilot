import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8");

const seed = read("seed.ts");
const scheduler = read("scheduler.ts");
const dealersRoute = read("../routes/dealers.ts");
const index = read("../index.ts");
const auth = read("../routes/auth.ts");

test("Lucky Mazda is seeded as an idempotent Marketplace-only dealer shell", () => {
  assert.match(seed, /const LUCKY_MAZDA = "Lucky Mazda"/);
  assert.match(seed, /export async function seedLuckyMazdaDealer/);
  assert.match(seed, /name: LUCKY_MAZDA/);
  assert.match(seed, /plan: "basic"/);
  assert.match(seed, /status: "Active"/);
  assert.match(seed, /marketplaceKnowledge: \{\}/);
  assert.match(seed, /XML inventory feed pending from Lucky Mazda/);
  const luckyInsert = seed.match(/\.values\(\{\s*name: LUCKY_MAZDA,[\s\S]*?marketplaceKnowledge: \{\},\s*\}\)/)?.[0] ?? "";
  assert.doesNotMatch(luckyInsert, /xmlFeedUrl/);
  assert.match(index, /\.then\(\(\) => seedLuckyMazdaDealer\(logger\)\)/);
  assert.match(index, /ensureLuckyMazdaUser\(luckyMazda\.id, logger\)/);
  assert.match(auth, /process\.env\.LUCKY_MAZDA_USERNAME/);
  assert.match(auth, /process\.env\.LUCKY_MAZDA_INITIAL_PASSWORD/);
  assert.match(auth, /export async function ensureLuckyMazdaUser/);
  assert.match(auth, /hashPassword\(password\)/);
  assert.match(auth, /insert into dealer_users/);
});

test("a dealer without an XML feed is skipped without an inventory error", () => {
  assert.match(scheduler, /function emptyInventorySummary\(\)/);
  assert.match(scheduler, /No inventory feed URL configured; inventory sync skipped/);
  assert.match(scheduler, /return emptyInventorySummary\(\)/);
  assert.match(dealersRoute, /if \(summary\.feedRunId === 0\)/);
  assert.match(dealersRoute, /status: "skipped"/);
  assert.match(dealersRoute, /errorCount: 0/);
  assert.match(dealersRoute, /errorMessage: null/);
});
