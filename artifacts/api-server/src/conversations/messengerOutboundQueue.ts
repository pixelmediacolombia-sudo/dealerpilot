import { pool } from "@workspace/db";

let ready: Promise<void> | null = null;

export type MessengerOutboundJob = {
  id: number;
  conversationId: number;
  dealerId: number;
  kind: "normal_reply";
  externalThreadRef: string;
  sourceUrl: string | null;
  content: string;
  status: string;
};

type QueueNormalReplyParams = {
  conversationId: number;
  dealerId: number;
  assistantMessageId: number;
  externalThreadRef: string;
  sourceUrl?: string | null;
  content: string;
};

function toJob(row: Record<string, unknown>): MessengerOutboundJob {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    dealerId: Number(row.dealer_id),
    kind: "normal_reply",
    externalThreadRef: String(row.external_thread_ref || ""),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    content: String(row.content || ""),
    status: String(row.status || "Queued"),
  };
}
/** Keep the current reply available for physical delivery confirmation. */
export function ensureMessengerOutboundSchema(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      create table if not exists messenger_outbound_jobs (
        id serial primary key,
        conversation_id integer not null references conversations(id) on delete cascade,
        dealer_id integer not null,
        kind text not null default 'normal_reply',
        source_assistant_message_id integer references conversation_messages(id) on delete set null,
        external_thread_ref text not null,
        source_url text,
        content text not null,
        status text not null default 'Queued',
        delivered_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (source_assistant_message_id)
      );
      create index if not exists messenger_outbound_jobs_thread_idx
        on messenger_outbound_jobs (dealer_id, external_thread_ref, status);
    `);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export async function queueNormalReply(params: QueueNormalReplyParams): Promise<MessengerOutboundJob | null> {
  await ensureMessengerOutboundSchema();
  const result = await pool.query(
    `insert into messenger_outbound_jobs (
       conversation_id, dealer_id, kind, source_assistant_message_id,
       external_thread_ref, source_url, content, status
     ) values ($1, $2, 'normal_reply', $3, $4, $5, $6, 'Queued')
     on conflict (source_assistant_message_id) do update
       set content = excluded.content, source_url = excluded.source_url, updated_at = now()
     returning *`,
    [
      params.conversationId,
      params.dealerId,
      params.assistantMessageId,
      params.externalThreadRef,
      params.sourceUrl ?? null,
      params.content,
    ],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function findOutboundJobForAssistantMessage(assistantMessageId: number): Promise<MessengerOutboundJob | null> {
  await ensureMessengerOutboundSchema();
  const result = await pool.query(
    "select * from messenger_outbound_jobs where source_assistant_message_id = $1 limit 1",
    [assistantMessageId],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function confirmOutboundDelivery(params: {
  jobId: number;
  dealerId: number;
  externalThreadRef: string;
  extensionId?: string | null;
}): Promise<{ job: MessengerOutboundJob }> {
  await ensureMessengerOutboundSchema();
  const result = await pool.query(
    `update messenger_outbound_jobs
     set status = 'Delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
     where id = $1 and dealer_id = $2 and external_thread_ref = $3
       and kind = 'normal_reply' and status in ('Queued', 'Claimed', 'Delivered')
     returning *`,
    [params.jobId, params.dealerId, params.externalThreadRef],
  );
  if (!result.rows[0]) throw new Error("outbound_job_not_found");
  return { job: toJob(result.rows[0]) };
}
