-- Lucki Mazda explicitly requested the existing publishing queue to be
-- approved. Limit this repair to active Marketplace jobs for dealer 2 so
-- Alpha and terminal/history rows remain untouched.
UPDATE publishing_jobs
SET approved_by_user = true,
    updated_at = now()
WHERE dealer_id = 2
  AND status IN ('Queued', 'Scheduled', 'Retry', 'Assigned');
