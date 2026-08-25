import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./messengerOutboundQueue.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../routes/conversations.ts", import.meta.url), "utf8");

test("Messenger outbound queue only stores and confirms the current normal reply", () => {
  assert.match(source, /kind: \"normal_reply\"/);
  assert.match(source, /export async function queueNormalReply/);
  assert.match(source, /export async function confirmOutboundDelivery/);
  assert.doesNotMatch(source, /claimDue|cancelClaim|follow.?up/i);
  assert.match(routeSource, /queueNormalReply/);
});
