---
name: Sprint 4.6 UX patterns
description: AI voice copy rules, global header hook signatures, sidebar structure, shared component title prop type fix from the Mission Control UX sprint.
---

## GlobalHeader hook signatures (correct forms)

```tsx
useGetConnectionStatus({ query: { queryKey: getGetConnectionStatusQueryKey(), refetchInterval: 15000 } })
useListFeedRuns(dealerId, { query: { queryKey: getListFeedRunsQueryKey(dealerId), enabled: !!dealerId } })
useListCreativeJobs(undefined, { query: { queryKey: getListCreativeJobsQueryKey(), refetchInterval: 10000 } })
```

`useListFeedRuns` takes `dealerId: number` as its **first positional arg**, not inside the options object.

## Shared component title props must be ReactNode

`PageHeader.title` and `SectionCard.title` are typed as `ReactNode` (not `string`) — subagents pass JSX like `<>Brand <span className="text-primary">DNA</span></>`. TypeScript won't catch a JSX-in-string-prop error if the component prop is loosely typed; tighten the interface.

## Sidebar: 6 items, ACTIVE_PATHS map

Sidebar uses a `ACTIVE_PATHS` record to map each nav item path → list of route prefixes that should light it up (e.g. `/listings` lights up for `/listings`, `/inventory`, `/publishing`). Without this, Vehicle Intelligence appears unselected even though it's part of the Marketplace AI workflow.

## PageHeader description/subtitle must be `<div>` not `<p>`

PageHeader renders `sub` inside a `<div>` (changed from `<p>`). If `description` contains JSX with block elements (Badges, divs), a `<p>` wrapper causes a React hydration warning (`<div>` cannot be a descendant of `<p>`). Always render the description wrapper as `<div>`.

## useListFeedRuns requires queryKey in options

Pattern: `useListFeedRuns(dealerId, { query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId) } })`. Missing `queryKey` is a TS error that shows up immediately in typecheck. Import `getListFeedRunsQueryKey` alongside `useListFeedRuns`.

## AI voice copy rule

Every KPI/metric label must read as an AI statement, not a raw number:
- ❌ "15 Vehicles"
- ✅ "DealerPilot found 15 vehicles ready to publish."

Every card ends with exactly ONE primary CTA button. Never two equal-weight actions on the same card.

**Why:** The Sprint 4.6 spec mandates this as the core UX principle — the dashboard should feel like an AI briefing the operator, not a spreadsheet.
