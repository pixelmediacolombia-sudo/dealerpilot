# DealerPilot AI Extension — Changelog

## v1.3.83

- Isolates Marketplace Messenger capture from the publisher DOM automation.
- Supports active popovers that omit `role=log` by using scoped semantic and visual message extraction.
- Keeps Buyer/Dealer direction canonical and isolates simultaneous conversations by thread root.
- Adds strict capture tests for unlabeled bubbles, semantic descriptors, inactive inbox lists, and concurrent roots.

## v1.3.82

- Fails closed when the active Facebook account is not the configured seller (`Andres Ibáñez`, `Alpha Manassas`, or `Alpha Motorsport`).
- Keeps the seller identity check exact so a buyer named only `Andres` cannot pass by first-name coincidence.
- Allows independent seller tabs to poll concurrently while preserving per-thread idempotency and duplicate-capture protection.
- Adds strict E2E coverage for seller/buyer identity separation and simultaneous Messenger conversations.

## v1.3.81

- Treats the browser running DealerPilot as the seller context by contract.
- Removes the `threadStartedByCurrentUser` check from Sales AI seller validation.
- Keeps message-direction parsing only for identifying the latest buyer message and preventing replies to the seller's own message.

## v1.3.80

- Classifies seller messages labeled with the seller's Facebook name as Dealer messages.
- Sends only buyer-authored messages into Sales AI intake and prevents replies to the seller's own text.
- Adds a regression test for seller-name descriptors such as `Andres:`.

## v1.3.79

- Separates Messenger conversations for buyers with the same first name by using Facebook thread identity or a first-message fingerprint.
- Extracts the full inbound sender name when Facebook exposes it in the message descriptor.
- Reduces the wait before retrying an unconfirmed Messenger delivery from 120 seconds to 15 seconds.

## v1.3.78

- Ignore hidden Facebook tabs during automatic Messenger capture so duplicate tabs cannot compete for one thread.
- Keep Sales AI diagnostics scoped to the active tab and treat backend deduplication as a warning instead of a red failure.

## v1.3.77

**Fixed**
- Relates affirmative quick-response candidates to the nearest validated Marketplace card by shared structure and geometry, including sibling title/option branches and plain spans.
- Keeps message, composer, send, and delivery diagnostics explicit so a later send failure cannot be overwritten by a generic intake success state.
- Adds a sanitized VPS QA DOM fixture covering the live semantic log, direction labels, composer, and quick-response card contracts.

---

## v1.3.76

**Fixed**
- Detects Facebook Marketplace availability replies when Facebook renders the affirmative option as a plain `span` instead of a semantic button.
- Restricts the non-semantic fallback to the dedicated quick-response card so matching text in chat history cannot be clicked accidentally.

**Improved**
- Adds visible DOM-contract diagnostics for thread root, message extraction, composer insertion, send dispatch, and delivery confirmation.

---

## v1.3.75

**Fixed**
- Recognizes Facebook's visually truncated first-contact action, including `Yes, are you inter...`.
- Requires a sufficiently long affirmative prefix so unrelated Marketplace controls cannot be accepted accidentally.
- Adds visible Sales AI diagnostics for the latest capture stage, quick-response card, failure reason, and confirmed AI reply.

---

## v1.3.74

**Fixed**
- Detects Facebook Marketplace's first-contact quick-response card even when no normal inbound buyer bubble is rendered.
- Treats that card as the buyer's availability question before the Sales AI validation gates run.
- Preserves the quiet-window debounce, accepts the affirmative availability response once, and sends the resulting turn to intake.
- Serializes a single validated buyer message with canonical Buyer/Dealer roles instead of falling back to empty raw text.

---

## v1.3.73

**Fixed**
- Accepts Facebook Marketplace's affirmative availability quick reply inside the active seller chat.
- Follows the sales funnel requested by Alpha Motorsport: financing interest, phone capture, then call handoff.
- Lets the AI finish within a realistic response window and uses the same funnel-aware text if a fallback is required.
- Deduplicates intake across every open Facebook tab and delays delivery retries so one buyer turn cannot send twice.
- Reads current Facebook chat variants that expose visible rounded bubbles without semantic message labels.

---

## v1.3.72

**Fixed**
- Waits seven quiet seconds after the latest buyer message before requesting one AI reply for the complete burst.
- Restarts that quiet window whenever another buyer message arrives, preventing repeated replies and unnecessary token usage.
- Ignores the extension's own recently sent reply even if Facebook temporarily renders it with the wrong direction.
- Preserves repeated messages by their ordered position instead of globally deleting equal text from Sales history.
- Refreshes the open Sales conversation every two seconds and its conversation list every three seconds.

