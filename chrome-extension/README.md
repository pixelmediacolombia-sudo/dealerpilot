# DealerPilot AI — Chrome Extension (Publisher)

This extension connects the DealerPilot AI dashboard's **Publishing Queue** to
Facebook Marketplace. It claims queued publishing jobs, opens the Marketplace
create-listing page, fills the listing form from real inventory data, and lets the
operator review and report the outcome back to the backend.

**Safety first:** the extension **never** auto-clicks Publish, never stores a
Facebook password, and stops if Facebook shows a login / checkpoint / captcha /
security screen.

The extension provides:

- A floating **"DealerPilot AI Connected"** panel on Facebook and Messenger pages.
- A popup with an **Extension Status** panel (Online, Backend connected, Jobs
  available, Current job, Last sync) and a **Start Publishing Job** button.
- On the Marketplace **create listing** page: automatic form fill from the claimed
  job plus an **operator review** panel (filled / missing / warnings, **Mark
  Published**, **Mark Failed**). **It never clicks Publish.**
- On **Messenger** (Sprint 0 helper, unchanged): a **"Read Chat & Suggest Reply"**
  button. **It never clicks Send.**

## Install (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer Mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this `chrome-extension/` folder.
5. The "DealerPilot AI Publisher" extension appears in your list.

## Configure the Backend URL

1. Click the extension icon in the Chrome toolbar to open the popup.
2. Expand **Backend settings**, paste your backend URL (e.g.
   `https://your-app.replit.dev`) — no trailing slash needed.
3. Click **Save & Test Connection**. The status panel should show
   **Backend connected: Connected**.

The URL is stored in `chrome.storage.local`. All API calls go through the
background service worker (so Facebook's page CSP does not block them). The
extension also generates a random `extensionId` (stored locally) used to claim
jobs — it contains no Facebook credentials.

## Publishing flow

1. In the dashboard, queue a generated listing — it appears on **/publishing** as
   **Queued**.
2. Open the extension popup. **Jobs available** shows `1+ ready` and **Start
   Publishing Job** becomes enabled.
3. Click **Start Publishing Job**. The extension claims the job (`POST
   /api/publishing/jobs/:id/claim`) and opens
   `https://www.facebook.com/marketplace/create/vehicle`. If the claim loses a
   race (HTTP 409) it surfaces the conflict and refreshes for another job.
4. On the create page, the panel auto-fills the form from the job payload (title,
   price, description, mileage, year, make, model, VIN, location). A **Fill
   Marketplace Fields** button re-runs the fill on demand.
5. Review the **Filled successfully / Fields missing / Warnings** chips.
6. Click **Mark Published** → paste the Marketplace listing URL (optional) →
   `POST /api/publishing/jobs/:id/complete`. The job → **Published** and the
   vehicle's Marketplace listing is recorded as **Published**.
7. Or click **Mark Failed** → enter a reason → `POST /api/publishing/jobs/:id/fail`.
   The job → **Failed/Retry** with the reason stored.

## Test Checklist

### Connection
- [ ] Open `https://www.facebook.com`. The floating panel appears bottom-right with
      a green dot reading "Connected to backend".
- [ ] Open the popup. **Online** = Yes, **Backend connected** = Connected, **Last
      sync** updates on **Refresh**.

### Queue + claim
- [ ] In the dashboard, queue a listing. It shows as **Queued** on **/publishing**.
- [ ] Popup shows **Jobs available: 1+ ready** and enables **Start Publishing Job**.
- [ ] Click **Start Publishing Job**. The job is claimed and a Marketplace
      create-listing tab opens. **/publishing** shows the job **Publishing** with the
      extension id, **Started** timestamp.
- [ ] Claiming the same job from a second extension returns **HTTP 409** and the
      popup refreshes for another job.

### Marketplace fill + review
- [ ] On the create page the panel shows the job and auto-fills the form. Status
      reads "Fields filled… Publish was NOT clicked."
- [ ] The review panel lists filled fields, missing fields, and warnings (e.g.
      "N photo(s) available — add manually").
- [ ] **Publish is never clicked.**

### Complete
- [ ] Click **Mark Published**, paste a listing URL. Status reads "Job marked
      Published."
- [ ] **/publishing** shows the job **Published** with a **Completed** timestamp;
      the listing is recorded as Published with the URL.

### Fail
- [ ] Queue + claim another job, click **Mark Failed**, enter a reason.
- [ ] **/publishing** shows the job **Failed/Retry** with the reason and an
      incremented retry count.

### Safety
- [ ] If Facebook shows a login / checkpoint / captcha screen on the create page,
      the panel stops and shows a "Stopped for safety" banner. No fields are filled.

## Notes & Limitations

- Facebook's DOM is obfuscated and changes frequently. Field detection is
  **best-effort** by label, placeholder, and aria-label keywords. Unfound fields
  are reported under **Fields missing** — the data still arrives from the backend.
- Image upload is **not automated**: available photo count is surfaced as a warning
  so the operator can drag-drop them manually.
- Safety guardrails are intentional: the extension fills and reports but never
  submits (no Publish, no Send) and never stores Facebook credentials.

## Files

- `manifest.json` — MV3 manifest (matches `facebook.com` and `messenger.com`).
- `background.js` — service worker; all backend `fetch` calls + job lifecycle
  message handlers (`GET_NEXT_JOB`, `CLAIM_JOB`, `GET_JOB_PAYLOAD`, `COMPLETE_JOB`,
  `FAIL_JOB`, `OPEN_MARKETPLACE`).
- `content/content.js` — injects the panel; Marketplace publishing flow (fill,
  review, safety stops) + Messenger reply helper.
- `content/panel.css` — panel styling.
- `popup/` — status panel, Start Publishing Job, and backend URL configuration.
