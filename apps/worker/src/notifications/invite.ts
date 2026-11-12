import { eq, schema, sql, type Database } from '@shiftora/db';
import { renderInvite } from '@shiftora/domain';

import type { OutboxEvent } from '../outbox-relay.js';
import type { FanOutResult } from './fan-out.js';

interface InviteCreatedPayload {
  inviteId?: string;
  email?: string;
  role?: string;
  code?: string;
  expiresInDays?: number;
}

/**
 * An invite is a message to an **address**, not to a staff row: the person may not have an
 * account yet, which is the whole point. So the notification carries `recipient_email` and the
 * delivery is an email — no routing, because there is nowhere else to send it.
 *
 * Idempotent by `(outbox_id, recipient_email)`: a replayed event writes nothing and sends nothing.
 */
export async function handleInviteCreated(
  db: Database,
  event: OutboxEvent,
  appUrl: string,
): Promise<FanOutResult> {
  const payload = (event.payload ?? {}) as InviteCreatedPayload;
  const { email, role, code } = payload;
  if (!email || !role || !code) return { notifications: 0, deliveries: 0, deliveryIds: [] };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${event.orgId}, true)`);

    const [org] = await tx
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, event.orgId));
    if (!org) return { notifications: 0, deliveries: 0, deliveryIds: [] };

    const message = renderInvite({
      email,
      orgName: org.name,
      role,
      code,
      appUrl,
      expiresInDays: payload.expiresInDays ?? 7,
    });

    const [notification] = await tx
      .insert(schema.notifications)
      .values({
        orgId: event.orgId,
        outboxId: event.id,
        recipientEmail: email,
        kind: 'invite.created',
        subject: message.subject,
        body: message.body,
        payload: { inviteId: payload.inviteId ?? null, role },
      })
      .onConflictDoNothing({
        target: [schema.notifications.outboxId, schema.notifications.recipientEmail],
      })
      .returning({ id: schema.notifications.id });

    if (!notification) return { notifications: 0, deliveries: 0, deliveryIds: [] };

    const [delivery] = await tx
      .insert(schema.deliveries)
      .values({
        orgId: event.orgId,
        notificationId: notification.id,
        channel: 'email',
        address: email,
        status: 'queued',
      })
      .onConflictDoNothing({
        target: [schema.deliveries.notificationId, schema.deliveries.channel],
      })
      .returning({ id: schema.deliveries.id });

    return {
      notifications: 1,
      deliveries: delivery ? 1 : 0,
      deliveryIds: delivery ? [delivery.id] : [],
    };
  });
}
