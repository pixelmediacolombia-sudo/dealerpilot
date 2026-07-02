---
name: AI Studio validate stage — sharpness skip for BRIA product-shot outputs
description: Skip aiNotWorse sharpness regression when the composited image is an AI Studio output (usedFallback=0, studio- prefix URL). Only apply for fallback paths.
---

## Rule

In Stage 5 (`5_validate.ts`), the `aiNotWorse` sharpness regression check compares
the AI-processed image against the original dealer photo. **Skip this check** when:

- `img.compositedUrl?.startsWith("/api/static/ai-photos/studio-")` — the image is a
  BRIA Product Shot output (AI-generated studio scene, not the original background)
- AND `img.usedFallback === 0` — the AI actually ran, not a passthrough

**Why:** BRIA Product Shot replaces the entire scene — different background, lighting,
perspective, shadows. Global image statistics (mean luminance, std dev, sharpness score)
are fundamentally incomparable to the original dealer CDN photo. A 95/100 AI studio
output correctly fails the sharpness regression vs. a sharp original, giving a false
negative that marks the AI output as worse.

**How to apply:** The check is preserved for `usedFallback === 1` paths (background-removed
passthrough), where the vehicle content is identical and regression is meaningful.
