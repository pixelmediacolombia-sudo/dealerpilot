---
name: FAL.ai Photo Pipeline — dealer CDN access + endpoint selection
description: How the AI Photo Studio connects to fal.ai for BRIA RMBG 2.0 inference; CDN access workaround and endpoint choice.
---

## Rule: always use the DIRECT fal.run endpoint, not the queue

Use `https://fal.run/{model_path}` (direct, ~750ms response).
Do NOT use `https://queue.fal.run/{model_path}` (queue-based polling).

**Why:** The queue endpoint with large base64 payloads can sit in queue for 2+ minutes and
time out even with 60 polls × 2s = 120s budgeted. The direct endpoint returns synchronously
in ~750ms for BRIA RMBG 2.0 regardless of payload size.

## Rule: always base64-encode dealer CDN images before submitting to fal.ai

Dealer CDN images at `cdnimages.dealersgpt.com` are NOT accessible from fal.ai's
inference servers (hotlink protection / regional restriction). Submitting the raw CDN URL
causes every fal.ai job to time out silently (the image download on their end hangs).

**Fix in `falai.ts`:** Download the image with `fetch()`, base64-encode it, and submit
as `data:image/jpeg;base64,{b64}` in the `image_url` field. fal.ai accepts data URLs.

**How to apply:** Any fal.ai model invocation that passes a dealer CDN image URL must
go through `toDataUrl()` first. This applies to BRIA RMBG 2.0 and any future models.
The `toDataUrl()` function also handles `/api/static/…` paths by fetching from localhost.

## Rule: /api/static/ paths must be fetched via localhost HTTP, not the filesystem

The composite stage and the FAL.ai `toDataUrl()` helper both handle this:
if `imageUrl.startsWith("/api/")`, rewrite to `http://localhost:{PORT}{imageUrl}`.
Do NOT use `fs.readFile("/api/static/…")` — that path does not exist on disk.

## FAL.ai balance tracking

FAL.ai has no public balance API (all endpoints 404). Instead, track cumulative spend
from `ai_photo_images WHERE removal_provider = 'falai' AND used_fallback = 0`.
Default cost: $0.01/image (env `FAL_COST_PER_IMAGE_USD`).
Warning threshold: $10 (env `FAL_LOW_BALANCE_THRESHOLD_USD`).
Stats endpoint `GET /api/photo-studio/stats` returns the `fal` object with this data.
Dashboard shows an amber banner when `fal.lowBalanceWarning === true`.
