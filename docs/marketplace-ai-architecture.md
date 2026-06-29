# Marketplace AI — Technical Architecture (Phase 1: Design Only)

**Author:** CTO / Senior Software Architect
**Status:** Architecture proposal — no implementation
**Product:** Marketplace AI — a standalone SaaS for marketing agencies that manage Facebook Marketplace on behalf of multiple car dealerships.
**First tenant:** Alpha Motorsport
**Explicitly NOT** part of AdBrain. Separate codebase, separate billing, separate infrastructure.

---

## 0. Executive Summary

Marketplace AI is a multi-tenant SaaS that:

1. Ingests dealer inventory from **XML feeds** (never scraping).
2. Detects inventory deltas (new / sold / price change / image change).
3. Generates **AI-optimized Marketplace listings** (titles, descriptions, pricing, down payment).
4. Manages **AI-assisted Messenger conversations** and auto-builds a **Lead CRM**.
5. Publishes to Facebook Marketplace via a **Chrome Extension** (designed now, built later).
6. Layers on **Dealer Brand DNA**, an **AI Photo Studio**, lead scoring, and reporting.

The core architectural bet: Facebook has no official Marketplace listing API for dealers, so **publishing and Messenger must run client-side through a browser extension** acting as the human operator's assistant. Everything else (ingestion, AI, CRM, analytics) is a conventional cloud backend. This split — **cloud brain + browser hands** — drives most of the design.

Competitors (Social Vehicle Lister, MRKTLISTER, AutoLander, Glo3D) solve listing automation. Our differentiation is the **AI layer + Brand DNA + integrated CRM**, so the architecture treats AI and lead data as first-class subsystems, not bolt-ons.

---

## 1. Folder Structure

A pnpm monorepo. Apps are deployable; packages are shared libraries.

```text
marketplace-ai/
├── apps/
│   ├── api/                     # Core backend API (REST + webhooks)
│   │   ├── src/
│   │   │   ├── modules/         # Feature modules (see Backend Architecture)
│   │   │   │   ├── auth/
│   │   │   │   ├── dealers/
│   │   │   │   ├── inventory/
│   │   │   │   ├── listings/
│   │   │   │   ├── brand-dna/
│   │   │   │   ├── photo-studio/
│   │   │   │   ├── messenger/
│   │   │   │   ├── leads/
│   │   │   │   ├── publishing/
│   │   │   │   ├── reports/
│   │   │   │   └── extension-gateway/   # endpoints the Chrome ext talks to
│   │   │   ├── middleware/
│   │   │   ├── lib/
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   ├── worker/                  # Background job processors (separate process)
│   │   ├── src/
│   │   │   ├── jobs/
│   │   │   │   ├── feed-import/
│   │   │   │   ├── delta-detect/
│   │   │   │   ├── ai-generation/
│   │   │   │   ├── image-processing/
│   │   │   │   ├── lead-scoring/
│   │   │   │   └── notifications/
│   │   │   └── worker.ts
│   │   └── package.json
│   │
│   ├── web/                     # Agency + dealer dashboard (React SPA)
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── features/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   └── package.json
│   │
│   └── extension/               # Chrome Extension (designed Phase 1, built later)
│       ├── src/
│       │   ├── background/      # service worker
│       │   ├── content/         # content scripts (Marketplace + Messenger DOM)
│       │   ├── popup/           # extension UI
│       │   └── lib/
│       └── manifest.json
│
├── packages/
│   ├── db/                      # Drizzle schema, migrations, query helpers
│   ├── api-spec/                # OpenAPI spec — single source of truth
│   ├── api-client/              # Generated typed client + React Query hooks
│   ├── ai/                      # AI service layer (prompts, providers, guards)
│   ├── shared/                  # Shared types, zod schemas, constants
│   ├── feed-parser/             # XML feed parsing + normalization
│   └── ui/                      # Shared component library / design tokens
│
├── infra/                       # IaC, deployment config, migrations runner
└── docs/                        # Architecture, runbooks, ADRs
```