---

## v1.3.70

**Fixed**
- Detects an active Marketplace seller chat even when Facebook omits the legacy `role="log"` message container.
- Reads accessible message rows from the validated chat popover instead of requiring a semantic log wrapper.
- Keeps the Inbox list excluded until a real chat composer and heading are visible.
- Restricts automatic sending to explicit Messenger send controls or the active composer, avoiding Facebook quick-response controls.
- Confirms that Facebook cleared the composer or rendered the outgoing reply before marking delivery complete.
- Sends canonical `Buyer` and `Dealer` roles to the backend so names do not create duplicate history entries.

---

## v1.3.69

**Fixed**
- Detects the active Marketplace seller thread when Facebook renders its title as a native `h2` instead of an element with `role="heading"`.
- Adds a regression fixture matching the production thread heading observed during live VPS QA.

---

## v1.3.68

**Fixed**
- Detects the active Marketplace seller thread when Facebook renders the vehicle title as plain text instead of an item link, so the extension reaches conversation intake and automatic reply delivery.
- Accepts the vehicle title as safe Marketplace context on Marketplace inbox routes while continuing to exclude generic Messenger chats.
- Aggregates page detection per Facebook tab so another open tab can no longer overwrite an active Marketplace/Messenger state with `No`.
- Refreshes DOM-based page detection every five seconds to follow Facebook's delayed single-page rendering.

---

## v1.3.67

**Fixed**
- Keeps one inactive, pinned seller Marketplace inbox available while the personal Facebook session is connected, so Sales AI can detect new buyer messages even when the operator is working only in DealerPilot.
- Reuses an existing Marketplace inbox or Messenger tab and records monitor startup/error diagnostics instead of opening duplicate tabs.

---

## v1.3.66

**Fixed**
- Loads older Marketplace messages before intake and preserves the complete loaded thread instead of truncating it to the newest 30 messages.
- Targets the active Messenger composer instead of Facebook's first global editable field.
- Retries a generated Sales AI reply when the buyer message was saved but the first Facebook send attempt was not delivered.
- Serializes automatic conversation captures so history loading and AI delivery cannot overlap.

---

## v1.3.65

**Fixed**
- Preserves Facebook's existing Marketplace city when it already matches the publishing payload and is not marked invalid.
- Removes the cross-city dealer fallback so a listing can never substitute a different lot location.
- Revalidates backend job ownership immediately before clicking Next or Publish.
- Reclaims retries through the queue instead of allowing an older Facebook tab to continue publishing.

---

## v1.3.64

**Fixed**
- Selects Facebook's innermost city autocomplete option instead of the duplicated wrapper option.
- Verifies that Marketplace committed a valid location and closed its suggestion popup before continuing the vehicle form.
- Retries location queries and moves the job to Needs Review without filling the remaining form when Facebook does not accept a city.

---

## v1.3.63

**Fixed**
- Recreates the scheduled-job polling alarm when Chrome clears it, so the next vehicle in a batch is detected without reopening the popup.
- Rebinds due, unclaimed batch jobs when the active Chrome extension ID changes.
- Prevents manual Publish Now cleanup from cancelling valid scheduled batch jobs.

---

## v1.3.62

**Fixed**
- Reads real Marketplace messages directly from Facebook's semantic ARIA message descriptors instead of depending on wrapper tags that are absent from the live DOM.
- Preserves the primary Sales AI response when optional Marketplace metrics or down-payment intelligence synchronization fails.

---

## v1.3.61

**Fixed**
- Detects real Marketplace Messenger threads from their semantic conversation region and message log even when Facebook does not render a composer.
- Uses inbound/outbound message direction instead of a visible-label heuristic, logs every Sales AI validation gate safely, and resolves vehicles by the canonical Marketplace item ID before exact title matching.

---

## v1.3.60

**Fixed**
- Restricts Marketplace Sales AI capture to real Messenger/Marketplace conversation surfaces with reliable buyer names and buyer messages, preventing group/page UI from becoming CRM conversations.

---

## v1.3.59

**Fixed**
- Adds Marketplace Sales AI v1.0 timing/idempotency metadata for real buyer-message replies and skips duplicate/no-op Messenger intake responses.

---

## v1.3.58

**Fixed**
- Stops Messenger inbox previews from being imported as CRM conversations; automatic capture now only processes an open thread with a new buyer message.

---

## v1.3.57

**Fixed**
- Publishes only DealerPilot Photo Director's final 10 Marketplace photos.
- Polls DealerPilot sold-listing feedback and opens the matching Facebook Marketplace listing.
- Attempts to mark matching Marketplace item pages as sold so sold inventory is not republished.

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
