---
name: DealerPilot listings & publishing engine
description: Durable design decisions for Sprint 2 (AI listing generation + publishing job queue) — concurrency rules, deterministic-vs-AI split, and API/UI enum contracts.
---

# Publishing job state machine

All job transitions (`claim`, `complete`, `fail`) MUST use a single atomic conditional
UPDATE whose WHERE clause includes the required current status, not read-then-write.
- claim: `WHERE id = ? AND status IN ('Queued','Retry') AND claimed_by_extension IS NULL`; 0 rows updated → 409.
- complete / fail: `WHERE id = ? AND status = 'Publishing'`; 0 rows → 409.

**Why:** the Chrome extension polls `/publishing/jobs/next` and can call claim concurrently;
read-then-write let two extensions double-claim the same job, and unguarded complete/fail
allowed out-of-order / illegal transitions on any job id.
**How to apply:** any new transition endpoint must encode its legal predecessor states in the
UPDATE WHERE and return 409 when no row matches. Lifecycle: Queued → Publishing → Published,
with Publishing → Retry (attempts < MAX_ATTEMPTS=3) or → Failed.

# Deterministic vs AI split

Down payment (rules.ts), listing score 0-100 → Excellent/Good/Needs Improvement (scoring.ts),
and priority are computed deterministically server-side. The AI generator writes ONLY text
(title ≤100 chars emoji-stripped, ES+EN descriptions, CTA, buyer profile), grounded by a facts
object built from XML inventory fields (missing fields omitted, never invented).
**Why:** business rules must be reproducible/auditable; grounding the prompt with only XML data
is how the "AI uses ONLY XML data, no hallucination" requirement is satisfied.

# Listing/publishing enum contracts (API ↔ dashboard)

The `/listings` workspace response uses these exact strings the dashboard must match:
- `aiStatus`: "AI Generated" | "Not Started"
- `publishStatus`: a job status ("Queued","Publishing","Published","Failed","Retry") | "Approved" | "Not Queued"
- `status`: current listing-version status ("Draft","AI Generated","Ready for Review","Approved")
The `status` query-param filter matches against `w.status OR w.publishStatus`, so dashboard
filter options must be drawn from those real values (not inventory statuses like "Active").
**Why:** a mismatch silently breaks badge styling, stat counts, and filtering with no error.