**Why this shape:**
- `api` and `worker` are separate deployables so heavy ingestion/AI work never blocks request latency.
- `extension-gateway` is its own API module because the extension is an untrusted, rate-sensitive client with a distinct auth and contract surface.
- `feed-parser` and `ai` are isolated packages so they can be unit-tested and swapped without touching transport code.
- `api-spec` → `api-client` is contract-first: the spec generates the typed client, so frontend and backend never drift.

---

## 2. Backend Architecture

**Style:** Modular monolith for the API (one deployable, clear module boundaries), plus a separate worker process. This is deliberately *not* microservices at Phase 1 — a modular monolith ships faster, is cheaper to operate, and the module seams make later extraction painless if a module (e.g. AI or publishing) needs independent scaling.

**Runtime:** Node.js + TypeScript, Express (or Fastify), PostgreSQL via Drizzle ORM, Redis for queues/cache, object storage (S3-compatible) for images.

**Layering inside each module:**

```text
module/
├── routes.ts        # HTTP layer: validation (zod), auth, mapping
├── service.ts       # business logic — no HTTP, no SQL details
├── repository.ts    # data access (Drizzle queries)
├── schema.ts        # zod request/response contracts
└── events.ts        # domain events emitted to the queue
```

**Cross-cutting concerns:**
- **Validation:** zod at the boundary; reject early.
- **Auth/Tenancy:** middleware resolves `agency_id` + `dealer_id` scope on every request; all queries are tenant-scoped (see Security §12).
- **Eventing:** services emit domain events (`vehicle.created`, `price.changed`, `lead.created`) onto Redis/queue; the worker consumes them. This decouples ingestion from AI generation from notifications.
- **Idempotency:** feed imports and extension callbacks carry idempotency keys to survive retries.

**Service boundaries (logical):**

| Service | Responsibility |
|---|---|
| Inventory | Feed import, delta detection, vehicle lifecycle |
| Listings | Marketplace listing generation, versioning, publish state |
| AI | Title/description/pricing/Brand-DNA/Messenger generation |
| Messenger | Conversation state, AI reply suggestions, human handoff |
| Leads | CRM records, pipeline stages, scoring |
| Publishing | Queue + extension orchestration |
| Reports | Aggregations, analytics rollups |
| Extension Gateway | Auth + command/result exchange with browser extension |

---

## 3. Frontend Architecture

**Web dashboard** — React + Vite SPA, TypeScript, React Query for server state, Tailwind + shared `ui` package for design.

**Top-level routes (the System Modules):**

```text
/dashboard            # KPIs: active listings, leads, conversations, sold
/dealers              # agency-level dealer management
/dealers/:id          # single dealer cockpit
/inventory            # vehicle list, filters, delta history
/inventory/:vin       # vehicle detail + listing + photos
/listings             # marketplace listings + publish state
/brand-dna            # dealer brand voice config + AI generation
/photo-studio         # AI background / image editing per vehicle
/messenger            # unified AI-assisted inbox
/leads                # CRM board (pipeline) + lead detail
/publishing           # publishing queue + extension status
/reports              # analytics, exports
/settings             # users, roles, feeds, billing, integrations
```

**State model:**
- **Server state:** React Query (generated hooks from `api-client`).
- **Realtime:** WebSocket/SSE channel for live Messenger messages, publish-queue status, and feed-import progress.
- **Local UI state:** component-local + lightweight store (Zustand) for cross-cutting UI (selected dealer scope).

**Multi-tenant UX:** A persistent "dealer scope" selector. Agency users can switch between dealers; dealer users are locked to their own. All API calls inherit the active scope.

---

## 4. Database Design (PostgreSQL)

Design principles: every table tenant-scoped, soft deletes where history matters, immutable change-history tables for audit, JSONB only for genuinely schemaless data (raw feed payloads, AI metadata).

### 4.1 Tenancy & Identity

```text
agencies
  id (uuid, pk)
  name
  status
  created_at, updated_at

dealers
  id (uuid, pk)
  agency_id (fk -> agencies) [idx]
  name
  slug
  status                       # active | paused | archived
  facebook_page_ref            # logical link, not API creds
  created_at, updated_at
  INDEX (agency_id, status)

users
  id (uuid, pk)
  agency_id (fk -> agencies) [idx]
  email (unique)
  password_hash | external_auth_id
  name
  role                         # see User Roles §5
  status
  last_login_at
  created_at, updated_at

user_dealer_access            # which dealers a user can see (for dealer-scoped roles)
  user_id (fk)
  dealer_id (fk)
  PRIMARY KEY (user_id, dealer_id)
```

