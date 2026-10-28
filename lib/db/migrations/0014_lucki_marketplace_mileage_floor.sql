-- Facebook Marketplace does not accept mileage below 300.
-- Keep this data repair strictly scoped to Lucki Mazda (dealer 2).
UPDATE vehicles
SET mileage = 300,
    updated_at = now()
WHERE dealer_id = 2
  AND mileage IS NOT NULL
  AND mileage < 300;
