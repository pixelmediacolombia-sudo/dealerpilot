CREATE TABLE IF NOT EXISTS dealer_meta_connections (
  id serial PRIMARY KEY,
  dealer_id integer NOT NULL,
  business_id text,
  page_id text NOT NULL,
  page_name text,
  access_token_ciphertext text NOT NULL,
  token_key_version text NOT NULL DEFAULT 'v1',
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  connected_by_user_id integer,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz,
  expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealer_meta_connections_dealer_page_unique UNIQUE (dealer_id, page_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM vehicles v LEFT JOIN dealers d ON d.id = v.dealer_id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add vehicles_dealer_fk: orphan inventory rows exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_dealer_fk') THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_dealer_fk FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;

  IF EXISTS (SELECT 1 FROM page_publish_settings s LEFT JOIN dealers d ON d.id = s.dealer_id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add page_publish_settings_dealer_fk: orphan settings rows exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_publish_settings_dealer_fk') THEN
    ALTER TABLE page_publish_settings ADD CONSTRAINT page_publish_settings_dealer_fk FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;

  IF EXISTS (SELECT 1 FROM page_publishing_batches b LEFT JOIN dealers d ON d.id = b.dealer_id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add page_publishing_batches_dealer_fk: orphan batch rows exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_publishing_batches_dealer_fk') THEN
    ALTER TABLE page_publishing_batches ADD CONSTRAINT page_publishing_batches_dealer_fk FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;

  IF EXISTS (SELECT 1 FROM page_publishing_jobs j LEFT JOIN dealers d ON d.id = j.dealer_id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add page_publishing_jobs_dealer_fk: orphan job rows exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_publishing_jobs_dealer_fk') THEN
    ALTER TABLE page_publishing_jobs ADD CONSTRAINT page_publishing_jobs_dealer_fk FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;

  IF EXISTS (SELECT 1 FROM dealer_meta_connections c LEFT JOIN dealers d ON d.id = c.dealer_id WHERE d.id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add dealer_meta_connections_dealer_fk: orphan Meta connection rows exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dealer_meta_connections_dealer_fk') THEN
    ALTER TABLE dealer_meta_connections ADD CONSTRAINT dealer_meta_connections_dealer_fk FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS dealer_meta_connections_dealer_status_idx
  ON dealer_meta_connections (dealer_id, status);
