---
name: Creative Intelligence Engine
description: Durable design constraints for the Sprint 4 creative generation module (in-process worker, pluggable image pipeline, versioning).
---

# Creative Intelligence Engine (Sprint 4)

Generates Marketplace creatives from Dealer Brand DNA via an in-process background worker.

## Pluggable image pipeline — keep the contract stable
The persisted contract is `renderSpec` (composition recipe) + `outputs[]` (one per
size/placement, each with a placeholder `url`). The UI renders previews from
`renderSpec` via **CSS**, not from the output `url`s.

**Why:** a real image provider must swap in later by filling `outputs[].url` (and
optionally consuming `renderSpec`) with **no DB or UI changes**. Do not make the UI
depend on the placeholder URLs, and do not add provider-specific columns.

## Versioning invariants
Each generation appends a new `creative_versions` row with an incremented `version`;
rows are **never overwritten**. At most one version per vehicle is `isDefault`. The
first creative for a vehicle becomes default automatically.

**How to apply:** there is a unique index on `(vehicle_id, version)`. The in-process
worker is single-instance and claims one job at a time sequentially, so version
computation (max+1) is safe in practice. If a second worker/instance is ever added,
move version+default assignment into a per-vehicle locked transaction (advisory lock)
before relying on it — the unique index will otherwise surface as insert errors.

## Worker recovery
On boot the worker requeues all `Generating` jobs back to `Queued`. This is correct
for single-instance recovery after a crash, but is **not** multi-instance safe (it
would steal another live instance's in-flight jobs). Revisit if scaling out.

## Status values
Creative status vocabulary is `None | Queued | Generating | Generated | Approved`
(there is no "Ready"). Frontend "ready" counts must use `Generated`/`Approved`.
