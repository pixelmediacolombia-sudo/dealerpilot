# DealerPilot AI — Chrome Extension Install Guide

**Version:** 1.0.0 — First real-world test against Alpha Motorsport's live Facebook Marketplace account.

---

## What This Extension Does

The DealerPilot AI Publisher extension connects the DealerPilot dashboard's publishing queue directly to Facebook Marketplace.

When you queue a vehicle in the dashboard, this extension:
1. Claims the job from the queue
2. Opens the Marketplace vehicle listing creation page
3. Auto-fills the form fields (title, price, mileage, year, make, model, VIN, description, location)
4. Shows you a review panel — filled fields, missing fields, and photo warnings
5. Waits for you to upload photos manually, review the listing, and click **Publish** yourself
6. Reports the outcome (Published or Failed) back to the dashboard

**The extension NEVER auto-clicks Publish, NEVER auto-sends messages, and NEVER stores your Facebook password.**

---

## Prerequisites

- Google Chrome (or any Chromium-based browser: Edge, Brave, etc.)
- Access to the DealerPilot AI backend URL (your Render deployment or local server)
- A Facebook account logged in to the Alpha Motorsport dealer page

---

## Step 1 — Download the Extension Folder

The extension folder is located at `chrome-extension/` inside the project repository.

If you downloaded the ZIP file (`DealerPilot-Extension-v1.zip`), unzip it to a permanent location on your computer — **do not move or delete the folder after loading it**.

---

## Step 2 — Enable Developer Mode in Chrome

1. Open Chrome and navigate to: `chrome://extensions`
2. In the **top-right corner**, find the **Developer mode** toggle
3. Flip it **ON**

You will see three new buttons appear: **Load unpacked**, **Pack extension**, **Update**

> **Why Developer Mode?** Chrome requires extensions to be published on the Chrome Web Store for regular installation. Developer mode lets you load local extension folders directly for testing.

---

## Step 3 — Load the Extension (Load Unpacked)

1. Click the **Load unpacked** button
2. A file picker dialog opens — navigate to the **`chrome-extension/`** folder (or the unzipped folder)
3. Select the folder itself (not a file inside it — the folder that contains `manifest.json`)
4. Click **Select Folder** (or **Open** on Mac)

The extension appears in your list as:

> **DealerPilot AI Publisher** — v1.0.0  
> Connects the DealerPilot AI dashboard to Facebook Marketplace...

You should see a small DP icon in your Chrome toolbar (click the puzzle piece icon if it's not visible, then pin DealerPilot AI).

---

## Step 4 — Configure the Backend URL

The extension needs to know where your DealerPilot backend is running.

1. Click the **DealerPilot AI** icon in the Chrome toolbar
2. The popup opens — you'll see the **Extension Status** panel
3. Scroll down and click **⚙ Backend settings** to expand it
4. In the **Backend URL** field, enter your backend URL:
   - **Render (production):** `https://your-render-service.onrender.com`
   - **Local dev:** `http://localhost:5000`
5. Click **Save & Test Connection**

The status panel updates immediately:
- ✅ **Backend connected: Connected** — the extension can reach the server
- ❌ **Backend connected: Unreachable** — check the URL, server status, and CORS settings

> **No trailing slash.** The URL should end with the domain, not a `/`.

---

## Step 5 — Verify the Connection

After saving the backend URL:

1. The popup shows **Backend connected: Connected** with a green dot
2. Navigate to `https://www.facebook.com` — the **DealerPilot AI Connected** floating panel appears in the bottom-right corner with a green dot
3. In the popup, click **🔧 Debug Mode** to expand it
4. Verify:
   - **Extension Version:** 1.0.0
   - **Connection Status:** Connected
   - **Dealer ID:** 1 — Alpha Motorsport
   - **Last Heartbeat:** shows the current time (updated on each ping)
   - **Extension ID:** shows your Chrome extension's unique ID

---

## Step 6 — Test a Publishing Job

1. In the DealerPilot dashboard, go to **Marketplace AI → Publishing** and queue a vehicle listing
2. Open the extension popup — **Jobs available** should show **1+ ready**
3. Click **Start Publishing Job**
4. Chrome opens a new tab: `https://www.facebook.com/marketplace/create/vehicle`
5. The DealerPilot panel auto-fills the form
6. Review the form, upload photos manually, then click Facebook's **Publish** button
7. In the DealerPilot panel, click **Mark Published** and paste the listing URL
8. The job status updates to **Published** in the dashboard

---

## Step 7 — Updating the Extension After Code Changes

When the extension code is updated:

1. Go to `chrome://extensions`
2. Find **DealerPilot AI Publisher**
3. Click the **↺ refresh** icon (circular arrow) on the extension card

**OR** click the **Update** button at the top of `chrome://extensions`.

> For changes to `content.js`, you also need to **reload** any open Facebook/Messenger tabs (Cmd+R / Ctrl+R) because the content script is injected on page load.

For `background.js` or `popup.js` changes, just refreshing the extension is enough — the service worker restarts automatically.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Extension doesn't appear in toolbar | Click the puzzle piece icon → pin DealerPilot AI |
| Backend connected: Unreachable | Check backend URL (no trailing slash), verify the server is running |
| Floating panel doesn't appear on Facebook | Reload the Facebook tab after loading the extension |
| "No jobs available" | Queue a vehicle in the dashboard first via Marketplace AI → Publishing |
| Fields not filling | Facebook's form may not have loaded yet — wait 2s and click **Fill Marketplace Fields** |
| Job claimed by another extension | A second extension instance already claimed it — click Refresh to get the next one |
| Security gate / captcha banner | Log into Facebook manually, complete the security check, then retry |
| Content script errors in console | Check `chrome://extensions` → DealerPilot → **Errors** for details |

---

## Security Notes

- The extension stores your backend URL in `chrome.storage.local` (local to your Chrome profile)
- A random `extensionId` UUID is generated on first install for job claiming — it contains no Facebook credentials
- All API calls are made from the background service worker, bypassing Facebook's Content Security Policy
- The extension never reads, stores, or transmits your Facebook password, cookies, or session tokens
- The floating panel and form-filling only run on `facebook.com` and `messenger.com`
