-- DealerPilot per-dealer creative brand identity.
-- Keep this migration idempotent so existing environments created with
-- drizzle-kit push can adopt the versioned schema without data loss.

create table if not exists dealer_brand_dna (
  id serial primary key,
  dealer_id integer not null,
  primary_colors jsonb not null default '[]'::jsonb,
  secondary_colors jsonb not null default '[]'::jsonb,
  accent_colors jsonb not null default '[]'::jsonb,
  logo_url text,
  preferred_font text not null default 'Inter',
  brand_style text not null default 'Sport',
  background_style text not null default 'Dark Studio',
  default_template_key text not null default 'marketplace-premium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dealer_brand_dna_dealer_unique unique (dealer_id)
);

create index if not exists dealer_brand_dna_dealer_idx
  on dealer_brand_dna (dealer_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dealer_brand_dna dna
    LEFT JOIN dealers d ON d.id = dna.dealer_id
    WHERE d.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add dealer_brand_dna_dealer_fk: orphan Brand DNA rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealer_brand_dna_dealer_fk'
  ) THEN
    ALTER TABLE dealer_brand_dna
      ADD CONSTRAINT dealer_brand_dna_dealer_fk
      FOREIGN KEY (dealer_id) REFERENCES dealers(id);
  END IF;
END $$;
