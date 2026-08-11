-- DealerPilot Pages direct-publishing queue.
-- This migration is intentionally isolated from Marketplace publishing tables.

create table if not exists page_publish_settings (
  id serial primary key,
  dealer_id integer not null,
  enabled boolean not null default false,
  vehicles_per_batch integer not null default 3,
  frequency_days integer not null default 1,
  preferred_window_start text not null default '09:00',
  preferred_window_end text not null default '17:00',
  max_posts_per_day integer not null default 3,
  min_delay_minutes integer not null default 30,
  require_approval boolean not null default false,
  use_original_photos boolean not null default true,
  ai_creative_if_low boolean not null default true,
  photo_score_threshold integer not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_publish_settings_dealer_unique unique (dealer_id)
);

create table if not exists page_publishing_batches (
  id serial primary key,
  dealer_id integer not null,
  batch_number integer not null default 1,
  status text not null default 'Scheduled',
  total_vehicles integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_publishing_batches_dealer_number_unique unique (dealer_id, batch_number)
);

create index if not exists page_publishing_batches_dealer_idx
  on page_publishing_batches (dealer_id);

create table if not exists page_publishing_jobs (
  id serial primary key,
  batch_id integer not null,
  vehicle_id integer not null,
  dealer_id integer not null,
  status text not null default 'Scheduled',
  current_step text,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_reason text,
  attempts integer not null default 0,
  meta_post_id text,
  post_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_publishing_jobs_batch_vehicle_unique unique (batch_id, vehicle_id)
);

create index if not exists page_publishing_jobs_status_idx
  on page_publishing_jobs (status);

create index if not exists page_publishing_jobs_batch_idx
  on page_publishing_jobs (batch_id);

create index if not exists page_publishing_jobs_due_idx
  on page_publishing_jobs (dealer_id, status, scheduled_at);