### 4.2 Inventory

```text
feeds
  id (uuid, pk)
  dealer_id (fk) [idx]
  url
  format                       # xml
  schedule_cron
  last_run_at
  last_status                  # success | partial | failed
  auth_config (jsonb)          # if feed needs creds
  created_at, updated_at

feed_runs                      # one row per import attempt (audit/observability)
  id (uuid, pk)
  feed_id (fk) [idx]
  started_at, finished_at
  status
  counts (jsonb)               # {created, updated, sold, price_changes, image_changes, errors}
  error_detail (jsonb)

vehicles
  id (uuid, pk)
  dealer_id (fk) [idx]
  vin (text) [idx]
  stock_number (text)
  vehicle_url (text)
  status                       # available | sold | removed
  year (int), make, model, trim, color
  price_cents (bigint)
  mileage (int)
  description (text)
  source_hash (text)           # hash of normalized feed payload for fast delta
  first_seen_at, last_seen_at
  sold_at, removed_at
  raw_payload (jsonb)          # last raw feed entry
  created_at, updated_at
  UNIQUE (dealer_id, vin)
  INDEX (dealer_id, status)
  INDEX (dealer_id, make, model)

vehicle_images
  id (uuid, pk)
  vehicle_id (fk) [idx]
  source_url (text)
  storage_key (text)           # our copy in object storage
  position (int)
  image_hash (text)            # perceptual/content hash for change detection
  studio_variant_of (fk null)  # links AI-edited image to original
  created_at

vehicle_changes               # immutable delta log
  id (uuid, pk)
  vehicle_id (fk) [idx]
  feed_run_id (fk)
  change_type                  # created | sold | price | image | field
  old_value (jsonb), new_value (jsonb)
  created_at [idx]
```

### 4.3 Listings & Publishing

```text
listings
  id (uuid, pk)
  vehicle_id (fk) [idx]
  dealer_id (fk) [idx]
  title (text)                 # AI-generated, editable
  body (text)                  # AI-generated, editable
  suggested_price_cents (bigint)
  suggested_down_payment_cents (bigint)
  status                       # draft | ready | queued | published | expired | failed
  marketplace_ref (text null)  # external id captured by extension after publish
  version (int)
  created_at, updated_at
  INDEX (dealer_id, status)

listing_versions              # history of edits / regenerations
  id (uuid, pk)
  listing_id (fk) [idx]
  title, body, price snapshot fields
  generated_by                 # ai | human
  ai_run_id (fk null)
  created_at

publishing_jobs
  id (uuid, pk)
  listing_id (fk) [idx]
  dealer_id (fk) [idx]
  action                       # publish | renew | update | remove
  status                       # pending | claimed | in_progress | done | failed
  claimed_by_extension (text null)
  attempts (int)
  idempotency_key (unique)
  result (jsonb)
  scheduled_for, created_at, updated_at
  INDEX (dealer_id, status, scheduled_for)
```

### 4.4 Brand DNA & AI

```text
brand_dna
  id (uuid, pk)
  dealer_id (fk, unique) [idx]
  tone (jsonb)                 # voice attributes
  value_props (jsonb)
  disclaimers (text)
  templates (jsonb)            # title/body templates
  generated_by_ai (bool)
  updated_at

ai_runs                        # every AI call for cost + audit + reproducibility
  id (uuid, pk)
  dealer_id (fk) [idx]
  feature                      # title | description | pricing | brand_dna | messenger | photo | lead_score
  provider, model
  input_ref (jsonb)            # prompt inputs (no secrets)
  output (jsonb)
  tokens_in, tokens_out, cost_cents
  status, latency_ms
  created_at [idx]
```

### 4.5 Messenger & Leads (CRM)

