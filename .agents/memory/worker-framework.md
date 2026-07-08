---
name: Worker Framework v1.0
description: Generic in-process scheduler pattern used to run multiple background workers off one worker_state table, replacing bespoke per-feature catch-up logic.
---

DealerPilot's 6 background workers (inventory, opportunity, market, photo, publishing, learning) all run through one generic catch-up scheduler keyed by a shared `worker_state` table, instead of each feature owning its own setTimeout/catch-up logic.

**Why:** the inventory sync previously had its own bespoke catch-up scheduler. When a second and third scheduled job appeared (opportunity scores, market scan), duplicating that logic per-feature would have meant N slightly-different reimplementations of "did we miss a run while the server was down, and when do we run next." A single generic `scheduleWithCatchup` driven by DB state avoids that drift and gives every worker the same status/manual-trigger/timeline semantics for free.

**How to apply:** when adding a new scheduled background job, add a worker wrapper that reuses an existing engine (never duplicate business logic into the worker file) and register it with the shared scheduler/registry rather than writing a new ad hoc timer. Keep any pre-existing feature-specific helpers (e.g. `runSyncNow`, `setNextSyncAt`) that other UI/routes depend on — the generic scheduler calls into them, it doesn't replace them.

Cost-sensitive workers (e.g. anything calling paid AI APIs) should check a shared guardrail module (daily budget + max-per-run caps) before doing paid work, and report `skipped` with a reason rather than silently doing nothing.

**Crash isolation gotcha:** a per-worker try/catch around `worker.run()` is not enough — the DB bookkeeping calls that wrap it (the initial "Running" row insert, state upserts) must also be inside the outer catch, or a transient DB hiccup during that insert throws *outside* the try block. For auto-scheduled workers invoked as `void someAsyncFn()` (fire-and-forget), an uncaught rejection there is an unhandled promise rejection that can crash the whole process — not just fail one worker. The fix: wrap the entire run-once function body (bookkeeping + worker logic) in one outer try/catch that always returns a result and never rethrows.

Production readiness for this kind of framework should include a `<FRAMEWORK>_ENABLED=false` kill switch (env var) that disables automatic scheduling entirely while leaving manual/API triggers intact — useful for staging deploys that shouldn't spend budget or touch external systems automatically.
