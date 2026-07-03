---
name: Sales AI Response Engine
description: Intent detection, escalation logic, qualification flow, Zod barrel collision fix, ConversationDetail UI patterns, and 20-message acceptance test suite.
---

## Zod barrel collision fix pattern

When Orval codegen generates a type that collides with one already exported from `./generated/types`, TypeScript throws TS2308. Fix by adding an explicit re-export override in `lib/api-zod/src/index.ts`:

```ts
export { UpdateConversationAutoReplyBody } from "./generated/api";
```

This overrides the ambiguous wildcard re-export. The existing entries (`UpdateConversationStatusBody`, `AssignPublishingJobBody`, etc.) show the established pattern — always check this file first when codegen produces a TS2308 error.

**Why:** `export * from "./generated/api"` and `export * from "./generated/types"` both emit the same name; explicit wins.

## Backend helpers (conversations.ts)

- `detectIntent(msg)` — keyword-based, returns one of ~10 intent strings (`availability`, `price_inquiry`, `financing`, `document_inquiry`, `appointment_request`, `purchase_timeline`, `down_payment`, `credit_inquiry`, `location`, `document_list`, `general_inquiry`)
- `shouldEscalate(msg, intent, suggestedReply)` — returns `{escalate, reason}` for: appointment requests, phone numbers, anger/scam keywords, legal/rate questions, approval guarantees
- `getMissingQualificationFields(conv)` — checks `qualification` JSON on the conversation row; returns array of missing field labels for the "Still needed" UI badges

## New endpoints

- `POST /sales-ai/test-message` — stateless QA route, no DB writes; returns full AI analysis object (intent, language, leadScore, temperature, escalationDecision, suggestedReply, missingFields)
- `PATCH /conversations/:id/auto-reply` — toggles `autoReplyEnabled` boolean on conversations table

## ConversationDetail UI (Sprint Sales AI)

Right panel layout:
1. **Next Best Action** — derived from missing fields priority order
2. **Buyer Profile** — name, COLD/WARM/HOT badge, lead score, down payment, phone, timeline
3. **Qualification** — ID/Tax ID, Proof of income, Appointment intent — each "—" or value
4. **Still Needed** badges — amber badge chips for each missing field

Left panel:
- Message Timeline (buyer messages + AI reply bubbles)
- AI Suggested Reply card with Auto-Reply toggle (Switch component + `useUpdateConversationAutoReply` hook) + Copy Reply button

Auto-Reply toggle label: "Manual copy & paste" when OFF, "Auto-send enabled" when ON.

## 20-message acceptance test results (all PASS)

Key signals validated:
- Spanish detection: "cuánto de inicial?" → lang=es ✓
- Escalation: appointment requests, phone numbers, anger, legal questions, approval guarantees → escalate=YES ✓
- No escalation: browsing, DoorDash income question, general availability → escalate=no ✓
- Intent variety: down_payment, document_inquiry, appointment_request, financing, credit_inquiry, availability, price_inquiry, purchase_timeline all firing correctly ✓

Test seed: POST /api/conversations/intake with externalThreadRef, buyerName, visibleMessages, currentMessage, detectedVehicleTitle, marketplaceDownPayment fields.
