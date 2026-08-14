import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("stalled buyer conversations deterministically request a phone number", () => {
  assert.match(source, /"stalled_conversation_request_phone"/);
  assert.match(source, /function hasStalledConversation\(/);
  assert.match(source, /stalledBuyerTurns >= 2/);
  assert.match(source, /function buyerMovesConversationForward\(/);
  assert.match(source, /function buyerClearlyAdvancesFinancing\(/);
  assert.match(source, /buyerClearlyAdvancesFinancing[\s\S]*?\[?¿\]/);
  assert.match(source, /buyerRequestedVisitOrTestDrive\(normalized\)/);
  assert.match(source, /buyerAcceptedCashOrVisitStep\(normalized\)/);
  assert.match(source, /!buyerExplicitlyDisengages\(currentMessage\)/);
  assert.match(source, /if \(hasStalledConversation\(visibleMessages, currentMessage\)\) return "stalled_conversation_request_phone"/);
  assert.match(source, /Skip the normal funnel and ask once for the buyer's best phone number/);
  assert.match(source, /Do not repeat a financing-interest question, financing requirements, or a vehicle-detail question/);
});
