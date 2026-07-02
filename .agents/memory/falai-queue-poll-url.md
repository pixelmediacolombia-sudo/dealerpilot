---
name: FAL.ai queue poll URL bug
description: queue.fal.run submit returns a status_url whose path differs from the model submission path — never reconstruct it manually.
---

## The bug

When submitting to `queue.fal.run/fal-ai/bria/product-shot`, the poll path in the
response is `queue.fal.run/fal-ai/bria/requests/{id}/status` — notice: no `/product-shot/`
segment. Reconstructing the URL from the model path produces a dead endpoint that returns
empty JSON on every poll, silently looping until timeout (90–120 s).

## The fix

Always use `status_url` and `response_url` verbatim from the submit response body:
```typescript
const submit = await fetch(`https://queue.fal.run/${MODEL}`, { method: "POST", body: ... });
const { status_url, response_url } = await submit.json();
// poll status_url until { status: "COMPLETED" }, then fetch response_url
```

**Why:** fal.ai's queue routing is model-family-based, not model-path-based. The submit
endpoint can differ from the status/result endpoints. This is undocumented and has tripped
us before. Never hardcode or reconstruct poll URLs.

**How to apply:** Any new fal.ai queue integration must extract and use `status_url` /
`response_url` from the first response. Grep for `queue.fal.run` before adding a new model.
