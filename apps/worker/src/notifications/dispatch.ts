import { and, eq, schema, sql, type Database } from '@shiftora/db';

import type { Mailer } from '../mailer.js';

export interface DeliveryJob {
  deliveryId: string;
  orgId: string;
}

export type DispatchResult =
  { status: 'sent' } | { status: 'skipped'; reason: string } | { status: 'retry'; reason: string };

/**
 * Sends one queued delivery, and records what happened.
 *
 * The row is the source of truth, not the job: the job carries only an id, so a retry after a
 * crash re-reads the delivery and does the right thing — including doing nothing when it has
 * already been sent. `attempts` is incremented before the provider is called, so a process that
 * dies mid-send still leaves evidence that something was tried.
 *
 * The outcome decides the queue's behaviour: `sent` and `skipped` are answers (the job
 * completes), `retry` throws so BullMQ backs off and tries again.
 */
export async function dispatchDelivery(
  db: Database,
  mailer: Mailer,
  job: DeliveryJob,
): Promise<DispatchResult> {
  const found = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${job.orgId}, true)`);

    const [row] = await tx
      .select({
        id: schema.deliveries.id,
        channel: schema.deliveries.channel,
        address: schema.deliveries.address,
        status: schema.deliveries.status,
        attempts: schema.deliveries.attempts,
        subject: schema.notifications.subject,
        body: schema.notifications.body,
      })
      .from(schema.deliveries)
      .innerJoin(
        schema.notifications,
        eq(schema.notifications.id, schema.deliveries.notificationId),
      )
      .where(and(eq(schema.deliveries.id, job.deliveryId), eq(schema.deliveries.orgId, job.orgId)));

    if (!row) return null;

    await tx
      .update(schema.deliveries)
      .set({ attempts: row.attempts + 1 })
      .where(eq(schema.deliveries.id, row.id));

    return row;
  });

  if (!found) return { status: 'skipped', reason: 'Delivery no longer exists' };
  if (found.status === 'sent' || found.status === 'delivered' || found.status === 'skipped') {
    // A duplicate job: the queue did its retry, the person already has the message.
    return { status: 'skipped', reason: `Already ${found.status}` };
  }
  if (!found.address) {
    await finish(db, job, 'skipped', 'No address for this channel');
    return { status: 'skipped', reason: 'No address' };
  }

  if (found.channel !== 'email') {
    // WhatsApp, SMS and push adapters arrive in D4/D3-push; queueing them is honest, sending them
    // is not implemented yet, and pretending otherwise would mark a message delivered that never was.
    await finish(db, job, 'failed', `No ${found.channel} adapter yet`);
    return { status: 'retry', reason: `No ${found.channel} adapter yet` };
  }

  try {
    await mailer.send({ to: found.address, subject: found.subject, body: found.body });
    await finish(db, job, 'sent', null);
    return { status: 'sent' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await finish(db, job, 'failed', reason);
    return { status: 'retry', reason };
  }
}

async function finish(
  db: Database,
  job: DeliveryJob,
  status: 'sent' | 'failed' | 'skipped',
  lastError: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${job.orgId}, true)`);
    await tx
      .update(schema.deliveries)
      .set({
        status,
        lastError,
        ...(status === 'sent' ? { sentAt: new Date() } : {}),
      })
      .where(eq(schema.deliveries.id, job.deliveryId));
  });
}
