-- Server-side feed absence detection and Marketplace cleanup audit.
-- Keep the migration idempotent so existing DealerPilot databases can adopt it safely.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS last_seen_in_feed_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_feed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS sold_detection_source text;

CREATE INDEX IF NOT EXISTS vehicles_dealer_sold_at_idx
  ON vehicles (dealer_id, sold_at);

CREATE TABLE IF NOT EXISTS feed_ingestions (
  id serial primary key,
  dealer_id integer not null,
  ingested_at timestamptz not null default now(),
  vehicle_count integer not null default 0,
  status text not null,
  abort_reason text
);

CREATE INDEX IF NOT EXISTS feed_ingestions_dealer_status_idx
  ON feed_ingestions (dealer_id, status, ingested_at);
