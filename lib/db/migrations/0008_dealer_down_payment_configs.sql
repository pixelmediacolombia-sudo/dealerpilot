-- Effective-dated dealer down-payment plans and optional vehicle overrides.
-- No conversation or listing code should contain dealer-approved amounts.

CREATE TABLE IF NOT EXISTS dealer_down_payment_configs (
  id serial primary key,
  dealer_id integer not null references dealers(id),
  plan_amounts jsonb not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  CONSTRAINT dealer_down_payment_configs_dates_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT dealer_down_payment_configs_amounts_check
    CHECK (jsonb_typeof(plan_amounts) = 'array')
);

CREATE INDEX IF NOT EXISTS dealer_down_payment_configs_active_idx
  ON dealer_down_payment_configs (dealer_id, effective_from);

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS down_payment_override integer,
  ADD COLUMN IF NOT EXISTS down_payment_override_effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS down_payment_override_effective_to timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_down_payment_override_dates_check'
  ) THEN
    ALTER TABLE vehicles
      ADD CONSTRAINT vehicles_down_payment_override_dates_check
      CHECK ((
        down_payment_override IS NULL OR down_payment_override > 0
      ) AND (
        down_payment_override_effective_to IS NULL OR
        down_payment_override_effective_from IS NULL OR
        down_payment_override_effective_to > down_payment_override_effective_from
      ));
  END IF;
END $$;

INSERT INTO dealer_down_payment_configs (dealer_id, plan_amounts, effective_from)
SELECT d.id, '[1000, 2000, 3000]'::jsonb, now()
FROM dealers d
WHERE d.id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM dealer_down_payment_configs c
    WHERE c.dealer_id = d.id
      AND c.effective_to IS NULL
  );
