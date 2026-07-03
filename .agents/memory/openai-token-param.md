---
name: OpenAI Chat Completions token param
description: gpt-5-mini and newer models require max_completion_tokens not max_tokens; low limits produce empty content; fallback needs || not ??; JSON extraction pattern for GM-style structured responses.
---

## Rule
When using `openai.chat.completions.create()` with `gpt-5-mini` (and likely all gpt-5 family models via Replit's AI proxy):

1. Use `max_completion_tokens`, NOT `max_tokens` — the API returns 400 if you use `max_tokens`.
2. Set it to at least **1024** for simple replies — use **2048** for structured JSON outputs (GM analysis, multi-field objects).
3. Guard the result with `||` not `??`:
   ```ts
   const raw = response.choices[0]?.message?.content || "";
   ```
   Because `??` only catches null/undefined, not the empty string the model returns when truncated.
4. Check `if (!raw)` separately before attempting JSON.parse — log it as an error and return 503.
5. Always log `finish_reason` and `rawLen` to diagnose truncation vs empty content.

## JSON extraction pattern
When the response may wrap JSON in markdown fences or prose:
```ts
const jsonMatch = raw.match(/\{[\s\S]*\}/);
const jsonStr = jsonMatch ? jsonMatch[0] : raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
parsed = JSON.parse(jsonStr);
```

**Why:** `max_tokens` is the legacy Chat Completions parameter; newer gpt-5 models reject it. The model silently returns `""` at low token limits rather than throwing. The regex extraction handles cases where the model wraps JSON in prose or markdown.

**How to apply:** Any new route that calls `openai.chat.completions.create()` for reply generation or structured JSON output. Applied in `artifacts/api-server/src/routes/gm.ts`.