```text
conversations
  id (uuid, pk)
  dealer_id (fk) [idx]
  lead_id (fk null)
  vehicle_id (fk null)         # vehicle the buyer asked about
  external_thread_ref (text)   # FB thread id captured by extension
  status                       # open | snoozed | closed
  assignee_user_id (fk null)
  ai_mode                      # auto | suggest | off
  last_message_at [idx]
  created_at, updated_at

messages
  id (uuid, pk)
  conversation_id (fk) [idx]
  direction                    # inbound | outbound
  author                       # buyer | ai | human
  body (text)
  ai_run_id (fk null)
  external_message_ref (text)
  created_at [idx]

leads
  id (uuid, pk)
  dealer_id (fk) [idx]
  name, phone, email (nullable)
  source                       # marketplace | messenger | manual
  vehicle_id (fk null)
  stage                        # new | contacted | qualified | appointment | sold | lost
  score (int)                  # AI lead score 0-100
  score_factors (jsonb)
  owner_user_id (fk null)
  created_at, updated_at
  INDEX (dealer_id, stage)
  INDEX (dealer_id, score)

lead_activities               # timeline
  id (uuid, pk)
  lead_id (fk) [idx]
  type                         # message | stage_change | note | call | appointment
  payload (jsonb)
  created_by (fk null)
  created_at [idx]
```

### 4.6 Indexing & Scalability Notes
- Composite indexes are tenant-first (`dealer_id, ...`) so every scan is partition-friendly.
- `vehicles.source_hash` and `vehicle_images.image_hash` make delta detection O(lookup) instead of full diffing.
- High-write tables (`messages`, `vehicle_changes`, `ai_runs`, `lead_activities`) are append-mostly — candidates for monthly **range partitioning** by `created_at` once volume grows.
- `raw_payload` / JSONB kept out of hot read paths; structured columns carry the queryable fields.
- Read replicas for `reports`; the dashboard's heavy aggregates hit pre-computed rollup tables refreshed by the worker.

---

## 5. User Roles

Role-based access control, scoped by agency and dealer.

| Role | Scope | Capabilities |
|---|---|---|
| **Super Admin** (platform) | all agencies | platform operations, billing, feature flags |
| **Agency Owner** | one agency, all dealers | manage dealers, users, billing, all data |
| **Agency Manager** | one agency, all dealers | operate all dealers; no billing/user-admin |
| **Agency Operator** | assigned dealers | day-to-day: listings, messenger, leads |
| **Dealer Admin** | single dealer | full access to their own dealer only |
| **Dealer Viewer** | single dealer | read-only reports + inventory |

Enforcement is **two-layered**: route middleware checks role capability, and every query is filtered by the caller's `agency_id` + allowed `dealer_id` set (`user_dealer_access`). No client-supplied tenant id is ever trusted.

---

## 6. Inventory Flow

```text
1. Scheduler triggers feed import (cron per feed) → enqueues feed-import job.
2. Worker fetches XML → feed-parser normalizes each entry into a canonical Vehicle shape.
3. For each entry, compute source_hash; compare against stored vehicles by (dealer_id, vin):
     - VIN not present            → CREATE vehicle, log change(created), enqueue image copy + AI generation.
     - VIN present, hash changed  → diff fields:
         price differs            → UPDATE + change(price)
         images differ (by hash)  → UPDATE + change(image) + re-copy images, optional photo-studio re-run
         other fields differ      → UPDATE + change(field)
     - VIN present, hash same      → touch last_seen_at only.
4. VINs in DB (status=available) but absent from this run → mark SOLD/REMOVED, log change(sold).
5. Persist feed_run with counts; emit domain events; refresh affected rollups.
```

Key rules: feeds are the **source of truth**; the system never invents inventory. Sold detection is **absence-based** (present last run, gone this run) with a grace window to avoid flapping on partial feeds. Images are **copied into our object storage** so listings and the Photo Studio don't depend on the dealer's URLs staying alive.

---

## 7. Lead Flow

