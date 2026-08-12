-- Isolate browser sessions by dealer so multiple Facebook accounts can run on one VPS.

ALTER TABLE extension_connections
  ADD COLUMN IF NOT EXISTS dealer_id integer,
  ADD COLUMN IF NOT EXISTS session_id text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS session_id text;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_external_thread_ref_unique;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_dealer_external_thread_ref_idx
  ON conversations (dealer_id, external_thread_ref);

CREATE INDEX IF NOT EXISTS extension_connections_dealer_session_idx
  ON extension_connections (dealer_id, session_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extension_connections_dealer_fk'
  ) THEN
    ALTER TABLE extension_connections
      ADD CONSTRAINT extension_connections_dealer_fk
      FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;
END $$;
