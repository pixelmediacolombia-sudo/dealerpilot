# DealerPilot AI — Chrome Extension (Publisher) v1.2

This extension connects the DealerPilot AI dashboard's **Publishing Queue** to
Facebook Marketplace. It claims queued publishing jobs, opens the Marketplace
create-listing page, fills the listing form from real inventory data, and lets the
operator review and report the outcome back to the backend.

**Safety first:** the extension never stores a Facebook password, requires an
explicit operator authorization before publishing a paid Marketplace promotion,
and stops if Facebook shows a login / checkpoint / captcha / security screen.

## What's in v1.2

- **Popup redesign** — Facebook login status + Marketplace access shown as color-coded
  pills directly in the main panel (no need to open Debug Mode). "Open Facebook
  Login →" button appears automatically when not logged in.
- **Better sync** — FB login state + Marketplace status visible without Debug Mode;
  Debug Mode now shows FB Logged In + Marketplace Access rows.
- **Color mapping** — Improved color field matching handles Facebook's label variants
  (e.g. "Silver" → "Gray", "Maroon" → "Brown").
- **Body style + color keywords** — Extended combobox keyword list for more robust
  matching (`exterior color`, `body type`).
- **Messenger AI separated** — conversation capture, AI suggestion, composer insert,
  auto-reply controls, and AI diagnostics now live in `chrome-extension-messenger/`.
- **Permissions** — Added `tabs` permission (required for `chrome.tabs.create` in
  background service worker).
- **Debug panel** — Removed redundant "Dev: Claim Next Queued Job" dev button; added
  FB Logged In + Marketplace Access rows.

## The extension provides

- A floating **DealerPilot AI** panel on Facebook Marketplace publishing pages.
- A popup with **Extension Status** (Backend, Assigned job, Current job, Last sync)
  plus **Facebook** and **Marketplace** status pills, and a **Start Publishing Job** button.
- On the Marketplace **create listing** page: automatic form fill from the claimed
  job plus an **operator review** panel (filled / missing / warnings, **Mark
  Published**, **Mark Failed**).
- On Facebook's **Promote Marketplace listing** page: shows an explicit
  **Authorize and publish** action; after authorization it clicks the promotion
  `Publish` action and then `Go to your listings` from the confirmation dialog.
- Messenger AI is handled by the separate `DealerPilot Messenger AI` extension.

## Install (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer Mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this `chrome-extension/` folder.
5. The "DealerPilot AI Publisher" extension appears in your list.

> After any code update: go to `chrome://extensions` and click the **refresh ↺** icon
> on the DealerPilot card. Then **fully refresh any open Facebook Marketplace tabs**.

## Configure the Backend URL

1. Click the extension icon in the Chrome toolbar to open the popup.
2. Expand **⚙ Backend settings**, paste your backend URL (e.g.
   `https://your-render-service.onrender.com`) — no trailing slash needed.
3. Click **Save & Test Connection**. The status should show **Backend: Connected**.

The URL is stored in `chrome.storage.local`. All API calls go through the
background service worker (so Facebook's page CSP does not block them). The
extension also generates a random `extensionId` (stored locally) used to claim
jobs — it contains no Facebook credentials.

## Publishing flow

1. In the dashboard, queue a generated listing — it appears on **/publishing** as **Queued**.
2. Open the extension popup. **Assigned job** or **Start Publishing Job** becomes enabled.
3. Click **Start Publishing Job**. The extension claims the job and opens
   `https://www.facebook.com/marketplace/create/vehicle`.
4. On the create page, the panel auto-fills the form from the job payload (title,
   price, description, mileage, year, make, model, VIN, location, condition,
   transmission, fuel type, color, body style).
5. Review the **Filled successfully / Fields missing / Warnings** chips.
6. Click **Mark Published** → paste the Marketplace listing URL (optional) → job → **Published**.
7. Or click **Mark Failed** → enter a reason → job → **Failed/Retry**.

## Messenger AI flow

1. Load `chrome-extension-messenger/` as a separate unpacked extension.
2. Open the `DealerPilot Messenger AI` popup.
3. Keep **Dry run** enabled until a real read-only QA pass is authorized.
4. Use the popup **AI Debugger** to see capture stage, seller/buyer gates,
   backend intake status, specific error reason, and raw JSON error data.

## Test Checklist

### Connection
- [ ] Open `https://www.facebook.com`. Floating panel appears with green dot and "Connected to DealerPilot".
- [ ] Open popup. **Backend: Connected**. **FB: Logged In** + **Marketplace: Ready** pills visible.
- [ ] When not logged into Facebook: **FB: Not Logged In** pill shows in red + "Open Facebook Login →" button appears.

### Queue + claim
- [ ] In the dashboard, queue a listing. It shows **Queued** on **/publishing**.
- [ ] Click **Start Publishing Job**. Job is claimed and Marketplace create-listing tab opens.
- [ ] Claiming the same job from a second extension returns HTTP 409; popup refreshes for another job.

### Marketplace fill + review
- [ ] On the create page the panel auto-fills the form. Status reads "Fields filled… Publish was NOT clicked."
- [ ] Review panel lists filled fields, missing fields, and warnings.
- [ ] On the promotion page, no Facebook action is clicked until **Authorize and publish** is pressed in the DealerPilot AI panel.
- [ ] After authorization, the exact promotion **Publish** action is clicked, followed by **Go to your listings** in Facebook's confirmation dialog.

### Complete / Fail
- [ ] Click **Mark Published**, paste a listing URL. Status reads "Job marked Published."
- [ ] Or click **Mark Failed**, enter a reason. Job → Failed/Retry with reason stored.

### Safety
- [ ] If Facebook shows a login/checkpoint/captcha, the panel stops with a "Stopped for safety" banner.

### Messenger
- [ ] Publisher popup does not show Messenger or Sales AI diagnostics.
- [ ] `DealerPilot Messenger AI` popup shows Dry run and the AI Debugger.
- [ ] Specific error and raw JSON error data are visible when intake or DOM capture fails.

## Files

- `manifest.json` — MV3 manifest v1.2 (permissions: storage, scripting, activeTab, alarms, tabs).
- `background.js` — service worker; all backend `fetch` calls + job lifecycle handlers.
- `content/content.js` — injects the panel; Marketplace fill state machine.
- `content/panel.css` — panel styling.
- `popup/popup.html` — popup UI with status pills, FB login button, debug section.
- `popup/popup.js` — popup logic with `updateFbPills()` for live status display.