```text
1. Buyer messages on Marketplace/Messenger → Chrome Extension content script detects new thread/message.
2. Extension sends message + thread ref + (if detectable) vehicle ref to extension-gateway.
3. Messenger service:
     - upserts conversation (by external_thread_ref)
     - creates lead if none exists for this buyer (source=messenger)
     - stores inbound message
4. AI service generates a reply suggestion using Brand DNA + vehicle context → stored as ai_run.
5. Depending on conversation.ai_mode:
     - auto    → reply queued back to extension to send automatically
     - suggest → reply shown to human operator in dashboard inbox; human approves/edits
     - off     → human writes manually
6. Lead scoring job updates lead.score from engagement signals (intent words, response speed, vehicle value).
7. CRM pipeline: operators move leads through stages; every action logged in lead_activities.
```

Human-in-the-loop is the default for safety; full auto is opt-in per conversation.

---

## 8. Chrome Extension Architecture (design only)

Facebook offers no sanctioned Marketplace listing API for dealers, so publishing and Messenger run **client-side in the operator's authenticated browser**. The extension is the "hands"; the cloud is the "brain."

**Components:**
- **Background service worker:** holds the extension session, polls/receives commands from the cloud, coordinates content scripts.
- **Content scripts:** injected into Marketplace and Messenger pages; read DOM for new messages/threads, drive the publish UI, capture external refs after actions.
- **Popup UI:** login, connection status, current dealer, queue health, manual controls.

**How it talks to the web app:**
- Communicates only with the dedicated **`extension-gateway`** API module over HTTPS.
- **Pull model for work:** the extension claims `publishing_jobs` (claim → in_progress → done/failed), reporting results with idempotency keys. This avoids the cloud needing to reach into the browser.
- **Push of observations:** inbound Messenger messages and publish confirmations are POSTed up to the gateway.

**Authentication:**
- Operator logs into the extension once; it receives a **short-lived, extension-scoped token** (separate token class from the web session, narrow permissions, dealer-scoped).
- Token refresh via a long-lived refresh token stored in extension secure storage; revocable per device from Settings.
- The extension never receives the user's Facebook credentials — it operates inside the operator's already-authenticated Facebook session in their own browser.

**Marketplace communication:** content script automates the listing form (fields from our `listings` record), submits, then reads back the created listing reference and reports it to the gateway → stored as `listings.marketplace_ref`.

**Messenger communication:** content script observes the Messenger DOM for new inbound messages, forwards them up; receives approved/auto replies from the gateway and types/sends them in-thread, then confirms with `external_message_ref`.

**Safety:** human-paced sending with jitter, per-dealer rate caps, and a kill switch — the extension is automating a human surface and must behave like one. Compliance with platform terms is a product/legal decision flagged in §16.

---

## 9. AI Architecture

A dedicated `ai` package wraps all model calls behind a stable internal interface so providers/models are swappable and every call is logged (`ai_runs`) for cost, audit, and reproducibility.

**Layers:**
```text
feature handlers   # title, description, pricing, down-payment, brand-dna, photo, messenger, lead-score
      │ uses
prompt templates   # versioned, parameterized by Brand DNA + vehicle/lead context
      │ uses
provider adapter   # text LLM provider(s) + image model provider(s)
      │ wrapped by
guardrails         # input redaction, output validation (zod), profanity/PII checks, cost ceilings
```

**Capabilities & how each is grounded:**
| Feature | Inputs | Notes |
|---|---|---|
| Title generation | vehicle fields + Brand DNA | constrained length, no fabricated specs |
| Description | vehicle fields + Brand DNA disclaimers | template-anchored, validated |
| Marketplace pricing | price, mileage, year, comparable signals | suggestion only; human can override |
| Down payment | price + dealer finance rules | rule-assisted, not pure LLM |
| Brand DNA generation | dealer site/messaging samples | produces reusable voice config |
| Studio backgrounds | vehicle image | image model; output stored as image variant |
| Messenger replies | conversation + vehicle + Brand DNA | suggest/auto modes (§7) |
| Lead scoring | conversation signals + vehicle value | numeric score + factors, explainable |

**Principles:** AI output is **always editable**, never silently published. Pricing/finance suggestions are advisory. All generations are versioned (`listing_versions`, `ai_runs`) so a bad model change can be diagnosed and rolled back. Prompt templates are versioned in code, not free-floating.

---

## 10. API Structure

Contract-first: OpenAPI spec in `packages/api-spec` generates the typed client. REST, JSON, tenant-scoped, versioned under `/api/v1`.

