-- Configure dashboard capabilities per dealer without changing existing dealers.

ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'complete';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealers_plan_check'
  ) THEN
    ALTER TABLE dealers
      ADD CONSTRAINT dealers_plan_check
      CHECK (plan IN ('basic', 'complete'));
  END IF;
END $$;
