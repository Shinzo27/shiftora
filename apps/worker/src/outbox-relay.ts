import { inArray, schema, sql, type Database } from '@shiftora/db';

/** One pending event, as the relay hands it on. */
export interface OutboxEvent {
  id: string;
  orgId: string;
  topic: string;
  payload: unknown;
  /** The trace of the request that wrote the row, if it was written inside one. */
  traceId?: string | null;
}

export type Enqueue = (event: OutboxEvent) => void | Promise<void>;

export interface RelayOptions {
  db: Database;
  /** Where claimed events go. The real one is BullMQ; tests pass a spy. */
  enqueue: Enqueue;
  batch?: number;
}

/**
 * Moves unpublished outbox rows onto the queue, and marks them published in the same
 * transaction.
 *
 * The ordering is deliberate: **enqueue first, then mark**, inside one transaction.
 *
 * - If enqueue throws, the transaction rolls back and the row stays pending — the event is
 *   not lost, it is late.
 * - If the process dies after the queue insert but before the commit, the row is still
 *   pending and will be claimed again. That duplicate is harmless because the job is added
 *   with `jobId` equal to the outbox row id, and BullMQ keeps one job per id.
 *
 * Marking first would trade those two cases for a third, unrecoverable one: a row that says
 * "published" with nothing on the queue behind it.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several worker processes run at once without
 * stepping on each other — each claims a different slice of the pending set.
 */
export async function relayOnce({ db, enqueue, batch = 50 }: RelayOptions): Promise<number> {
  return db.transaction(async (tx) => {
    // The one cross-tenant read in the system: see migration 0011 and ADR 017.
    await tx.execute(sql`select set_config('app.outbox_relay', 'on', true)`);

    const claimed = await tx.execute<{
      id: string;
      org_id: string;
      topic: string;
      payload: unknown;
      trace_id: string | null;
    }>(sql`
      select id, org_id, topic, payload, trace_id
      from outbox
      where published_at is null
      order by created_at
      limit ${batch}
      for update skip locked
    `);

    if (claimed.rows.length === 0) return 0;

    for (const row of claimed.rows) {
      await enqueue({
        id: row.id,
        orgId: row.org_id,
        topic: row.topic,
        payload: row.payload,
        traceId: row.trace_id,
      });
    }

    await tx
      .update(schema.outbox)
      .set({ publishedAt: new Date() })
      .where(
        inArray(
          schema.outbox.id,
          claimed.rows.map((row) => row.id),
        ),
      );

    return claimed.rows.length;
  });
}
