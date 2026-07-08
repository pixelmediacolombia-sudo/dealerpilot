# DealerPilot AI Extension — Changelog

## v1.3.9

**New**
- Render backend support — extension can connect to a Render-hosted backend
- Backend switcher — switch between Replit / Render / Local / Custom without editing code or reloading the extension
- Environment detection — popup automatically labels the active backend as Render, Replit, Local, or Custom
- Heartbeat diagnostics — Debug Mode shows the exact heartbeat URL and the last response (success/error)
- onrender.com permissions — `host_permissions` / `externally_connectable` updated so Render requests aren't blocked by Chrome

**Improved**
- Debug panel — added backend-level Extension ID, Environment badge, and heartbeat detail rows
- Connection diagnostics — clearer at-a-glance status of which backend and environment is active before a live publish test

**Fixed**
- Vehicle Type selector — 7-strategy fallback (keyword scan, synthetic events, keyboard, label-text walk, positional, ARIA walk, type-to-filter) with a manual-pause fallback if Facebook's combobox rendering changes
- Publishing flow — restored robust Vehicle Type → Year → Make → Model → Title sequencing with explicit waits, fixing a regression from an earlier DOM-wait change
- Backend configuration — job completion sync hardened against stuck/duplicate states

---

## v1.3.8 and earlier

See git history for prior changes.
