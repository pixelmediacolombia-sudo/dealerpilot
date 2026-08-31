ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS marketplace_knowledge jsonb NOT NULL DEFAULT '{}'::jsonb;
