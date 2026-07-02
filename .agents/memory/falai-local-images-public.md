---
name: FAL.ai queued endpoints — making local images publicly accessible
description: Queue endpoints require public HTTPS URLs; base64 over ~2MB stalls silently. Use REPLIT_DEV_DOMAIN or fal.ai storage upload.
---

## Problem

fal.ai queue endpoints download images from the URLs you provide. Two failure modes:
1. **Private/local URLs** — fal.ai can't reach `localhost` or `127.0.0.1`; job stalls silently.
2. **Base64 payloads over ~2 MB** — queue silently stalls with no error; looks like a poll loop.

## Solution A: REPLIT_DEV_DOMAIN (preferred for dev)

Local `/api/static/...` files are accessible via:
```
https://${process.env.REPLIT_DEV_DOMAIN}/api/static/ai-photos/backgrounds/background-alpha-v2.png
```
Verified: returns HTTP 200 from fal.ai inference servers. Fast, no upload cost.

The helper `toPublicFalUrl()` in `providers/falai.ts` handles this rewrite automatically.

## Solution B: fal.ai storage upload (fallback / production)

Two-step process:
1. `POST https://storage.fal.run/upload/initiate` → get upload URL
2. `PUT {upload_url}` with raw bytes → returns CDN URL

Use this when `REPLIT_DEV_DOMAIN` is not set (e.g. production deployment without the env var).

## What NOT to do

- Do not pass `data:image/...;base64,...` to queue endpoints if image > ~1.5 MB raw.
- Do not pass bare `/api/static/...` paths — fal.ai can't resolve relative server paths.
- BRIA RMBG (direct `fal.run`) is fine with base64 since the output is small (<1 MB).
