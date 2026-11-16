import { and, eq, schema, sql, type Database } from '@shiftora/db';
import type { ChannelPolicy } from '@shiftora/domain';

import type { Mailer } from '../mailer.js';
import { createFallback } from './fallback.js';
import { sendPushToEmployee, type PushSender } from './push.js';
import { releaseMessage, reserveMessage } from './quota.js';
import { classifySendError, type ClassifiedFailure } from './send-error.js';

export interface DeliveryJob {
  deliveryId: string;
  orgId: string;
  /**
   * True on the queue's last attempt. A transient failure then dead-letters the delivery and
   * falls back down the ladder instead of asking for a retry nobody will run.
   */
  finalAttempt?: boolean;
}

export type DispatchResult =
  | { status: 'sent' }
  /** A decision, not an error (already sent, no sender, no quota…); maybe a fallback queued. */
  | { status: 'skipped'; reason: string; fallbackDeliveryId?: string | null }
  /** Try again later; `retryAfterMs` means the provider asked us to slow down (429). */
  | { status: 'retry'; reason: string; retryAfterMs?: number }
  /** The provider said this can never succeed: no retry, fall back now. */
  | { status: 'failed'; reason: string; fallbackDeliveryId: string | null }
  /** Every retry failed: on the dead-letter list, and fallen back. */
  | { status: 'dead'; reason: string; fallbackDeliveryId: string | null };

/**
 * A provider that sends plain text to an address — a phone number, for WhatsApp and SMS.
 *
 * Deliberately the same shape as `Mailer`, so a fake transport and a real one are
 * interchangeable. A failure should be a `SendError` saying whether a retry can help.
 */
export interface MessageSender {
  send(message: { to: string; subject: string; body: string }): Promise<unknown>;
}

/** What each channel needs. Push needs no address: it goes to the person's subscribed devices. */
export interface Adapters {
  mailer: Mailer;
  /** Null when Web Push is not configured; the push channel then records a skip, not a lie. */
  push: PushSender | null;
  /** Null until the provider is configured: a channel with no sender is never offered. */
  whatsapp: MessageSender | null;
  sms: MessageSender | null;
}

/**
 * Which channels this deployment can actually send on, in `ChannelPolicy` shape.
 *
 * `routeChannels` answers "where could this person be reached"; this answers "which of those
 * does the worker have a provider for". Handing it to the routing as the tenant policy is what
 * makes a missing adapter a routing decision instead of a failed delivery.
 */
export function sendableChannels(adapters: Adapters): ChannelPolicy {
  return {
    // SMTP has no optional keys: a worker without a mailer cannot boot.
    email: true,
    push: adapters.push !== null,
    whatsapp: adapters.whatsapp !== null,
    sms: adapters.sms !== null,
  };
}

interface FoundDelivery {
  id: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'push';
  address: string | null;
  status: string;
  subject: string;
  body: string;
  employeeId: string | null;
  payload: unknown;
}

/**
 * Sends one queued delivery, and records what happened.
 *
 * The row is the source of truth, not the job: the job carries only an id, so a retry after a
 * crash re-reads the delivery and does the right thing — including doing nothing when it has
 * already been sent. `attempts` is incremented before the provider is called, so a process that
 * dies mid-send still leaves evidence that something was tried.
 *
 * Only `retry` asks the queue for another attempt. Everything else is an answer: sent, skipped,
 * failed for good, or dead-lettered — and the last three move the message down the person's
 * ladder (`fallbackDeliveryId`) so a broken channel costs a channel, not the message.
 */
export async function dispatchDelivery(
  db: Database,
  adapters: Adapters,
  job: DeliveryJob,
  now: Date = new Date(),
): Promise<DispatchResult> {
  const found = await claimAttempt(db, job);

  if (!found) return { status: 'skipped', reason: 'Delivery no longer exists' };
  if (found.status === 'sent' || found.status === 'delivered' || found.status === 'skipped') {
    // A duplicate job: the queue did its retry, the person already has the message.
    return { status: 'skipped', reason: `Already ${found.status}` };
  }

  const context = { db, adapters, job, now };

  if (found.channel === 'push') return dispatchPush(context, found);

  if (!found.address) {
    return skipAndFallBack(context, 'No address for this channel');
  }

  if (found.channel === 'whatsapp' || found.channel === 'sms') {
    return dispatchPaid(context, found, found.channel, found.address);
  }

  try {
    await adapters.mailer.send({ to: found.address, subject: found.subject, body: found.body });
    await finish(db, job, { status: 'sent' });
    return { status: 'sent' };
  } catch (error) {
    return handleFailure(context, classifySendError(error));
  }
}

interface Context {
  db: Database;
  adapters: Adapters;
  job: DeliveryJob;
  now: Date;
}

/**
 * WhatsApp and SMS: a sender must exist, and the org must have quota left this month. The
 * reservation is taken before the call and given back if the provider refuses, so the count is
 * what was really sent and two workers cannot overspend the last message between them.
 */
