# DealerPilot AI — First Run Checklist

**Version:** 1.0.0  
**Account:** Alpha Motorsport  
**Date:** _______________  
**Operator:** _______________

Work through this checklist top to bottom on your first real-world test.
Mark each item ✅ when verified. Note any failures or observations.

---

## 1. Extension Loaded Successfully

**Steps:**
1. Go to `chrome://extensions`
2. Verify **DealerPilot AI Publisher** appears with version **1.0.0**
3. Confirm there are no error badges (red exclamation icon)

**Result:**
- [ ] ✅ Extension loaded, version 1.0.0 visible
- [ ] ✅ No errors shown on the extension card

**Notes:** _______________________________________________

---

## 2. Backend Connected

**Steps:**
1. Click the DealerPilot AI icon in the Chrome toolbar
2. Check the **Extension Status** panel

**Expected:**
- Online: Yes
- Backend connected: Connected (green dot)

**Result:**
- [ ] ✅ Backend connected — green dot, status "Connected"
- [ ] ✅ "Jobs available" field is visible and responding

**Backend URL used:** _______________________________________________  
**Notes:** _______________________________________________

---

## 3. DealerPilot Authenticated

**Steps:**
1. Expand **🔧 Debug Mode** in the popup
2. Verify Dealer ID shows correctly
3. Open the DealerPilot dashboard in another tab — confirm it loads Alpha Motorsport data

**Expected:**
- Dealer ID: 1 — Alpha Motorsport
- Extension UUID: ext-xxxx… (any value)
- Dashboard shows Alpha Motorsport vehicles in Inventory

**Result:**
- [ ] ✅ Dealer ID: 1 — Alpha Motorsport confirmed in Debug Mode
- [ ] ✅ Dashboard loads with Alpha Motorsport inventory

**Extension UUID (last 8 chars):** _______________________________________________  
**Notes:** _______________________________________________

---

## 4. Facebook Logged In

**Steps:**
1. Navigate to `https://www.facebook.com`
2. Confirm you are logged into the correct Facebook account (Alpha Motorsport's account or the dealer's managing account)
3. Verify you are NOT on a login, checkpoint, or security verification screen

**Result:**
- [ ] ✅ Facebook logged in — no login prompt, no security gate
- [ ] ✅ Correct account visible in the top-right corner of Facebook

**Facebook account name:** _______________________________________________  
**Notes:** _______________________________________________

---

## 5. Marketplace Detected

**Steps:**
1. Navigate to `https://www.facebook.com/marketplace`
2. Confirm the DealerPilot AI floating panel appears in the **bottom-right corner**
3. Open the popup → expand **🔧 Debug Mode**
4. Check **Marketplace Detected**

**Expected:**
- Floating panel: visible, green dot, "Connected to backend"
- Debug Mode → Marketplace Detected: Yes ✓

**Result:**
- [ ] ✅ Floating panel visible on Facebook Marketplace
- [ ] ✅ Panel shows green dot ("Connected to backend")
- [ ] ✅ Debug Mode: Marketplace Detected = Yes ✓

**Panel status message:** _______________________________________________  
**Notes:** _______________________________________________

---

## 6. Messenger Detected

**Steps:**
1. Navigate to `https://www.messenger.com` (or Facebook Messenger tab)
2. Confirm the DealerPilot AI floating panel appears
3. Confirm it shows the **"Read Chat & Suggest Reply"** button
4. Open the popup → expand **🔧 Debug Mode**
5. Check **Messenger Detected**

**Expected:**
- Floating panel: visible with "Read Chat & Suggest Reply" button
- Debug Mode → Messenger Detected: Yes ✓

**Result:**
- [ ] ✅ Panel visible on Messenger
- [ ] ✅ "Read Chat & Suggest Reply" button appears
- [ ] ✅ Debug Mode: Messenger Detected = Yes ✓

**Notes:** _______________________________________________

---

## 7. Heartbeat Received by DealerPilot

**Steps:**
1. Open the extension popup and click **Refresh Status**
2. Open Debug Mode → check **Last Heartbeat** — it should show the current time
3. In the DealerPilot dashboard, go to **Connection Center** and check that the extension connection shows a recent heartbeat timestamp

**Expected:**
- Debug Mode: Last Heartbeat = time within the last minute
- Dashboard Connection Center: Extension status = Online, recent heartbeat

**Result:**
- [ ] ✅ Last Heartbeat shows current time in Debug Mode
- [ ] ✅ Connection Center in dashboard confirms extension heartbeat

**Last Heartbeat time:** _______________________________________________  
**Notes:** _______________________________________________

---

## 8. Ready to Claim Publishing Jobs

**Steps:**
1. In the DealerPilot dashboard, navigate to **Marketplace AI → Publishing**
2. Queue one vehicle listing (select a vehicle, click "Queue for Publishing")
3. Open the extension popup — **Jobs available** should show **1+ ready**
4. Confirm **Start Publishing Job** button is enabled (not greyed out)

**Expected:**
- Dashboard: job status = Queued
- Popup: Jobs available = 1+ ready
- Popup: "Start Publishing Job" enabled

**Result:**
- [ ] ✅ Vehicle queued in dashboard (status: Queued)
- [ ] ✅ Popup shows "Jobs available: 1+ ready"
- [ ] ✅ "Start Publishing Job" button enabled

**Vehicle queued:** _______________________________________________  
**Notes:** _______________________________________________

---

## 9. OPTIONAL — Full Publishing Flow Test

> Only attempt this if all 8 checks above passed.

**Steps:**
1. Click **Start Publishing Job** in the popup
2. Verify Chrome opens `facebook.com/marketplace/create/vehicle`
3. Verify the DealerPilot panel auto-fills the form fields
4. Review: filled fields, missing fields, photo warnings
5. Upload photos manually from the job payload
6. Review the full form — DO NOT click Facebook's Publish yet
7. When satisfied, click Facebook's **Publish** button
8. In the DealerPilot panel, click **Mark Published**, paste the listing URL
9. Verify the job status in the dashboard updates to **Published**

**Result:**
- [ ] Marketplace tab opened automatically
- [ ] Form auto-filled (record which fields filled, which missed)
- [ ] Photo upload warning shown with correct photo count
- [ ] Publish NOT auto-clicked — manual review completed
- [ ] Facebook Publish clicked by operator
- [ ] "Mark Published" clicked, listing URL pasted
- [ ] Dashboard job status: Published ✓

**Fields filled:** _______________________________________________  
**Fields missed:** _______________________________________________  
**Photo count in warning:** _______________________________________________  
**Final listing URL:** _______________________________________________

---

## Summary

| Check | Status | Notes |
|-------|--------|-------|
| Extension loaded | | |
| Backend connected | | |
| DealerPilot authenticated | | |
| Facebook logged in | | |
| Marketplace detected | | |
| Messenger detected | | |
| Heartbeat received | | |
| Ready to claim jobs | | |
| Full publishing flow | | |

**Overall result:** _______________________________________________  
**Issues found:** _______________________________________________  
**Next steps:** _______________________________________________
