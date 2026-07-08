---
name: Worker daily spend guardrails (FAL + OpenAI)
description: How the hard-stop daily budget guardrails for FAL and OpenAI calls are structured, and how worker pause/resume state works
---

## The rule
Never estimate AI spend from job/vehicle counts. Track one `ai_usage_events` row per REAL API call (provider: "openai"|"fal", purpose describes the call site), and check the relevant `checkXBudget()` **before** every real call — not once per job or per vehicle.

**Why:** A job-count or vehicle-count estimate drifts badly once jobs contain a variable number of images (e.g. FAL background-removal + composite calls per vehicle vary 3-15x). A budget check that runs once at enqueue time cannot hard-stop mid-job overspend; only a per-call check can.

## How to apply
- Budget checks and usage recording live in `costGuardrail.ts`. Each pipeline stage that makes a real external call (photo classification, FAL bg-removal, FAL composite) checks budget immediately before the call and records usage immediately after a successful call — errors/fallbacks never record usage.
- Use a `budgetExhaustedThisStage` flag inside per-image loops so once the budget is gone, remaining images in the same job skip straight to fallback (original image, `usedFallback=1`) without re-checking the DB every iteration, and the "daily budget reached" warning logs only once per stage.
- Midnight reset requires no cron/flag-clearing: every budget query is bounded by local midnight (`todayStart()`), so a new day naturally zeroes spend.
- Worker auto-resume: a worker's "paused" state is NOT a persisted sticky flag — `pauseReason` on `worker_state` is recomputed and overwritten every run (cleared to null when the worker doesn't pause that cycle). This is what makes resumption automatic after the daily reset.
- Dashboard-facing runtime status (e.g. "Running" / "Paused (Budget)" / "Paused (No Vehicles)" / "Sleeping") is derived server-side from `enabled` + `pauseReason` + `lastRunAt` recency — kept separate from the generic Online/Sleeping/Failed status used by all workers, since only some workers have meaningful pause reasons.
