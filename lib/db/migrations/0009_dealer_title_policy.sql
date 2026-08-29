-- Dealer-level title policy used by Sofia. New dealers fail closed.
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS has_clean_title_inventory boolean NOT NULL DEFAULT false;
