-- Non-secret provider metadata for dealer-scoped inventory feed traceability.
-- Rollback: ALTER TABLE dealers DROP COLUMN IF EXISTS provider_name;
-- Rollback: ALTER TABLE dealers DROP COLUMN IF EXISTS provider_dealer_id;
-- Rollback: ALTER TABLE dealers DROP COLUMN IF EXISTS feed_auth_mode;
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS provider_dealer_id text,
  ADD COLUMN IF NOT EXISTS feed_auth_mode text;
