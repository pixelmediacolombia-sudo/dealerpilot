import { pool } from "@workspace/db";

const FOLLOW_UP_DELAY_HOURS = 4;
const MAX_FOLLOW_UPS = 3;

let ready: Promise<void> | null = null;

type QueryClient = Pick<typeof pool, "query">;

export type MessengerOutboundJob = {
  id: number;
  conversationId: number;
  dealerId: number;
  kind: "normal_reply" | "follow_up";
  cycleNumber: number | null;
  followUpNumber: number | null;
  externalThreadRef: string;
  sourceUrl: string | null;
  content: string;
  expectedPreviousReply: string | null;
  status: string;
  dueAt: string | null;
};

export type FollowUpDebugState = {
  cycleNumber: number | null;
  followUpsSent: number;
  maxFollowUps: number;
  status: string;
  nextDueAt: string | null;
};

type QueueNormalReplyParams = {
  conversationId: number;
  dealerId: number;
  assistantMessageId: number;
  externalThreadRef: string;
  sourceUrl?: string | null;
  content: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractPendingQuestion(reply: string, language: string | null): string {
  const text = cleanText(reply);
  const questions = text.match(/[^?¿]{2,220}[?]/g)?.map(cleanText).filter(Boolean) ?? [];
  if (questions.length) return questions[questions.length - 1];
  return language === "es"
    ? "¿Cuál es el mejor número para compartirte los detalles del proceso?"
    : "What is the best number to share the next steps with you?";
}

function composeFollowUp(params: {
  followUpNumber: number;
  language: string | null;
  vehicleTitle: string | null;
  pendingQuestion: string;
}): string {
  const vehicle = cleanText(params.vehicleTitle);
  const question = cleanText(params.pendingQuestion);
  const inSpanish = params.language === "es";
  const subject = vehicle ? (inSpanish ? ` por el ${vehicle}` : ` about the ${vehicle}`) : "";
  if (params.followUpNumber === 1) {
    return inSpanish
      ? `Hola, solo quería confirmar si todavía te interesa${subject}. Cuando tengas un momento, ${question.charAt(0).toLowerCase()}${question.slice(1)}`
      : `Hi, I just wanted to check whether you are still interested${subject}. Whenever you have a moment, ${question.charAt(0).toLowerCase()}${question.slice(1)}`;
  }
  if (params.followUpNumber === 2) {
    return inSpanish
      ? `Hola, paso por aquí para dar seguimiento a tu consulta${subject}. Si todavía te interesa, con gusto seguimos cuando te sea cómodo. ${question}`
      : `Hi, I am checking in on your inquiry${subject}. If you are still interested, we are happy to continue whenever it is convenient for you. ${question}`;
  }
  return inSpanish
    ? `Este será nuestro último recordatorio. Si en algún momento vuelves a estar interesado${subject}, estaremos disponibles con gusto para ayudarte. Que tengas un excelente día.`
    : `This will be our last reminder. If you are interested again at any point${subject}, we will be happy to help. Have a great day.`;
}

function toJob(row: Record<string, unknown>): MessengerOutboundJob {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    dealerId: Number(row.dealer_id),
    kind: row.kind === "follow_up" ? "follow_up" : "normal_reply",
    cycleNumber: row.cycle_number == null ? null : Number(row.cycle_number),
    followUpNumber: row.follow_up_number == null ? null : Number(row.follow_up_number),
    externalThreadRef: String(row.external_thread_ref || ""),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    content: String(row.content || ""),
    expectedPreviousReply: row.expected_previous_reply == null ? null : String(row.expected_previous_reply),
    status: String(row.status || "Queued"),
    dueAt: row.due_at == null ? null : new Date(String(row.due_at)).toISOString(),
  };
}

function toDebugState(row?: Record<string, unknown>): FollowUpDebugState {
  return {
    cycleNumber: row?.cycle_number == null ? null : Number(row.cycle_number),
    followUpsSent: Number(row?.follow_ups_sent ?? 0),
    maxFollowUps: MAX_FOLLOW_UPS,
    status: String(row?.status || "idle"),
    nextDueAt: row?.next_due_at == null ? null : new Date(String(row.next_due_at)).toISOString(),
  };
}

/**
 * This is intentionally independent of the existing conversation schema. It
 * provides durable follow-up jobs without changing reply generation or the
 * extension's normal send path.
 */
