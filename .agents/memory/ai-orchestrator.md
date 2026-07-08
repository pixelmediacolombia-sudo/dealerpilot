---
name: AI Orchestrator (decision layer over workers)
description: A decision layer sits above the 6 background workers and decides RUN/SKIP/PAUSE per cycle instead of each worker firing on its own blind timer.
---

DealerPilot's 6 background workers no longer each own a timer. A single orchestrator cycle runs on one shared interval (matched to the shortest worker's natural cadence) and calls a per-worker `decide()` function that inspects real state — dependency freshness, upstream data changes, budget remaining, external dependency (extension) health — to return RUN, SKIP, or PAUSE with a human-readable reason.

**Why:** blind per-worker timers can't express "only run the opportunity scorer if inventory actually changed" or "pause photo work once the daily AI budget is exhausted rather than silently no-op every cycle forever." Centralizing the decision makes the reasoning inspectable (one status endpoint, one timeline entry per decision) instead of scattered across each worker's internal early-return checks.

**How to apply:** the decision layer must stay read-mostly and delegate actual execution to the existing per-worker `runWorkerOnce`/engine functions — never duplicate a worker's business logic inside a `decide()` function, only the "should this run at all" gate. Each `decide()` function should reuse existing budget/dependency-check helpers (e.g. cost guardrail, extension-online check) rather than reimplementing them. The orchestrator's own read/write path (status snapshot + decision log) must never throw — wrap it so a failure degrades to a "Failed" status rather than crashing the API process, since this endpoint is polled continuously by the dashboard.
