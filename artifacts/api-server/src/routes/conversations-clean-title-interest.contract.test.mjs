import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./conversations.ts", import.meta.url), "utf8");

test("clean-title replies answer the title question and immediately ask about interest", () => {
  const cleanTitleStage = source.indexOf('if (stage === "clean_title")');
  assert.ok(cleanTitleStage >= 0);
  const cleanTitleFallback = source.slice(cleanTitleStage, source.indexOf('if (stage === "clean_title_and_warranty")', cleanTitleStage));

  assert.match(cleanTitleFallback, /clean title|t[ií]tulo limpio/);
  assert.match(source, /Are you interested in proceeding with this vehicle/);
  assert.match(source, /clean_title: hasCleanTitleInventory[\s\S]*immediately ask whether the buyer is interested/);
  assert.match(source, /clean_title_interest_confirmation/);
});

test("affirmative replies after the clean-title prompt request the buyer phone and Alpha phone", () => {
  const transition = source.indexOf('return "clean_title_interest_confirmation";');
  assert.ok(transition >= 0);
  assert.match(source.slice(Math.max(0, transition - 700), transition), /historyContainsCleanTitleInterestPrompt/);
  assert.match(source.slice(transition, transition + 1200), /buyerAcceptedInterest\(latest\)/);

  const confirmationStage = source.indexOf('if (stage === "clean_title_interest_confirmation")');
  assert.ok(confirmationStage >= 0);
  const confirmationBlock = source.slice(confirmationStage, source.indexOf('if (stage === "clean_title")', confirmationStage));
  assert.match(confirmationBlock, /best phone number|best number|mejor número|mejor numero/);
  assert.match(confirmationBlock, /Alpha Motorsports/);
  assert.match(source, /stage === "clean_title_interest_confirmation"[\s\S]*replyIncludesStorePhone/);
});

test("the new state is a live handoff step, not a terminal conversation close", () => {
  assert.match(source, /stageRequiresStorePhone\(stage\)[\s\S]*clean_title_interest_confirmation/);
  assert.match(source, /Valid intent values:[\s\S]*clean_title_interest_confirmation/);
  assert.doesNotMatch(
    source,
    /closeAfterDelivery[\s\S]{0,300}clean_title_interest_confirmation/,
    "the buyer still needs to provide their own phone number",
  );
});
