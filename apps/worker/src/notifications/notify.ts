import { inArray, schema, sql, type Transaction } from '@shiftora/db';
import {
  addressFor,
  routeChannels,
  type Channel,
  type ChannelPolicy,
  type RenderedMessage,
} from '@shiftora/domain';

export interface StaffRecipient {
  id: string;
  email: string | null;
  phone: string | null;
  notifyChannel: Channel;
}

export interface NotifyEmployeeInput {
  orgId: string;
  /** The event this message descends from; with the employee, it makes the insert idempotent. */
  outboxId: string;
  employee: StaffRecipient;
  /** Subscribed browsers, so the push rung is real only for someone who has one. */
  pushDevices: number;
  kind: string;
  message: RenderedMessage;
  payload: Record<string, unknown>;
  usable: ChannelPolicy;
}

/**
 * One message to one member of staff: the notification row, and a delivery on the first channel
 * their preferences allow **and this worker can send on**. Shared by every event that talks to
 * staff (a published week, a shift reminder, a missed clock-in).
 *
 * Returns null when this event already produced this person's message (a replayed job), so the
 * caller sends nothing twice. Otherwise the delivery id to queue — a `skipped` row still has one,
 * because "nowhere to send" is recorded rather than pretended away.
 */
export async function notifyEmployee(
  tx: Transaction,
  input: NotifyEmployeeInput,
): Promise<{ deliveryId: string | null } | null> {
  const { orgId, employee } = input;

  const [notification] = await tx
    .insert(schema.notifications)
    .values({
      orgId,
      outboxId: input.outboxId,
      employeeId: employee.id,
      kind: input.kind,
      subject: input.message.subject,
      body: input.message.body,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [schema.notifications.outboxId, schema.notifications.employeeId],
    })
    .returning({ id: schema.notifications.id });
  if (!notification) return null;

  const recipient = {
    preferredChannel: employee.notifyChannel,
    email: employee.email,
    phone: employee.phone,
    pushSubscriptions: input.pushDevices,
  };
  const chain = routeChannels(recipient, input.usable);

  if (chain.length === 0) {
    // Nowhere to send: record the decision instead of pretending it was sent.
    const [skipped] = await tx
      .insert(schema.deliveries)
      .values({
        orgId,
        notificationId: notification.id,
        channel: 'email',
        address: null,
        status: 'skipped',
        lastError: 'No email address or phone number on file',
      })
      .returning({ id: schema.deliveries.id });
    return { deliveryId: skipped?.id ?? null };
  }

  // Only the first rung is queued; the rest of the ladder is where `createFallback` goes if this
  // channel gives up.
  const channel: Channel = chain[0]!;
  const [created] = await tx
    .insert(schema.deliveries)
    .values({
      orgId,
      notificationId: notification.id,
      channel,
      address: addressFor(recipient, channel),
      status: 'queued',
    })
    .onConflictDoNothing({
      target: [schema.deliveries.notificationId, schema.deliveries.channel],
    })
    .returning({ id: schema.deliveries.id });
  return { deliveryId: created?.id ?? null };
}

/** How many browsers each of these people has subscribed, in one query rather than one each. */
export async function pushSubscriptionCounts(
  tx: Transaction,
  employeeIds: string[],
): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();

  const rows = await tx
    .select({
      employeeId: schema.pushSubscriptions.employeeId,
      devices: sql<number>`count(*)::int`,
    })
    .from(schema.pushSubscriptions)
    .where(inArray(schema.pushSubscriptions.employeeId, employeeIds))
    .groupBy(schema.pushSubscriptions.employeeId);

  return new Map(rows.map((row) => [row.employeeId, Number(row.devices)]));
}
