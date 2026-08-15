# DealerPilot UI design system

This document is the source of truth for the visual pass based on Gymove's
admin grammar. It describes presentation rules only. Routes, data hooks, API
contracts, permissions, Messenger, Marketplace publishing and Dealer DNA are
outside the design system.

## Canonical direction

- Canonical theme: light. The dark token mapping remains available but is
  frozen until a separate QA pass.
- UI font: self-hosted Poppins, weights 400/500/600/700.
- Data font: Cascadia Code fallback chain for VINs, IDs and operational
  numbers; use `tabular-nums` for aligned columns.
- Primary brand: Gymove violet, used for selection, primary CTA and the active
  navigation state.
- Supporting colors are semantic: green for published/sold/connected, amber
  for pending/attention, red/pink for conflicts or unfinished work, blue for
  Marketplace/info, orange for hot leads or daily priority.
- No gradients, decorative glows or color assigned only by module.

## Physical hierarchy

Surfaces must read as nested boxes:

1. Warm gray canvas.
2. White workspace container.
3. Section panel with its own header and padding.
4. Repeated row-boxes with their own background, radius and padding.

Rows should not collapse into divider-separated text. A repeated row uses the
same anatomy everywhere: anchor chip on the left, bold title plus muted
metadata, semantic status on the right, and a kebab menu when actions exist.

The selected row uses full-surface inversion in the primary violet, white text
and a contrasting CTA. A thin border alone is not an active state.

## Geometry and motion

- Spacing scale: 4, 8, 12, 16, 24, 32, 48px.
- Inputs: 6px radius. Cards and panels: 10px. Modals: 14px. Pills are only
  for true statuses or compact filters.
- Motion budget: color, opacity and short state transitions only. Respect
  `prefers-reduced-motion`; no bounce, glow or idle float.
- Tables keep a minimum 44px row height and visible keyboard focus.

## Component ownership

- Tokens and semantic color roles live in `src/index.css`.
- `src/shared/ui` owns reusable presentation primitives.
- `KpiCard`, `SectionCard` and `PageHeader` are the shared presentation layer.
- Features consume shared components and should not introduce new ad-hoc
  values or a second component library.
