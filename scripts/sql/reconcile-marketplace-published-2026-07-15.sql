-- Reconcile Facebook Marketplace published status from operator screenshots.
-- Date: 2026-07-15
-- Dealer: 1
--
-- Keep ONLY these vehicles as published/live:
--   69  - 2018 Ford Escape
--   125 - 2025 Hyundai Elantra
--   45  - 2024 Chevrolet Equinox EV
--   74  - 2022 Ford F150 Lightning
--   224 - 2022 Ram 1500 Rebel
--   352 - 2025 Toyota Tacoma
--   52  - 2022 Chevrolet Silverado 1500
--   333 - 2023 Toyota Camry SE
--
-- All other Marketplace-published vehicles for dealer 1 were tests and are
-- moved out of Published/Live state. This script does not delete vehicles.

BEGIN;

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
),
before_state AS (
  SELECT
    v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    v.trim,
    v.status AS vehicle_status,
    l.status AS listing_status,
    ml.status AS marketplace_status,
    pj.status AS latest_job_status,
    CASE WHEN c.vehicle_id IS NULL THEN 'DEMOTE' ELSE 'KEEP_PUBLISHED' END AS action
  FROM vehicles v
  LEFT JOIN listings l
    ON l.vehicle_id = v.id
   AND l.channel = 'marketplace'
  LEFT JOIN marketplace_listings ml
    ON ml.vehicle_id = v.id
   AND ml.dealer_id = 1
  LEFT JOIN LATERAL (
    SELECT status
    FROM publishing_jobs
    WHERE dealer_id = 1
      AND vehicle_id = v.id
    ORDER BY created_at DESC
    LIMIT 1
  ) pj ON true
  LEFT JOIN confirmed c
    ON c.vehicle_id = v.id
  WHERE v.dealer_id = 1
    AND (
      v.status = 'Published'
      OR l.status = 'Published'
      OR ml.status = 'Live'
      OR pj.status = 'Published'
      OR c.vehicle_id IS NOT NULL
    )
)
SELECT 'BEFORE' AS section, *
FROM before_state
ORDER BY action DESC, year, make, model, vehicle_id;

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
)
INSERT INTO marketplace_listings (
  vehicle_id,
  dealer_id,
  status,
  published_at,
  notes
)
SELECT
  vehicle_id,
  1,
  'Live',
  now(),
  'Confirmed live from Facebook Marketplace screenshots on 2026-07-15.'
FROM confirmed
ON CONFLICT (vehicle_id) DO UPDATE SET
  dealer_id = EXCLUDED.dealer_id,
  status = 'Live',
  published_at = COALESCE(marketplace_listings.published_at, EXCLUDED.published_at),
  notes = EXCLUDED.notes,
  updated_at = now();

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
)
INSERT INTO listings (
  vehicle_id,
  channel,
  status,
  published_at
)
SELECT
  vehicle_id,
  'marketplace',
  'Published',
  now()
FROM confirmed
ON CONFLICT (vehicle_id, channel) DO UPDATE SET
  status = 'Published',
  published_at = COALESCE(listings.published_at, EXCLUDED.published_at),
  updated_at = now();

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
)
UPDATE vehicles v
SET status = 'Published',
    updated_at = now()
FROM confirmed c
WHERE v.dealer_id = 1
  AND v.id = c.vehicle_id;

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
),
to_demote AS (
  SELECT DISTINCT v.id AS vehicle_id
  FROM vehicles v
  LEFT JOIN listings l
    ON l.vehicle_id = v.id
   AND l.channel = 'marketplace'
  LEFT JOIN marketplace_listings ml
    ON ml.vehicle_id = v.id
   AND ml.dealer_id = 1
  LEFT JOIN publishing_jobs pj
    ON pj.vehicle_id = v.id
   AND pj.dealer_id = 1
  LEFT JOIN confirmed c
    ON c.vehicle_id = v.id
  WHERE v.dealer_id = 1
    AND c.vehicle_id IS NULL
    AND (
      v.status = 'Published'
      OR l.status = 'Published'
      OR ml.status = 'Live'
      OR pj.status = 'Published'
    )
)
UPDATE marketplace_listings ml
SET status = 'Needs Review',
    published_at = NULL,
    listing_url = NULL,
    notes = 'Unpublished during 2026-07-15 reconciliation: test listing not present in operator screenshots.',
    updated_at = now()
FROM to_demote d
WHERE ml.dealer_id = 1
  AND ml.vehicle_id = d.vehicle_id;

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
),
to_demote AS (
  SELECT DISTINCT v.id AS vehicle_id
  FROM vehicles v
  LEFT JOIN listings l
    ON l.vehicle_id = v.id
   AND l.channel = 'marketplace'
  LEFT JOIN marketplace_listings ml
    ON ml.vehicle_id = v.id
   AND ml.dealer_id = 1
  LEFT JOIN publishing_jobs pj
    ON pj.vehicle_id = v.id
   AND pj.dealer_id = 1
  LEFT JOIN confirmed c
    ON c.vehicle_id = v.id
  WHERE v.dealer_id = 1
    AND c.vehicle_id IS NULL
    AND (
      v.status = 'Published'
      OR l.status = 'Published'
      OR ml.status = 'Live'
      OR pj.status = 'Published'
    )
)
UPDATE listings l
SET status = 'Needs Review',
    published_at = NULL,
    external_url = NULL,
    updated_at = now()
