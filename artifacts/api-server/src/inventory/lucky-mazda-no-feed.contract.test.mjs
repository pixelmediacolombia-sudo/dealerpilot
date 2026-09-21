import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8");

const seed = read("seed.ts");
const config = read("dealerFeedConfig.ts");
const scheduler = read("scheduler.ts");
const dealersRoute = read("../routes/dealers.ts");
const index = read("../index.ts");
const auth = read("../routes/auth.ts");
const dealer = read("../lib/dealer.ts");
const importer = read("importFeed.ts");

test("Lucki Mazda is seeded as an idempotent Marketplace-only dealer shell", () => {
  assert.match(seed, /const LUCKI_MAZDA = "Lucki Mazda"/);
  assert.match(seed, /const LEGACY_LUCKY_MAZDA = "Lucky Mazda"/);
  assert.match(seed, /const LUCKI_NOTES_PENDING = "Marketplace-only account\. XML inventory feed pending from Lucki Mazda\."/);
  assert.match(config, /VINCUE_LUCKI_MAZDA_DEALER_ID/);
  assert.match(config, /VINCUE_LUCKI_MAZDA_XML_URL/);
  assert.match(config, /VINCUE_API_KEY_LUCKI_MAZDA/);
  assert.match(seed, /providerName: runtime\.providerName/);
  assert.match(seed, /providerDealerId: runtime\.providerDealerId/);
  assert.match(seed, /feedAuthMode: "x-api-key"/);
  assert.match(seed, /or\(eq\(dealersTable\.name, LUCKI_MAZDA\), eq\(dealersTable\.name, LEGACY_LUCKY_MAZDA\)\)/);
  assert.match(seed, /export async function seedLuckyMazdaDealer/);
  assert.match(seed, /name: LUCKI_MAZDA/);
  assert.match(seed, /plan: "basic"/);
  assert.match(seed, /status: "Active"/);
  assert.match(seed, /marketplaceKnowledge: \{\}/);
  assert.match(seed, /city: "Woodbridge"/);
  assert.match(seed, /state: "VA"/);
  assert.match(dealer, /LUCKI_MAZDA_DEALER_ID = 2/);
  assert.match(dealer, /LUCKI_MAZDA_LOT_WOODBRIDGE = "Woodbridge"/);
  assert.match(importer, /resolveImportedLotLocation\(dealerId, n\.lotLocation\)/);
  assert.match(importer, /never add the fallback to source_raw/);
  assert.match(seed, /XML inventory feed pending from Lucki Mazda/);
  assert.match(seed, /existing\.notes === LEGACY_LUCKY_NOTES/);
  assert.doesNotMatch(seed, /x-api-key\s*:\s*["']/);
  assert.match(index, /\.then\(\(\) => seedLuckyMazdaDealer\(logger\)\)/);
  assert.match(index, /ensureLuckyMazdaUser\(luckyMazda\.id, logger\)/);
  assert.match(auth, /process\.env\.LUCKY_MAZDA_USERNAME/);
  assert.match(auth, /process\.env\.LUCKY_MAZDA_INITIAL_PASSWORD/);
  assert.match(auth, /display_name = 'Lucki Mazda'/);
  assert.match(auth, /values \(\$1, \$2, \$3, 'Lucki Mazda'/);
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