async function dispatchPaid(
  context: Context,
  found: FoundDelivery,
  channel: 'whatsapp' | 'sms',
  address: string,
): Promise<DispatchResult> {
  const { db, adapters, job, now } = context;
  // A channel with no sender is a **permanent** condition: retrying cannot conjure a provider.
  // Fan-out does not offer such a channel in the first place (`sendableChannels`); this covers
  // rows queued before the sender existed or after its keys were removed.
  const sender = channel === 'whatsapp' ? adapters.whatsapp : adapters.sms;
  if (!sender) return skipAndFallBack(context, `No ${channel} sender is configured`);

  const reservation = await reserveMessage(db, job.orgId, channel, now);
  if (!reservation.reserved) {
    return skipAndFallBack(
      context,
      reservation.limit === 0
        ? `No paid location: ${channel} is not included`
        : `Monthly ${channel} quota used up (${reservation.limit})`,
    );
  }

  try {
    await sender.send({ to: address, subject: found.subject, body: found.body });
    await finish(db, job, { status: 'sent' });
    return { status: 'sent' };
  } catch (error) {
    await releaseMessage(db, job.orgId, channel, reservation.month);
    return handleFailure(context, classifySendError(error));
  }
}

/**
 * Push: one row per channel, many devices. Sent if at least one phone took it; "no devices" is a
 * skip, not a retry — retrying would spin forever on someone who never opted in.
 */
async function dispatchPush(context: Context, found: FoundDelivery): Promise<DispatchResult> {
  const { db, adapters, job } = context;
  if (!adapters.push) return skipAndFallBack(context, 'Web Push is not configured');
  if (!found.employeeId) {
    await finish(db, job, { status: 'skipped', lastError: 'No employee to push to' });
    return { status: 'skipped', reason: 'No employee' };
  }

  const url = (found.payload as { url?: string } | null)?.url;
  const result = await sendPushToEmployee(db, job.orgId, found.employeeId, adapters.push, {
    title: found.subject,
    body: found.body,
    ...(url ? { url } : {}),
  });

  if (result.sent > 0) {
    await finish(db, job, { status: 'sent' });
    return { status: 'sent' };
  }
  if (result.failed > 0) {
    return handleFailure(context, {
      kind: 'transient',
      reason: `${result.failed} device(s) refused the push`,
    });
  }

  const reason =
    result.gone > 0 ? 'Every subscribed device is gone' : 'No device has notifications on';
  await finish(db, job, { status: 'skipped', lastError: reason });
  return { status: 'skipped', reason };
}

/**
 * The one place a provider failure turns into queue behaviour:
 *   permanent    → recorded as failed, fall back now, no retry;
 *   rate_limited → recorded, retry after the provider's delay (the attempt is not spent);
 *   transient    → retry, unless this was the last attempt: then dead-letter and fall back.
 */
async function handleFailure(
  context: Context,
  failure: ClassifiedFailure,
): Promise<DispatchResult> {
  const { db, adapters, job, now } = context;

  if (failure.kind === 'rate_limited') {
    await finish(db, job, { status: 'failed', lastError: failure.reason });
    return {
      status: 'retry',
      reason: failure.reason,
      ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
    };
  }

  if (failure.kind === 'transient' && !job.finalAttempt) {
    await finish(db, job, { status: 'failed', lastError: failure.reason });
    return { status: 'retry', reason: failure.reason };
  }

  const dead = failure.kind === 'transient';
  await finish(db, job, {
    status: 'failed',
    lastError: failure.reason,
    ...(dead ? { deadLetteredAt: now } : {}),
  });
  const fallbackDeliveryId = await createFallback(
    db,
    job.orgId,
    job.deliveryId,
    sendableChannels(adapters),
  );
  return { status: dead ? 'dead' : 'failed', reason: failure.reason, fallbackDeliveryId };
}

async function skipAndFallBack(context: Context, reason: string): Promise<DispatchResult> {
  const { db, adapters, job } = context;
  await finish(db, job, { status: 'skipped', lastError: reason });
  const fallbackDeliveryId = await createFallback(
    db,
    job.orgId,
    job.deliveryId,
    sendableChannels(adapters),
  );
  return { status: 'skipped', reason, fallbackDeliveryId };
}

/** Reads the delivery and counts the attempt, in one transaction under the org's context. */
async function claimAttempt(db: Database, job: DeliveryJob): Promise<FoundDelivery | null> {
  return db.transaction(async (tx) => {
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
        employeeId: schema.notifications.employeeId,
        payload: schema.notifications.payload,
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
}

async function finish(
  db: Database,
  job: DeliveryJob,
  outcome: {
    status: 'sent' | 'failed' | 'skipped';
    lastError?: string;
    deadLetteredAt?: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${job.orgId}, true)`);
    await tx
      .update(schema.deliveries)
      .set({
        status: outcome.status,
        lastError: outcome.lastError ?? null,
        ...(outcome.status === 'sent' ? { sentAt: new Date() } : {}),
        ...(outcome.deadLetteredAt ? { deadLetteredAt: outcome.deadLetteredAt } : {}),
      })
      .where(eq(schema.deliveries.id, job.deliveryId));
  });
}
