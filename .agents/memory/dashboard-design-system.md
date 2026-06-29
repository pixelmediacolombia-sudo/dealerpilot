---
name: Dashboard design system & shared components
description: How the DealerPilot dashboard premium dark redesign is structured and the rule for parallelizing DESIGN subagents against shared components.
---

# DealerPilot dashboard (artifacts/dashboard) design system

Premium dark "AI copilot / mission control" aesthetic (Apple/Linear/Vercel/Stripe vibe).
- Theme tokens + utilities live in `src/index.css`: electric-blue `primary`, purple `accent`, green `success`, orange `warning`; `destructive` (red) is reserved for ERRORS ONLY. Utility classes: `.hover-lift`, `.glass-panel`, `.premium-gradient-btn`, `.pulse-ring`.
- Shared component vocabulary in `src/components/shared/` (barrel `index.ts`): PageHeader, KpiCard, AnimatedCounter, EmptyState, StatusPulse, SectionCard, renderIcon. Reuse these for every page so the look stays consistent. EmptyState replaces all "coming soon"/placeholder text.

## Rule: shared components must be flexible supersets when parallel subagents consume them
**Why:** Parallel DESIGN subagents only see the barrel `index.ts`, NOT each component's prop signature, so they guess prop names/shapes and produce dozens of TS2322 errors (e.g. `description` vs `subtitle`, `label` vs `title`, `icon` passed as a JSX element `<Car/>` in some files and as a Lucide component in others, `status` strings on StatusPulse, `isLoading`, string-or-number values).
**How to apply:** Make shared components tolerant: accept aliases, accept `icon` as `LucideIcon | ReactNode` and render via the `renderIcon(icon, className)` helper (it returns valid elements as-is, else renders `<Icon/>`), make trend/delta labels optional, accept loose `status`/`color` strings mapped to a class lookup. Cheaper than editing ~40 call sites. Alternatively, give each subagent the actual component source in relevantFiles.

## Gotcha: console errors after HMR are often stale
Vite browser console accumulates; an "Element type is invalid... <Car/> ... in KpiCard" can be from BEFORE a fix. Compare error timestamps against the latest HMR hot-update timestamp before chasing it — re-screenshot to confirm.

## Route note: /publishing is a deep-link alias
Publishing was unified into the Marketplace AI workspace (`/listings`). `/publishing` redirects to `/listings?tab=publishing`; ListingsWorkspace seeds its initial tab from the `tab` query param. Keep this so bookmarks land on the Queue, not Workspaces.
