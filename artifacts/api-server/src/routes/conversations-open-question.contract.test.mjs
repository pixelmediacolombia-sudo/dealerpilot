import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("open questions block qualification advancement until answered", () => {
  assert.match(source, /type SalesReplyStage =\s*[\s\S]*\| "open_question"/);
  assert.match(source, /function buyerHasOpenQuestion\(latest: string\)/);
  assert.match(source, /if \(buyerHasOpenQuestion\(latest\)\) return "open_question"/);
  assert.match(source, /sales agents can help/);
  assert.doesNotMatch(source, /No tengo ese detalle confirmado/);
  assert.doesNotMatch(source, /Great question\. I do not have that detail confirmed/);
  assert.match(source, /stage === "open_question"[\s\S]*number/);
  assert.match(source, /certif\(\?:ied\|ication\)/);
});
