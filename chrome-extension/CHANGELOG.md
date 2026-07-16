# DealerPilot AI Extension — Changelog

## v1.3.57

**Fixed**
- Publishes only DealerPilot Photo Director's final 10 Marketplace photos.
- Polls DealerPilot sold-listing feedback and opens the matching Facebook Marketplace listing.
- Attempts to mark matching Marketplace item pages as sold so sold inventory is not republished.
- Stops Messenger inbox previews from being imported as CRM conversations; automatic capture now only processes an open thread with a new buyer message.

---

## v1.3.43

**Fixed**
- Keeps the extension online by refreshing the backend heartbeat from the background polling loop, not only when the popup is opened.
- Uses `https://1987dealerpilot.com` as the production default backend and labels it as `Production` in the popup.

---

## v1.3.42

**Fixed**
- Opens the matching vehicle card on Your Listings to capture the correct Marketplace item URL after Facebook publishes.

---

## v1.3.41

**Fixed**
- Only completes a Marketplace publish with a captured item URL when the listing text matches the vehicle being published.

---

## v1.3.40

**Fixed**
- Reports Marketplace as ready on any Marketplace route, not only the create vehicle form.

---

## v1.3.39

**Fixed**
- Continues after selecting Year when Facebook renders Make/Model as text fields instead of new comboboxes.

---

## v1.3.38

**Fixed**
- Runs Marketplace preflight before claiming jobs so incomplete vehicles cannot get stuck in Publishing.
- Restores an active claimed job if Chrome loses local activeJob state after a reload/update.

---

## v1.3.37

**Fixed**
- Captures Marketplace item URLs from the seller listings page after Facebook publishes.
- Stops after the first publish when Facebook lands on Your Listings, preventing duplicate listings.

---

## v1.3.36

**Fixed**
- Polls assigned queue jobs with the Chrome runtime id used by backend heartbeat assignment.
- Keeps job ownership/reporting on the extension storage id, preserving existing complete/fail flow.

---

## v1.3.35

**Fixed**
- Recognizes Facebook's `Your Listings` landing page as proof that the publish action completed.
- Moves jobs with a missing individual listing URL to Needs Review without showing a false 409 failure.
- Clears the active loading state and continues automatically with the next queue vehicle.

---

## v1.3.34

**Fixed**
- Reloads the existing Marketplace create tab after a job moves to Needs Review and the next job is claimed.
- Clears stale Facebook values and validation errors before filling the next vehicle.
- Adds a navigation fallback so a failed tab refresh cannot interrupt the automatic queue.

---

## v1.3.33

**Fixed**
- Preflights required Marketplace data before opening Facebook.
- Moves incomplete vehicles to Needs Review and immediately continues with the next eligible queue job.
- Prevents a repeatedly incompatible Facebook form from blocking every later vehicle.

---

## v1.3.32

**Fixed**
- Dashboard connection telemetry refreshes while Facebook is open, without a manual page reload.
- Publishing batches show live job progress and the current Marketplace step.
- Body style is required and truck/pickup inventory values map to Spanish Facebook options.
- Full-auto reports form completion and an enabled Next button before continuing automatically.
- Successful completion wakes the same sequential queue flow for the next eligible vehicle.

---

## v1.3.31

**Fixed**
- Marketplace location autocomplete - retries location lookup with city/state variants such as `Fredericksburg Virginia` and the city-only value when Facebook does not accept the raw `City, ST` text.
- Location suggestion commit - uses mouse-style selection events and a guarded keyboard fallback only after a visible Facebook suggestion exists, preventing the invalid raw-location state that keeps `Siguiente` disabled.

---

## v1.3.28

**Fixed**
- Marketplace location autocomplete - location now writes without blurring first, waits longer for Facebook suggestions, and matches state abbreviations such as `VA` to `Virginia`.
- Location validation - the extension no longer presses `Enter` blindly when no autocomplete suggestion is available, avoiding Facebook's invalid raw-location state.

---

## v1.3.27

**Fixed**
- Marketplace location commit - the extension now tries to select Facebook's location autocomplete suggestion after writing the city.
- Next diagnostics - visible values inside Facebook field wrappers are now considered before reporting placeholder-only blockers like `ubicacion`.

---

## v1.3.26

**Fixed**
- Marketplace description textbox - the extension now writes to Facebook textboxes/contenteditable fields, not only normal inputs and textareas.
- Next diagnostics - filled dropdown values such as `Año 2021` and `Carrocería Camioneta` are no longer misreported as blocked placeholders.

---

## v1.3.25

**Fixed**
- Marketplace form settling - the extension now commits visible form controls with input/change/blur before validating Next, helping Facebook recalculate readiness after automated selections.
- Next diagnostics - disabled Next failures now capture visible invalid/empty controls to make the remaining blocker explicit.

---

## v1.3.24

**Fixed**
- Marketplace clean title - the extension now checks Facebook's clean-title declaration when the vehicle form renders it as a required checkbox.
- Pre-Next patience - validation now waits briefly for Facebook to enable Next after the final vehicle detail is selected.

---

## v1.3.23

**Fixed**
- Marketplace vehicle details - condition, fuel type, and transmission now select Spanish Facebook options instead of being skipped and leaving Next disabled.
- Pre-Next diagnostics - disabled Next now reports skipped vehicle detail fields instead of blaming Year/Make when those fields are already filled.

---

## v1.3.22

**Fixed**
- Marketplace color controls - exterior/interior color no longer block auto-publish when the current Facebook vehicle form variant does not render those fields.

---

## v1.3.19

**Fixed**
- Automatic batches - `auto_publish_batch` jobs marked as approved by the backend can now start without popup approval.

---

## v1.3.18

**Fixed**
- Assigned job pickup - the extension now uses `assignedAt` instead of the original `createdAt` when deciding whether an assigned job is stale.
- Rescue diagnostics - the popup now shows the backend skip reason when `Check For Approved Job` cannot start a job.

---

## v1.3.17

**Fixed**
- Manual job rescue - the popup can now check for and start an approved `publish_now` job even when dashboard-to-extension wake fails with "Receiving end does not exist".
- Publish Now visibility - recent `publish_now` jobs no longer disappear from the popup just because the backend response omits the `approvedByUser` flag.
- Stale job recovery - explicit popup actions can resume old `publish_now` jobs while scheduled batch jobs remain protected from accidental auto-start.

---

## v1.3.16

**Fixed**
- Photo confirmation in Spanish Facebook sessions - the extension now accepts counters like `Fotos · 7/20` and Spanish upload labels as valid proof that Marketplace rendered uploaded thumbnails.

---

## v1.3.15

**Fixed**
- Publish diagnostics - when Facebook refuses the final Publish action because of account limits, Marketplace restrictions, duplicate listings, temporary blocks, or review/retry-later states, the extension now fails the job with that explicit reason instead of a generic "listing URL not confirmed" message.

---

## v1.3.14

**Fixed**
- Full Auto photo safety — the extension no longer treats `input.files` as proof that Facebook accepted photos. It now waits for visible thumbnails or a non-zero Facebook photo counter before continuing.
- Publish safety — if Facebook does not confirm uploaded photos, the job fails before `Next` / `Publish` instead of risking a live listing with zero photos.
- Backend assignment recovery — assigned jobs now match the real Chrome extension id, and retry/expired jobs clear stale assignment fields so they can be picked up again.

---

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
