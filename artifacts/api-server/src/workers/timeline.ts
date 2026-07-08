import { db, systemTimelineEventsTable } from "@workspace/db";
import type { Logger } from "pino";

export async function logTimelineEvent(
  category: string,
  message: string,
  detail: Record<string, unknown> | undefined,
  log: Logger,
  workerId?: string,
): Promise<void> {
  try {
    await db.insert(systemTimelineEventsTable).values({
      category,
      workerId: workerId ?? null,
      message,
      detailJson: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    log.warn({ err, category, message }, "workers:timeline failed to record event — non-fatal");
  }
}
