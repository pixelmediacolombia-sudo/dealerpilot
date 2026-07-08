---
name: Controlled Mode publish guardrails
description: How fully-automatic Facebook Marketplace publishing (Controlled Mode) is gated so it can never bypass safety checks.
---

Publish mode (Assisted vs Controlled) is always resolved server-side from `MARKETPLACE_CONTROLLED_MODE_ENABLED` (env master switch) plus the dealer's `autoClickPublish` setting — a client-sent `mode` value is never trusted or persisted as-is.

**Why:** the whole point of Controlled Mode is that the extension clicks Publish with no human in the loop, so any client-controlled or unchecked path into it is a real risk (wrong lot, GM-flagged listing, duplicate, or a disconnected extension silently no-op'ing). Centralizing the checks means every future job-creation entrypoint inherits the same safety bar automatically.

**How to apply:** any new path that can create a publishing job (beyond `publish-now`, `bulk-schedule`, `/auto-publish/batches`, `/auto-publish/dry-run`) must call the shared `checkPublishGuardrails()` / `resolvePublishMode()` helpers instead of re-implementing checks or accepting a client-provided mode. Extension-offline is only enforced when the resolved mode is Controlled — Assisted jobs are allowed to queue without the extension being connected.