```text
# Auth
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

# Dealers
GET    /dealers
POST   /dealers
GET    /dealers/:id
PATCH  /dealers/:id

# Feeds & Inventory
GET    /dealers/:id/feeds
POST   /dealers/:id/feeds
POST   /feeds/:id/run                 # manual import trigger
GET    /vehicles                      # filter by dealer/status/make...
GET    /vehicles/:id
GET    /vehicles/:id/changes
GET    /vehicles/:id/images

# Listings
GET    /listings
POST   /listings/:id/generate         # (re)generate via AI
PATCH  /listings/:id                  # edit
POST   /listings/:id/queue            # enqueue publish

# Brand DNA
GET    /dealers/:id/brand-dna
PUT    /dealers/:id/brand-dna
POST   /dealers/:id/brand-dna/generate

# Photo Studio
POST   /vehicles/:id/photos/studio    # generate edited variant

# Messenger
GET    /conversations
GET    /conversations/:id/messages
POST   /conversations/:id/reply       # human or approve-AI
POST   /conversations/:id/ai-mode

# Leads / CRM
GET    /leads
GET    /leads/:id
PATCH  /leads/:id                      # stage, owner
POST   /leads/:id/activities

# Reports
GET    /reports/overview
GET    /reports/leads
GET    /reports/inventory

# Extension Gateway (separate auth class)
POST   /ext/auth
GET    /ext/jobs/claim                 # claim publishing work
POST   /ext/jobs/:id/result
POST   /ext/messages                   # inbound observed messages
POST   /ext/listings/:id/confirm       # marketplace_ref capture
```

Conventions: cursor pagination on lists, idempotency keys on all mutating extension endpoints, consistent error envelope, ETags on cacheable reads.

---

## 11. Background Jobs

Redis-backed queue (BullMQ-style), processed by the `worker` app. Job classes:

| Job | Trigger | Work |
|---|---|---|
| `feed.import` | cron / manual | fetch + parse + delta detect (§6) |
| `image.copy` | vehicle create/image change | copy feed images to object storage, hash |
| `ai.generate.listing` | vehicle create / regen request | titles, descriptions, pricing |
| `ai.brand_dna` | request | generate Brand DNA |
| `ai.photo_studio` | request | generate edited image variants |
| `lead.score` | new message / periodic | recompute lead scores |
| `messenger.reply` | inbound message (auto mode) | generate + queue reply |
| `reports.rollup` | schedule | refresh aggregate tables |
| `notifications` | domain events | email/in-app alerts |
| `cleanup` | schedule | retention, orphaned images, stale jobs |

Cross-cutting: retries with exponential backoff, dead-letter queue for poison jobs, idempotency on side-effecting jobs, per-dealer concurrency limits so one big feed can't starve others.

---

## 12. Security

- **Tenant isolation:** every query scoped by `agency_id` + permitted `dealer_id`; no client-supplied tenant ids trusted. Considered defense-in-depth with row-level checks in the repository layer.
- **AuthZ:** capability checks in middleware + data-scope filter (§5).
- **Extension token class:** narrow, short-lived, revocable, dealer-scoped, separate from web sessions.
- **Secrets:** managed by the platform secret store; never in code or client. Feed credentials encrypted at rest.
- **Transport:** HTTPS everywhere; HSTS.
- **Input/Output:** zod validation at every boundary; output encoding to prevent stored XSS from feed/AI content.
- **PII:** lead contact data encrypted at rest; access audited; retention policy + deletion endpoints (GDPR/CCPA posture).
- **AI guardrails:** redact PII from prompts where possible; validate/structure AI output before persistence; cost ceilings to prevent runaway spend.
- **Auditability:** `ai_runs`, `vehicle_changes`, `lead_activities`, `feed_runs`, and publishing job history give a full trail.
- **Rate limiting:** per-IP and per-token, stricter on extension-gateway and auth.

---

## 13. Authentication

