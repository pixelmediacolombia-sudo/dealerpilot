# DealerPilot Architecture

## Target Model

DealerPilot now follows a pragmatic Onion + Feature-First model.

The rule is simple:

1. Domain owns business decisions.
2. Application owns use cases and orchestration.
3. Infrastructure owns databases, network, browser APIs, and vendor APIs.
4. Presentation owns HTTP routes, React screens, popup UI, and content-script panels.

Feature folders are the default home for product logic. Technical folders remain only for shared runtime concerns such as UI primitives, layout, API clients, logger helpers, and existing operational diagnostics.

## Surfaces

### Backend

Backend lives under `artifacts/api-server/src`.

Important current domains:

- `listings`: deterministic scoring, category rules, down-payment suggestions, listing generation.
- `publishing`: queue lifecycle, guardrails, batch progress, extension handoff, completion semantics.
- `inventory`: feed import, vehicle state, vehicle images, dashboard stats.
- `sales-ai`: conversations, lead scoring, phone-first replies, BDC handoff.
- `connection`: extension and production readiness telemetry.

New backend work should prefer this shape:

```text
src/features/<feature>/
  domain/
  application/
  infrastructure/
  presentation/http/
```

Legacy route files still exist where a full extraction would risk production behavior. When touching them, first add contract tests around the current behavior, then extract.

### Dashboard

Dashboard lives under `artifacts/dashboard/src`.

Feature domains live in:

```text
src/features/
  connection/
  inventory/
  listings/
  marketplace-intelligence/
  photo-studio/
  publishing/
  sales-ai/
```

Shared UI primitives live in `src/shared/ui`; app shell layout lives in `src/shared/layout`; route composition lives in `src/app/router.tsx`; provider composition lives in `src/app/providers.tsx`.

Rules:

- Do not import core feature pages from `src/pages`.
- Do not add new generic UI into feature folders.
- Do not add business fetching directly inside large route pages when a feature hook/API wrapper can own it.

### Chrome Extension

Extension lives under `chrome-extension`.

Manifest V3 compatibility is intentionally kept as plain JavaScript classic scripts.

Current layout:

```text
chrome-extension/
  background.js
  content/content.js
  popup/popup.js
  src/shared/
    apiClient.js
    logger.js
  src/background/
    queueClient.js
    photoProxy.js
    stateStore.js
  src/content/facebook/
    selectors.js
    formFiller.js
    photoUploader.js
    publisherFlow.js
    validation.js
  popup/modules/
    settings.js
    diagnostics.js
    uiActions.js
```

`background.js`, `content/content.js`, and `popup/popup.js` are entrypoints. The production logic lives under `src/` and `popup/modules/`.

## Sacred Publishing Contract

The Alpha production flow uses a personal Facebook profile, the Chrome extension, Render backend, and Facebook Marketplace. Do not replace it with Meta Page webhooks unless the product explicitly changes direction.

These endpoints are sacred:

- `POST /api/publishing/jobs/:id/claim`
- `GET /api/publishing/jobs/:id/payload`
- `POST /api/publishing/jobs/:id/complete`
- `POST /api/publishing/jobs/:id/fail`
- `POST /api/publishing/jobs/:id/event`
- `GET /api/publishing/jobs/assigned`
- `POST /api/extension/heartbeat`
- `POST /api/extension/session-report`

Extension calls to the critical endpoints must go through `chrome-extension/src/shared/apiClient.js`.

Completion rules:

- The extension must send `extensionId`.
- `listingUrl` is required to mark a job live.
- Completion is idempotent for already published jobs with a valid listing URL.
- Ownership is enforced when a job has `claimedByExtension`.
- Missing listing URLs go to Needs Review, not Published.

Queue rules:

- Claim must be atomic.
- Scheduled jobs are claimable only when due.
- Terminal jobs must not re-enter active publishing.
- Controlled Mode must pass guardrails before dispatch.

## QA Gates

The final technical gate is:

```powershell
pnpm run typecheck
$env:BASE_PATH='/'; $env:PORT='3000'; $env:NODE_ENV='production'; pnpm --filter @workspace/dashboard run build
pnpm --filter @workspace/api-server run build
npm.cmd run lint:extension
npm.cmd run test:extension:marketplace
npm.cmd run test:publishing-flow
npm.cmd run test:qa:final
```

Current final suite coverage:

- Listings: category, down-payment, priority, listing score components.
- Publishing: controlled-mode switches, guardrails, scheduled queue, claim, complete, batch progress.
- Inventory: stats, known lots, vehicle list, status transition, change history.
- Sales AI: conversation intake, external thread continuity, BDC assignment, auto-reply route, test message route.
- Extension: Manifest V3 script order, centralized API client, heartbeat/session report, photo proxy, Marketplace form contract.
- E2E contract: Dashboard routes to backend publishing endpoints to extension payload/complete/poll loop.

## Adding A Feature

1. Add or identify the feature folder.
2. Put pure decisions in `domain/`.
3. Put use-case orchestration in `application/`.
4. Put DB/API/browser adapters in `infrastructure/`.
5. Put routes or UI screens in `presentation/`, `pages/`, or `components/`.
6. Add tests before wiring the feature into routes or screens.
7. Extend `tests/final-architecture-contract.test.mjs` when a new cross-surface contract matters.
8. Run the QA gate above before declaring done.

Never change Facebook selectors, auto-publish timing, or publishing endpoint names without adding a failing test first and explicitly validating the Alpha Flow.
