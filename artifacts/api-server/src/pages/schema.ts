import { pool } from "@workspace/db";

let ready: Promise<void> | null = null;

/**
 * Pages is deliberately isolated from Marketplace's extension-owned tables.
 * Keep this idempotent so an existing production database can adopt the
 * workspace before a formal migration is run.
 */
export function ensurePagesSchema(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      create table if not exists page_publish_settings (
        id serial primary key,
        dealer_id integer not null unique,
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
        updated_at timestamptz not null default now()
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
        updated_at timestamptz not null default now()
      );
      create index if not exists page_publishing_batches_dealer_idx on page_publishing_batches (dealer_id);
      create unique index if not exists page_publishing_batches_dealer_number_idx
        on page_publishing_batches (dealer_id, batch_number);
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
        updated_at timestamptz not null default now()
      );
      create index if not exists page_publishing_jobs_status_idx on page_publishing_jobs (status);
      create index if not exists page_publishing_jobs_batch_idx on page_publishing_jobs (batch_id);
      create index if not exists page_publishing_jobs_due_idx
        on page_publishing_jobs (dealer_id, status, scheduled_at);
      create unique index if not exists page_publishing_jobs_batch_vehicle_idx
        on page_publishing_jobs (batch_id, vehicle_id);
      create table if not exists dealer_meta_connections (
        id serial primary key,
        dealer_id integer not null,
        business_id text,
        page_id text not null,
        page_name text,
        access_token_ciphertext text not null,
        token_key_version text not null default 'v1',
        scopes jsonb not null default '[]'::jsonb,
        status text not null default 'active',
        connected_by_user_id integer,
        connected_at timestamptz not null default now(),
        last_validated_at timestamptz,
        expires_at timestamptz,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint dealer_meta_connections_dealer_page_unique unique (dealer_id, page_id)
      );
      create index if not exists dealer_meta_connections_dealer_status_idx
        on dealer_meta_connections (dealer_id, status);
      do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'vehicles_dealer_fk') then
          alter table vehicles add constraint vehicles_dealer_fk foreign key (dealer_id) references dealers(id);
        end if;
        if not exists (select 1 from pg_constraint where conname = 'page_publish_settings_dealer_fk') then
          alter table page_publish_settings add constraint page_publish_settings_dealer_fk foreign key (dealer_id) references dealers(id);
        end if;
        if not exists (select 1 from pg_constraint where conname = 'page_publishing_batches_dealer_fk') then
          alter table page_publishing_batches add constraint page_publishing_batches_dealer_fk foreign key (dealer_id) references dealers(id);
        end if;
        if not exists (select 1 from pg_constraint where conname = 'page_publishing_jobs_dealer_fk') then
          alter table page_publishing_jobs add constraint page_publishing_jobs_dealer_fk foreign key (dealer_id) references dealers(id);
        end if;
        if not exists (select 1 from pg_constraint where conname = 'dealer_meta_connections_dealer_fk') then
          alter table dealer_meta_connections add constraint dealer_meta_connections_dealer_fk foreign key (dealer_id) references dealers(id);
        end if;
      end $$;
    `);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
