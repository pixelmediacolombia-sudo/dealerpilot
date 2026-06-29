---
name: OpenAI Chat Completions token param
description: gpt-5-mini and newer models require max_completion_tokens not max_tokens; low limits produce empty content; fallback needs || not ??
---

## Rule
When using `openai.chat.completions.create()` with `gpt-5-mini` (and likely all gpt-5 family models via Replit's AI proxy):

1. Use `max_completion_tokens`, NOT `max_tokens` — the API returns 400 if you use `max_tokens`.
2. Set it to at least **1024** — at 200 the model may return an empty string `""` rather than erroring.
3. Guard the result with `||` not `??`:
   ```ts
   const raw = response.choices[0]?.message?.content?.trim();
   const reply = (raw && raw.length > 0) ? raw : FALLBACK;
   ```
   Because `??` only catches null/undefined, not the empty string the model returns when truncated.

**Why:** `max_tokens` is the legacy Chat Completions parameter; newer gpt-5 models reject it. The model silently returns `""` at 200 tokens rather than throwing — setting 1024 reliably produces full replies.

**How to apply:** Any new route that calls `openai.chat.completions.create()` for reply generation.
