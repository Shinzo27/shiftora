import { and, count, eq, schema, type Database } from '@shiftora/db';
import { addressFor, nextFallback, routeChannels, type ChannelPolicy } from '@shiftora/domain';

import { setOrg } from './fan-out.js';

/**
 * Creates the next delivery down a person's ladder after one channel gave up for good — a
 * permanent provider error, an exhausted quota, retries that ran out, or no sender at all.
 *
 * The ladder is recomputed from the person as they are now (a phone number added since the
 * publish counts) and every channel the message already has a delivery on is excluded, so a
 * fallback can never loop. Paid channels are never a fallback (`nextFallback`).
 *
 * Returns the new delivery id for the caller to queue, or null when there is nowhere left to go
 * or the message was not for a member of staff (an invite is addressed to an email, which is
 * already the floor).
 */
export async function createFallback(
  db: Database,
  orgId: string,
  deliveryId: string,
  usable: ChannelPolicy,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await setOrg(tx, orgId);

    const [delivery] = await tx
      .select({
        notificationId: schema.deliveries.notificationId,
        employeeId: schema.notifications.employeeId,
      })
      .from(schema.deliveries)
      .innerJoin(
        schema.notifications,
        eq(schema.notifications.id, schema.deliveries.notificationId),
      )
      .where(and(eq(schema.deliveries.orgId, orgId), eq(schema.deliveries.id, deliveryId)));
    if (!delivery?.employeeId) return null;

    const [person] = await tx
      .select({
        email: schema.employees.email,
        phone: schema.employees.phone,
        notifyChannel: schema.employees.notifyChannel,
      })
      .from(schema.employees)
      .where(and(eq(schema.employees.orgId, orgId), eq(schema.employees.id, delivery.employeeId)));
    if (!person) return null;

    const [devices] = await tx
      .select({ total: count() })
      .from(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.orgId, orgId),
          eq(schema.pushSubscriptions.employeeId, delivery.employeeId),
        ),
      );

    const recipient = {
      preferredChannel: person.notifyChannel,
      email: person.email,
      phone: person.phone,
      pushSubscriptions: devices?.total ?? 0,
    };
    const tried = await tx
      .select({ channel: schema.deliveries.channel })
      .from(schema.deliveries)
      .where(
        and(
          eq(schema.deliveries.orgId, orgId),
          eq(schema.deliveries.notificationId, delivery.notificationId),
        ),
      );
    const next = nextFallback(
      routeChannels(recipient, usable),
      tried.map((row) => row.channel),
    );
    if (!next) return null;

    const [created] = await tx
      .insert(schema.deliveries)
      .values({
        orgId,
        notificationId: delivery.notificationId,
        channel: next,
        address: addressFor(recipient, next),
        status: 'queued',
      })
      // Two workers handling the same failure create one fallback, not two.
      .onConflictDoNothing({
        target: [schema.deliveries.notificationId, schema.deliveries.channel],
      })
      .returning({ id: schema.deliveries.id });
    return created?.id ?? null;
  });
}
