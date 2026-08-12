import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const extensionRoute = read("artifacts/api-server/src/routes/extension.ts");
const conversationsRoute = read("artifacts/api-server/src/routes/conversations.ts");
const migration = read("lib/db/migrations/0004_multi_dealer_extension_sessions.sql");
const launcher = read("scripts/start-dealerpilot-messenger-sessions.ps1");
const messengerClient = read("chrome-extension-messenger/src/background/messengerClient.js");

test("two browser sessions have independent VPS profiles and debug ports", () => {
  assert.match(launcher, /--user-data-dir=\$profile/);
  assert.match(launcher, /Port = 9222/);
  assert.match(launcher, /Port = 9223/);
  assert.match(launcher, /Name = "lucky-mazda"; DealerId = 2/);
  assert.match(launcher, /chrome-extension-messenger/);
});

test("backend heartbeat and Messenger intake preserve dealer plus session identity", () => {
  assert.match(extensionRoute, /dealerId: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(extensionRoute, /sessionId: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(extensionRoute, /eq\(extensionConnectionsTable\.dealerId, normalized\.dealerId\)/);
  assert.match(extensionRoute, /eq\(extensionConnectionsTable\.sessionId, normalized\.sessionId\)/);
  assert.match(conversationsRoute, /eq\(conversationsTable\.dealerId, dealerId\)/);
  assert.match(conversationsRoute, /eq\(conversationsTable\.externalThreadRef, externalThreadRef\)/);
  assert.match(conversationsRoute, /sessionId: sessionId \?\? null/);
  assert.match(messengerClient, /sessionId: settings\.sessionId/);
  assert.match(messengerClient, /apiPost\("\/api\/extension\/heartbeat"/);
});

test("database migration removes the global conversation uniqueness boundary", () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS conversations_external_thread_ref_unique/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS conversations_dealer_external_thread_ref_idx/);
  assert.match(migration, /extension_connections_dealer_session_idx/);
});
