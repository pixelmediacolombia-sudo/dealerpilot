-- Vehicle condition is supplied per VIN by the dealer inventory provider.
-- Keep it nullable so older feed rows remain valid until the provider sends it.
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS condition text;
