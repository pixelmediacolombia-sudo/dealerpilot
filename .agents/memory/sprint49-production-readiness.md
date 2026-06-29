---
name: Sprint 4.9 Production Readiness
description: 5 new API endpoints for feed quality, dry run, extension diagnostics, field validation, launch checklist; ProductionReadiness page at /listings/readiness.
---

## Key decisions

**ExtensionConnection schema already existed** at line ~1389 of openapi.yaml. Adding a duplicate caused a YAML "duplicated mapping key" error that broke codegen. Always grep for schema names before adding new ones.

**5 new API endpoints** added to `autoPublish.ts` (not a new file) since they share all the existing vehicle selection helpers:
- `GET /auto-publish/feed-quality?dealerId=` — inventory stat card data
- `POST /auto-publish/dry-run` — same selection logic as batch, no writes
- `GET /auto-publish/extension-diagnostics?dealerId=` — extensionConnections + publishingEvents
- `GET /auto-publish/field-validation?dealerId=` — parses details JSON from fields_filled/validation_passed events
- `GET /auto-publish/launch-checklist?dealerId=` — 8-item computed checklist

**Field validation report** is populated by Chrome extension events with event type `fields_filled`, `validation_passed`, or `field_validation`. Details JSON should contain keys: `titleFound`, `priceFound`, `descriptionFound`, `mileageFound`, `imageUploadFound`, `publishButtonDetected`.

**Route** `/listings/readiness` added to App.tsx before `/listings/:id` — important ordering (specific before param routes).

**Why:** Keep all vehicle-selection helpers in one file to avoid circular deps and duplication. The ProductionReadiness page is a good staging ground for alpha-specific checks; field validation will stay empty until the real extension sends events.

**Seed data note:** Seed vehicles have 3 photos each, so batch dry run and "batch dry run passed" checklist item will always be red until real inventory is connected. This is correct behavior — the checklist is an accurate reflection of prod readiness.
