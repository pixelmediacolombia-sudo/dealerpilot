---
name: FAL.ai Photo Pipeline — endpoint selection, URL delivery, and queue polling
description: Critical rules for BRIA RMBG 2.0 (direct) vs BRIA Product Shot (queue); how to deliver images to fal.ai without stalls; poll URL invariant.
---

## Rule: BRIA RMBG 2.0 uses DIRECT endpoint; BRIA Product Shot uses QUEUE endpoint

| Model | Endpoint | Reason |
|---|---|---|
| `fal-ai/bria/rmbg-v2.0` | `https://fal.run/{model}` (direct, ~750ms) | Synchronous; fine with base64 payloads |
| `fal-ai/bria/product-shot` | `https://queue.fal.run/{model}` (queue, ~22-28s) | Long-running; must be queued |

**Why this matters:** Old code used direct `fal.run` for product-shot and it timed out every time.
Old code used queue for RMBG which worked but was slower than needed.

## Rule: always use status_url and response_url from the submit response for polling

When calling `queue.fal.run`, the submit response contains:
```json
{ "request_id": "...", "status_url": "...", "response_url": "..." }
```

The `status_url` path looks like `queue.fal.run/fal-ai/bria/requests/{id}/status`
— NOT `queue.fal.run/fal-ai/bria/product-shot/requests/{id}/status`.

**Never reconstruct poll URLs from the model path.** Always use `status_url` / `response_url`
verbatim from the submit response. Getting this wrong causes every poll to return empty JSON,
silently looping until the 90–120s timeout without error.

## Rule: pass public HTTPS URLs to queue endpoints — never base64 for large images

Queue endpoints stall silently when the body exceeds ~2 MB. Base64-encoding a 1536×1024 PNG
(~8 MB raw → ~11 MB base64) causes silent queue stalls that look like polling failures.

**For local /api/static/... files:** use `REPLIT_DEV_DOMAIN` env var to expose them publicly:
```
https://${REPLIT_DEV_DOMAIN}/api/static/ai-photos/backgrounds/background-alpha-v2.png
```
This URL returns HTTP 200 from fal.ai's inference servers (verified). Falls back to
two-step fal.ai storage initiate (`POST /storage/upload/initiate`) + PUT raw bytes.

**For dealer CDN images (cdnimages.dealersgpt.com):** still blocked by fal.ai hotlink
protection. For BRIA RMBG (direct endpoint), base64-encode via `toDataUrl()` — payload is
small enough (<2 MB after RMBG output) to pass safely.

## Rule: /api/static/ paths on the server must be fetched via localhost HTTP

Do NOT use `fs.readFile("/api/static/…")` — that path doesn't exist on disk.
Rewrite to `http://localhost:{PORT}{imageUrl}` before fetching.

## FAL.ai balance tracking

FAL.ai has no public balance API (all endpoints 404). Track cumulative spend from
`ai_photo_images WHERE removal_provider = 'falai' AND used_fallback = 0`.
Default cost: $0.01/image (env `FAL_COST_PER_IMAGE_USD`).
Stats endpoint `GET /api/photo-studio/stats` returns the `fal` object with this data.