export function ensureMessengerFollowUpSchema(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`
      create table if not exists messenger_follow_up_cycles (
        id serial primary key,
        conversation_id integer not null references conversations(id) on delete cascade,
        dealer_id integer not null,
        cycle_number integer not null,
        status text not null default 'Awaiting delivery',
        follow_ups_sent integer not null default 0,
        language text,
        vehicle_title text,
        pending_question text,
        last_sent_content text,
        next_due_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (conversation_id, cycle_number)
      );
      create index if not exists messenger_follow_up_cycles_active_idx
        on messenger_follow_up_cycles (dealer_id, status, next_due_at);
      create table if not exists messenger_outbound_jobs (
        id serial primary key,
        conversation_id integer not null references conversations(id) on delete cascade,
        dealer_id integer not null,
        kind text not null,
        cycle_id integer references messenger_follow_up_cycles(id) on delete cascade,
        cycle_number integer,
        follow_up_number integer,
        source_assistant_message_id integer references conversation_messages(id) on delete set null,
        external_thread_ref text not null,
        source_url text,
        content text not null,
        expected_previous_reply text,
        status text not null default 'Queued',
        due_at timestamptz,
        claimed_by_extension_id text,
        claimed_at timestamptz,
        delivered_at timestamptz,
        canceled_at timestamptz,
        cancel_reason text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (source_assistant_message_id)
      );
      create index if not exists messenger_outbound_jobs_due_idx
        on messenger_outbound_jobs (dealer_id, kind, status, due_at);
      create index if not exists messenger_outbound_jobs_thread_idx
        on messenger_outbound_jobs (dealer_id, external_thread_ref, status);
    `);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export async function queueNormalReplyForFollowUp(params: QueueNormalReplyParams): Promise<MessengerOutboundJob | null> {
  await ensureMessengerFollowUpSchema();
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
  await ensureMessengerFollowUpSchema();
  const result = await pool.query(
    "select * from messenger_outbound_jobs where source_assistant_message_id = $1 limit 1",
    [assistantMessageId],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function cancelFollowUpsForBuyerActivity(params: {
  dealerId: number;
  externalThreadRef: string;
  reason: "buyer_replied" | "phone_received" | "manual_reply_detected" | "conversation_closed";
}): Promise<FollowUpDebugState> {
  await ensureMessengerFollowUpSchema();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const cycles = await client.query(
      `update messenger_follow_up_cycles
       set status = 'Canceled', next_due_at = null, updated_at = now()
       where dealer_id = $1 and conversation_id in (
         select id from conversations where dealer_id = $1 and external_thread_ref = $2
       ) and status in ('Awaiting delivery', 'Active', 'buyer_message_missing')
       returning *`,
      [params.dealerId, params.externalThreadRef],
    );
    await client.query(
      `update messenger_outbound_jobs
       set status = 'Canceled', canceled_at = now(), cancel_reason = $3, updated_at = now()
       where dealer_id = $1 and external_thread_ref = $2
         and kind = 'follow_up' and status in ('Scheduled', 'Claimed')`,
      [params.dealerId, params.externalThreadRef, params.reason],
    );
    if (params.reason === "conversation_closed") {
      await client.query(
        `update conversations set status = 'Closed', updated_at = now()
         where dealer_id = $1 and external_thread_ref = $2`,
        [params.dealerId, params.externalThreadRef],
      );
    }
    await client.query("commit");
    return toDebugState(cycles.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function createFollowUpJob(client: QueryClient, cycle: Record<string, unknown>, externalThreadRef: string, sourceUrl: string | null) {
  const nextNumber = Number(cycle.follow_ups_sent) + 1;
  const content = composeFollowUp({
    followUpNumber: nextNumber,
    language: cycle.language == null ? null : String(cycle.language),
    vehicleTitle: cycle.vehicle_title == null ? null : String(cycle.vehicle_title),
    pendingQuestion: String(cycle.pending_question || ""),
  });
  const dueAt = new Date(Date.now() + FOLLOW_UP_DELAY_HOURS * 60 * 60 * 1000);
  const created = await client.query(
    `insert into messenger_outbound_jobs (
       conversation_id, dealer_id, kind, cycle_id, cycle_number, follow_up_number,
       external_thread_ref, source_url, content, expected_previous_reply, status, due_at
     ) values ($1, $2, 'follow_up', $3, $4, $5, $6, $7, $8, $9, 'Scheduled', $10)
     returning *`,
    [
      cycle.conversation_id,
      cycle.dealer_id,
      cycle.id,
      cycle.cycle_number,
      nextNumber,
      externalThreadRef,
      sourceUrl,
      content,
      cycle.last_sent_content,
      dueAt,
    ],
  );
  await client.query(
    `update messenger_follow_up_cycles
     set status = 'Active', next_due_at = $2, updated_at = now()
     where id = $1`,
    [cycle.id, dueAt],
  );
  return created.rows[0] ? toJob(created.rows[0]) : null;
}

export async function confirmOutboundDelivery(params: {
  jobId: number;
  dealerId: number;
  externalThreadRef: string;
  extensionId?: string | null;
}): Promise<{ job: MessengerOutboundJob; followUp: FollowUpDebugState }> {
  await ensureMessengerFollowUpSchema();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const jobResult = await client.query(
      `select * from messenger_outbound_jobs
       where id = $1 and dealer_id = $2 and external_thread_ref = $3
       for update`,
      [params.jobId, params.dealerId, params.externalThreadRef],
    );
    const job = jobResult.rows[0];
    if (!job) throw new Error("outbound_job_not_found");

    if (job.status === "Delivered") {
      const cycle = job.cycle_id
        ? await client.query("select * from messenger_follow_up_cycles where id = $1", [job.cycle_id])
        : { rows: [] };
      await client.query("commit");
      return { job: toJob(job), followUp: toDebugState(cycle.rows[0]) };
    }
    if (!["Queued", "Claimed", "Scheduled"].includes(job.status)) {
      throw new Error(`outbound_job_not_deliverable:${job.status}`);
    }

    await client.query(
      `update messenger_outbound_jobs
       set status = 'Delivered', delivered_at = now(), updated_at = now()
       where id = $1`,
      [job.id],
    );

    let cycle: Record<string, unknown> | undefined;
    if (job.kind === "normal_reply") {
      const eligibility = await client.query(
        `select c.language, c.detected_vehicle_title, c.source_url
         from conversations c
         left join leads l on l.conversation_id = c.id
         where c.id = $1
           and c.status not in ('BDC Assigned', 'Closed', 'Sold', 'Lost')
           and coalesce(l.phone, '') = ''
         limit 1`,
        [job.conversation_id],
      );
      if (eligibility.rows[0]) {
        const nextCycle = await client.query(
          `select coalesce(max(cycle_number), 0) + 1 as next_cycle
           from messenger_follow_up_cycles where conversation_id = $1`,
          [job.conversation_id],
        );
        const createdCycle = await client.query(
          `insert into messenger_follow_up_cycles (
             conversation_id, dealer_id, cycle_number, status, language, vehicle_title,
             pending_question, last_sent_content
           ) values ($1, $2, $3, 'Awaiting delivery', $4, $5, $6, $7)
           returning *`,
          [
            job.conversation_id,
            job.dealer_id,
            nextCycle.rows[0].next_cycle,
            eligibility.rows[0].language,
            eligibility.rows[0].detected_vehicle_title,
            extractPendingQuestion(job.content, eligibility.rows[0].language),
            job.content,
          ],
        );
        cycle = createdCycle.rows[0];
        if (cycle) {
          await createFollowUpJob(
            client,
            cycle,
            job.external_thread_ref,
            eligibility.rows[0].source_url ?? job.source_url ?? null,
          );
        }
      }
    } else if (job.cycle_id) {
      const cycleResult = await client.query(
        "select * from messenger_follow_up_cycles where id = $1 for update",
        [job.cycle_id],
      );
      cycle = cycleResult.rows[0];
      if (cycle) {
        const sent = Number(job.follow_up_number || cycle.follow_ups_sent || 0);
        if (sent >= MAX_FOLLOW_UPS) {
          await client.query(
            `update messenger_follow_up_cycles
             set status = 'buyer_message_missing', follow_ups_sent = $2,
                 last_sent_content = $3, next_due_at = null, updated_at = now()
             where id = $1`,
            [cycle.id, sent, job.content],
          );
          await client.query(
            "update conversations set status = 'buyer_message_missing', updated_at = now() where id = $1",
            [job.conversation_id],
          );
          cycle = { ...cycle, status: "buyer_message_missing", follow_ups_sent: sent, next_due_at: null };
        } else {
          cycle = { ...cycle, follow_ups_sent: sent, last_sent_content: job.content };
          await client.query(
            `update messenger_follow_up_cycles
             set follow_ups_sent = $2, last_sent_content = $3, updated_at = now()
             where id = $1`,
            [cycle.id, sent, job.content],
          );
          await createFollowUpJob(client, cycle, job.external_thread_ref, job.source_url ?? null);
        }
      }
    }

    const deliveredJob = { ...job, status: "Delivered" };
    const finalCycle = cycle?.id
      ? await client.query("select * from messenger_follow_up_cycles where id = $1", [cycle.id])
      : { rows: [] };
    await client.query("commit");
    return { job: toJob(deliveredJob), followUp: toDebugState(finalCycle.rows[0]) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimDueFollowUp(params: {
  dealerId: number;
  extensionId: string;
  externalThreadRef?: string | null;
}): Promise<{ job: MessengerOutboundJob | null; followUp: FollowUpDebugState }> {
  await ensureMessengerFollowUpSchema();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update messenger_outbound_jobs
       set status = 'Scheduled', claimed_by_extension_id = null, claimed_at = null, updated_at = now()
       where dealer_id = $1 and kind = 'follow_up' and status = 'Claimed'
         and claimed_at < now() - interval '15 minutes'`,
      [params.dealerId],
    );
    const claimed = await client.query(
      `with due as (
         select j.id
         from messenger_outbound_jobs j
         join conversations c on c.id = j.conversation_id
         left join leads l on l.conversation_id = c.id
         join messenger_follow_up_cycles cycle on cycle.id = j.cycle_id
         where j.dealer_id = $1 and j.kind = 'follow_up' and j.status = 'Scheduled'
           and j.due_at <= now() and cycle.status = 'Active'
           and c.status = 'active'
           and coalesce(l.phone, '') = ''
           and coalesce(l.status, '') not in ('BDC Assigned', 'Closed', 'Sold', 'Lost')
         order by j.due_at asc, j.id asc
         for update of j skip locked
         limit 1
       )
       update messenger_outbound_jobs j
       set status = 'Claimed', claimed_by_extension_id = $2, claimed_at = now(), updated_at = now()
       from due where j.id = due.id
       returning j.*`,
      [params.dealerId, params.extensionId],
    );
    const job = claimed.rows[0] ? toJob(claimed.rows[0]) : null;
    const cycle = job?.cycleNumber
      ? await client.query(
          `select * from messenger_follow_up_cycles
           where conversation_id = $1 and cycle_number = $2 limit 1`,
          [job.conversationId, job.cycleNumber],
        )
      : params.externalThreadRef
        ? await client.query(
            `select cycle.*
             from messenger_follow_up_cycles cycle
             join conversations c on c.id = cycle.conversation_id
             where c.dealer_id = $1 and c.external_thread_ref = $2
             order by cycle.updated_at desc, cycle.id desc
             limit 1`,
            [params.dealerId, params.externalThreadRef],
          )
        : { rows: [] };
    await client.query("commit");
    return { job, followUp: toDebugState(cycle.rows[0]) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelClaimedFollowUp(params: {
  jobId: number;
  dealerId: number;
  externalThreadRef: string;
  reason: "buyer_replied" | "manual_reply_detected" | "thread_changed" | "conversation_closed";
}): Promise<FollowUpDebugState> {
  await ensureMessengerFollowUpSchema();
  const job = await pool.query(
    `update messenger_outbound_jobs
     set status = 'Canceled', canceled_at = now(), cancel_reason = $4, updated_at = now()
     where id = $1 and dealer_id = $2 and external_thread_ref = $3 and status in ('Claimed', 'Scheduled')
     returning cycle_id`,
    [params.jobId, params.dealerId, params.externalThreadRef, params.reason],
  );
  if (!job.rows[0]?.cycle_id) return toDebugState();
  const cycle = await pool.query(
    `update messenger_follow_up_cycles
     set status = 'Canceled', next_due_at = null, updated_at = now()
     where id = $1 returning *`,
    [job.rows[0].cycle_id],
  );
  return toDebugState(cycle.rows[0]);
}

export const messengerFollowUpConstants = Object.freeze({
  FOLLOW_UP_DELAY_HOURS,
  MAX_FOLLOW_UPS,
});