FROM to_demote d
WHERE l.channel = 'marketplace'
  AND l.vehicle_id = d.vehicle_id;

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
),
to_demote AS (
  SELECT DISTINCT v.id AS vehicle_id
  FROM vehicles v
  LEFT JOIN listings l
    ON l.vehicle_id = v.id
   AND l.channel = 'marketplace'
  LEFT JOIN marketplace_listings ml
    ON ml.vehicle_id = v.id
   AND ml.dealer_id = 1
  LEFT JOIN publishing_jobs pj
    ON pj.vehicle_id = v.id
   AND pj.dealer_id = 1
  LEFT JOIN confirmed c
    ON c.vehicle_id = v.id
  WHERE v.dealer_id = 1
    AND c.vehicle_id IS NULL
    AND (
      v.status = 'Published'
      OR l.status = 'Published'
      OR ml.status = 'Live'
      OR pj.status = 'Published'
    )
)
UPDATE vehicles v
SET status = 'Active',
    updated_at = now()
FROM to_demote d
WHERE v.dealer_id = 1
  AND v.id = d.vehicle_id;

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
)
UPDATE publishing_jobs pj
SET status = 'Published',
    completed_at = COALESCE(pj.completed_at, now()),
    current_step = 'Published',
    progress_percent = 100,
    needs_review = false,
    review_reason = NULL,
    updated_at = now()
FROM confirmed c
WHERE pj.dealer_id = 1
  AND pj.vehicle_id = c.vehicle_id
  AND pj.status <> 'Published';

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
),
to_demote AS (
  SELECT DISTINCT v.id AS vehicle_id
  FROM vehicles v
  LEFT JOIN listings l
    ON l.vehicle_id = v.id
   AND l.channel = 'marketplace'
  LEFT JOIN marketplace_listings ml
    ON ml.vehicle_id = v.id
   AND ml.dealer_id = 1
  LEFT JOIN publishing_jobs pj
    ON pj.vehicle_id = v.id
   AND pj.dealer_id = 1
  LEFT JOIN confirmed c
    ON c.vehicle_id = v.id
  WHERE v.dealer_id = 1
    AND c.vehicle_id IS NULL
    AND (
      v.status = 'Published'
      OR l.status = 'Published'
      OR ml.status = 'Live'
      OR pj.status = 'Published'
    )
)
UPDATE publishing_jobs pj
SET status = 'Needs Review',
    listing_url = NULL,
    completed_at = NULL,
    current_step = 'Needs Review',
    progress_percent = 100,
    needs_review = true,
    review_reason = 'Unpublished during 2026-07-15 reconciliation: test listing not present in operator screenshots.',
    updated_at = now()
FROM to_demote d
WHERE pj.dealer_id = 1
  AND pj.vehicle_id = d.vehicle_id
  AND pj.status = 'Published';

WITH confirmed(vehicle_id) AS (
  VALUES
    (69),
    (125),
    (45),
    (74),
    (224),
    (352),
    (52),
    (333)
),
after_state AS (
  SELECT
    v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    v.trim,
    v.status AS vehicle_status,
    l.status AS listing_status,
    ml.status AS marketplace_status,
    pj.status AS latest_job_status,
    CASE WHEN c.vehicle_id IS NULL THEN 'NOT_PUBLISHED' ELSE 'KEEP_PUBLISHED' END AS expected_state
  FROM vehicles v
  LEFT JOIN listings l
    ON l.vehicle_id = v.id
   AND l.channel = 'marketplace'
  LEFT JOIN marketplace_listings ml
    ON ml.vehicle_id = v.id
   AND ml.dealer_id = 1
  LEFT JOIN LATERAL (
    SELECT status
    FROM publishing_jobs
    WHERE dealer_id = 1
      AND vehicle_id = v.id
    ORDER BY created_at DESC
    LIMIT 1
  ) pj ON true
  LEFT JOIN confirmed c
    ON c.vehicle_id = v.id
  WHERE v.dealer_id = 1
    AND (
      v.status = 'Published'
      OR l.status = 'Published'
      OR ml.status = 'Live'
      OR pj.status = 'Published'
      OR c.vehicle_id IS NOT NULL
    )
)
SELECT 'AFTER' AS section, *
FROM after_state
ORDER BY expected_state DESC, year, make, model, vehicle_id;

-- The BEFORE and AFTER result sets above are emitted for audit logs.
COMMIT;
