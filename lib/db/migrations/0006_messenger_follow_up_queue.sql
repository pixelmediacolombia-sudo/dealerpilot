-- Durable Messenger follow-up cycles. The extension remains the only sender:
-- it claims a due job and confirms physical Facebook delivery afterwards.

CREATE TABLE IF NOT EXISTS messenger_follow_up_cycles (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  dealer_id integer NOT NULL,
  cycle_number integer NOT NULL,
  status text NOT NULL DEFAULT 'Awaiting delivery',
  follow_ups_sent integer NOT NULL DEFAULT 0,
  language text,
  vehicle_title text,
  pending_question text,
  last_sent_content text,
  next_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, cycle_number)
);

CREATE INDEX IF NOT EXISTS messenger_follow_up_cycles_active_idx
  ON messenger_follow_up_cycles (dealer_id, status, next_due_at);

CREATE TABLE IF NOT EXISTS messenger_outbound_jobs (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  dealer_id integer NOT NULL,
  kind text NOT NULL,
  cycle_id integer REFERENCES messenger_follow_up_cycles(id) ON DELETE CASCADE,
  cycle_number integer,
  follow_up_number integer,
  source_assistant_message_id integer REFERENCES conversation_messages(id) ON DELETE SET NULL,
  external_thread_ref text NOT NULL,
  source_url text,
  content text NOT NULL,
  expected_previous_reply text,
  status text NOT NULL DEFAULT 'Queued',
  due_at timestamptz,
  claimed_by_extension_id text,
  claimed_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_assistant_message_id)
);

CREATE INDEX IF NOT EXISTS messenger_outbound_jobs_due_idx
  ON messenger_outbound_jobs (dealer_id, kind, status, due_at);

CREATE INDEX IF NOT EXISTS messenger_outbound_jobs_thread_idx
  ON messenger_outbound_jobs (dealer_id, external_thread_ref, status);
