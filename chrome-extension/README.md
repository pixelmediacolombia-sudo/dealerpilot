# Marketplace AI — Chrome Extension (Sprint 0 Spike)

This is a **proof of concept**, not the finished product. It validates that a Replit web app can communicate with a Chrome Extension running on Facebook Marketplace and Messenger.

The extension:

- Shows a floating **"Marketplace AI Connected"** panel on Facebook and Messenger pages.
- On the Marketplace **create listing** page, adds a **"Fill Test Listing"** button that pulls the test vehicle from the backend and fills the form fields. **It never clicks Publish.**
- On **Messenger**, adds a **"Read Chat & Suggest Reply"** button that reads the visible conversation, asks the backend for a suggested reply, and saves a test lead to the CRM. An **"Insert Reply"** button drops the reply into the message box. **It never clicks Send.**

## Install (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer Mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this `chrome-extension/` folder.
5. The "Marketplace AI (Spike)" extension appears in your list.

## Configure the Backend URL

The extension ships with a default backend URL, but you should confirm it points at your running Replit web app.

1. Click the extension icon in the Chrome toolbar to open the popup.
2. Paste your backend URL (e.g. `https://your-app.replit.dev`) — no trailing slash needed.
3. Click **Save & Test Connection**. You should see "Connected. Backend is reachable."

The URL is stored in `chrome.storage.local`. All API calls go through the background service worker (so Facebook's page CSP does not block them).

## Test Checklist

### Connection
- [ ] Open `https://www.facebook.com`. The floating panel appears bottom-right.
- [ ] The status dot is green and reads "Connected to backend". (If red, set the URL in the popup.)

### Web dashboard
- [ ] Open the Replit web app dashboard.
- [ ] The Test Vehicle card shows the 2021 Toyota Tacoma (price $28,995, down payment $2,500, mileage 45,000).
- [ ] Clicking **"Send Test Listing to Extension"** shows the JSON payload the extension will receive.

### Marketplace fill
- [ ] Go to `https://www.facebook.com/marketplace/create/vehicle` (or any `/marketplace/create` page).
- [ ] The panel shows a **"Fill Test Listing"** button.
- [ ] Click it. The status reads "Listing data received. Publish was NOT clicked."
- [ ] The output panel lists which fields were filled and shows the listing JSON.
- [ ] Visible form fields (title / price / mileage / description) that the page exposes are populated.
- [ ] **Publish is never clicked.**

### Messenger reply
- [ ] Open `https://www.messenger.com` (or Facebook messages) and open any conversation.
- [ ] The panel shows a **"Read Chat & Suggest Reply"** button.
- [ ] Click it. A suggested reply appears and the status reads "Suggested reply ready. Lead saved to CRM."
- [ ] Click **"Insert Reply"**. The reply text appears in the message box.
- [ ] **Send is never clicked.**

### CRM
- [ ] Back on the dashboard, the new lead appears in the Test Leads list (status "Test Lead").
- [ ] The lead shows the message text and the suggested reply.

## Notes & Limitations (spike scope)

- Facebook's DOM is obfuscated and changes frequently. Field/box detection is **best-effort** by label, placeholder, and aria-label keywords. If a field isn't found, the panel reports it under "Not found on page" — the data still arrives from the backend, proving the round trip works.
- This spike proves the communication channel and DOM interaction. Hardening the selectors for production is a follow-up.
- Safety guardrails are intentional: the extension fills and suggests but never submits (no Publish, no Send).

## Files

- `manifest.json` — MV3 manifest (matches `facebook.com` and `messenger.com`).
- `background.js` — service worker; makes all backend `fetch` calls.
- `content/content.js` — injects the panel and handles Marketplace fill + Messenger reply.
- `content/panel.css` — panel styling.
- `popup/` — backend URL configuration UI.