- **Web users:** email/password or SSO via a managed auth provider; session via short-lived access token + refresh token (httpOnly cookie for the SPA). MFA available for agency-admin roles.
- **Extension:** dedicated OAuth-style device flow issuing the extension-scoped token class (§8). Per-device revocation.
- **Service-to-service** (api ↔ worker): internal signed tokens / network isolation, not public.
- **Facebook:** the platform never stores Facebook credentials. The extension rides the operator's existing authenticated browser session — this is a core architectural and compliance boundary.

Recommendation: use a managed auth provider rather than hand-rolling password storage, to keep the security surface small.

---

## 14. Scalability

- **Stateless API** behind a load balancer → scale horizontally.
- **Separate worker tier** → scale ingestion/AI independently of request traffic; the heaviest, spikiest work never touches the API's latency budget.
- **Queue-based decoupling** absorbs feed-import and AI bursts.
- **Postgres path:** tenant-first composite indexes → read replicas for reporting → range partitioning of append-heavy tables → table/tenant sharding only if a single agency outgrows one node. Don't shard prematurely.
- **Caching:** Redis for hot reads (dealer scope, rollups); CDN for stored vehicle images.
- **Per-dealer fairness:** concurrency caps and rate limits so a large dealer can't degrade others (noisy-neighbor protection).
- **AI cost as a scaling axis:** batch where possible, cache deterministic generations, enforce ceilings; `ai_runs` gives the data to optimize spend.
- **Module extraction path:** if AI or publishing becomes a bottleneck, the modular monolith's seams allow lifting that module into its own service without a rewrite.

---

## 15. Future Modules

- **Multi-channel publishing:** beyond Marketplace — Craigslist, OfferUp, dealer website syndication.
- **Inventory analytics & pricing intelligence:** market comps, days-on-lot, price-drop recommendations.
- **Automated appointment booking** from Messenger conversations.
- **Voice/SMS lead channel** unified into the same CRM.
- **Dealer self-serve onboarding** + billing/subscription tiers.
- **A/B testing of listings** (title/photo/price variants) with performance feedback into the AI.
- **Mobile app** for operators to handle leads on the go.
- **Reputation/review management** per dealer.
- **White-label** for the agency's own brand.

---

## 16. Recommendations Before Development Begins

1. **Validate the Facebook automation boundary first.** Marketplace/Messenger automation via extension is the riskiest dependency (platform terms, DOM fragility, rate limits). Prototype and pressure-test the extension's publish + message-capture loop before committing to the full build. Get explicit legal sign-off on the automation approach.
2. **Lock the canonical Vehicle schema and feed-parser early.** Real dealer XML feeds are messy and inconsistent. Build the normalization layer against several real feeds (not just Alpha Motorsport) before designing downstream features, or you'll refactor everything later.
3. **Treat AI output as advisory by default.** Auto-publishing AI titles/prices and auto-sending AI replies is a trust and liability risk. Ship with human-in-the-loop, earn auto mode per dealer over time.
4. **Make Brand DNA the spine, not a feature.** It should feed every generation (titles, descriptions, messenger). Designing it as a shared context object now avoids prompt sprawl later.
5. **Instrument AI cost from day one.** `ai_runs` with token/cost tracking is non-negotiable — AI spend is the variable that can quietly kill SaaS margins.
6. **Build observability for ingestion.** `feed_runs` + per-dealer dashboards so the agency can see "did Alpha's feed import correctly today?" without engineering involvement.
7. **Start as a modular monolith.** Resist microservices at Phase 1; the module boundaries here give you the option to extract later without paying the operational tax now.
8. **Define retention & compliance early.** Lead PII + conversation logs carry GDPR/CCPA obligations; bake deletion and access controls into the schema rather than retrofitting.
9. **Idempotency everywhere the extension touches.** Browser automation will retry and double-fire; without idempotency keys you'll get duplicate listings and double-sent messages.
10. **Phase the roadmap:** (a) Inventory ingestion + delta detection, (b) AI listing generation + dashboard, (c) Extension publishing, (d) Messenger AI + CRM, (e) Reports + scaling. Each phase is independently demoable to Alpha Motorsport.

---

*End of Phase 1 architecture. No code has been written — this document is the deliverable. On approval, I recommend starting with Recommendation #10's Phase (a): inventory ingestion and delta detection, since it is the foundation everything else consumes.*
