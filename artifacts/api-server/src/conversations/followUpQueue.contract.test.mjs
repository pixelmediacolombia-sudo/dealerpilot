import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./followUpQueue.ts", import.meta.url), "utf8");
const conversationsSource = readFileSync(
  new URL("../routes/conversations.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../../../lib/db/migrations/0006_messenger_follow_up_queue.sql", import.meta.url),
  "utf8",
);

test("follow-up queue is durable and schedules exactly three four-hour jobs", () => {
  assert.match(source, /FOLLOW_UP_DELAY_HOURS = 4/);
  assert.match(source, /MAX_FOLLOW_UPS = 3/);
  assert.match(source, /messenger_outbound_jobs/);
  assert.match(source, /messenger_follow_up_cycles/);
  assert.match(source, /buyer_message_missing/);
  assert.match(source, /coalesce\(l\.phone, ''\) = ''/);
  assert.match(source, /Este será nuestro último recordatorio/);
  assert.match(source, /Whenever you have a moment/);
  assert.match(source, /externalThreadRef\?: string \| null/);
  assert.match(source, /order by cycle\.updated_at desc, cycle\.id desc/);
});

test("migration owns the queue schema and the indexes needed by the extension claim loop", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS messenger_follow_up_cycles/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS messenger_outbound_jobs/i);
  assert.match(migration, /messenger_outbound_jobs_due_idx/i);
  assert.match(migration, /messenger_outbound_jobs_thread_idx/i);
});

test("a dealership phone request closes only after its reply is delivered and never starts a follow-up", () => {
  assert.match(conversationsSource, /buyerRequestedStorePhone/);
  assert.match(conversationsSource, /store_phone_requested/);
  assert.match(conversationsSource, /Con gusto, nuestro número es/);
  assert.match(conversationsSource, /closeConversationAfterDelivery/);
  assert.match(conversationsSource, /!closeAfterDelivery/);
  assert.match(conversationsSource, /close-after-delivery/);
  assert.match(conversationsSource, /status: "closed"/);
  assert.match(conversationsSource, /reason: "conversation_closed"/);
});
