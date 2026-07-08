---
name: Chrome extension to backend communication
description: How the Marketplace AI MV3 extension talks to the Replit backend without being blocked.
---

# Chrome extension ↔ Replit backend

The Marketplace AI Chrome extension (`chrome-extension/`) runs content scripts on
`facebook.com` and `messenger.com`. All network calls to the Replit backend go
through the **background service worker** (`background.js`), never directly from the
content script.

**Why:** Content scripts execute in the page's origin, so a `fetch` from a content
script is subject to Facebook's strict `connect-src` Content Security Policy, which
blocks requests to external domains (the Replit dev/app URL). The background service
worker is not subject to the page CSP and uses `host_permissions` instead. So the
content script `chrome.runtime.sendMessage(...)` → background does the `fetch` →
returns the result.

**How to apply:**
- Keep all `fetch` to the backend in `background.js`; have content scripts message it.
- `host_permissions` in the manifest must cover the backend domains
  (`https://*.replit.dev/*`, `https://*.replit.app/*`), separate from the
  `content_scripts.matches` (the FB/Messenger pages).
- The backend URL is user-configurable via the popup (Backend settings + a
  Debug Mode "Switch Backend URL" selector with Replit/Render/Local/Custom
  presets saved in `chrome.storage.local.backendPresets`), stored in
  `chrome.storage.local` under `backendUrl` (falls back to a hardcoded default).
  An `environment` is derived from the URL (onrender.com/replit.app,dev/localhost)
  so the popup can show which backend is active without guesswork.
- Adding a new backend domain (e.g. Render) requires updating BOTH
  `host_permissions` and `externally_connectable.matches` in `manifest.json` —
  a URL-only popup change is not enough, Chrome will silently block the fetch
  without the host permission. Reload the unpacked extension after a manifest change.
- `content_scripts.matches` must include naked domains too (`facebook.com/*`,
  `messenger.com/*`), not just `www.` / `web.` subdomains.
- Safety guardrail for this product: the extension fills listing fields and inserts
  Messenger replies but must NEVER click Publish or Send.
