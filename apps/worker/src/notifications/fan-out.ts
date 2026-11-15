import { and, eq, inArray, schema, sql, type Database, type Transaction } from '@shiftora/db';
import {
  renderSchedulePublished,
  startOfWeek,
  routeChannels,
  addressFor,
  toLocal,
  type Channel,
  type ChannelPolicy,
  type ShiftLine,
} from '@shiftora/domain';

import type { OutboxEvent } from '../outbox-relay.js';

export interface FanOutResult {
  /** Notifications created; 0 means this event was already handled. */
  notifications: number;
  deliveries: number;
  /** The delivery rows just created, so the caller can queue one send job each. */
  deliveryIds: string[];
}

interface SchedulePublishedPayload {
  scheduleId?: string;
  locationId?: string;
  weekStart?: string;
  version?: number;
  added?: number;
  changed?: number;
  removed?: number;
  affectedEmployeeIds?: string[];
}

/**
 * Turns `schedule.published` into one message per affected employee, each with a delivery on the
 * first channel their own preferences allow **and this deployment can send on**.
 *
 * Everything happens in one transaction under the event's org context, so a fan-out that dies
 * half-way leaves nothing behind and the queue retry starts clean. Idempotent by
 * `(outbox_id, employee_id)`: replaying the event inserts nothing and sends nothing.
 *
 * "Affected" comes from the publication diff, not from the whole rota — staff whose week did not
 * change are not messaged. That is the difference between a useful notification and a weekly
 * nuisance.
 *
 * `usable` is the channel policy the worker passes in: what it has a provider for (and, from
 * week 8, what the org's plan and message quota still allow). A channel that appears in someone's
 * preference but not in `usable` is not chosen — routing falls to the next rung, which is the
 * difference between "email instead of WhatsApp" and "no message at all".
 */
export async function fanOutSchedulePublished(
  db: Database,
  event: OutboxEvent,
  usable: ChannelPolicy,
): Promise<FanOutResult> {
  const payload = (event.payload ?? {}) as SchedulePublishedPayload;
  const employeeIds = payload.affectedEmployeeIds ?? [];
  if (!payload.locationId || !payload.weekStart || employeeIds.length === 0) {
    return { notifications: 0, deliveries: 0, deliveryIds: [] };
  }
  // Narrowed once here, so the closures below do not have to re-prove it.
  const locationId = payload.locationId;
  const weekStart = payload.weekStart;

  return db.transaction(async (tx) => {
    await setOrg(tx, event.orgId);

    const [org] = await tx
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, event.orgId));
    const [location] = await tx
      .select({ name: schema.locations.name, timezone: schema.locations.timezone })
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId));
    if (!org || !location) return { notifications: 0, deliveries: 0, deliveryIds: [] };

    const staff = await tx
      .select({
        id: schema.employees.id,
        name: schema.employees.name,
        email: schema.employees.email,
        phone: schema.employees.phone,
        notifyChannel: schema.employees.notifyChannel,
        status: schema.employees.status,
      })
      .from(schema.employees)
      .where(inArray(schema.employees.id, employeeIds));

    const shifts = await tx
      .select({
        employeeId: schema.shifts.employeeId,
        startsAt: schema.shifts.startsAt,
        endsAt: schema.shifts.endsAt,
        jobRoleId: schema.shifts.jobRoleId,
      })
      .from(schema.shifts)
      .where(
        and(
          eq(schema.shifts.locationId, locationId),
          eq(schema.shifts.status, 'assigned'),
          inArray(schema.shifts.employeeId, employeeIds),
        ),
      );

    const roleNames = await roleNamesById(tx);
    // Push is a real channel only for a person with a subscribed device, so the count is part of
    // routing and comes from the table. Assuming zero (as the first version did) made the push
    // rung unreachable even after the adapter shipped.
    const pushDevices = await pushSubscriptionCounts(tx, employeeIds);

    let notifications = 0;
    let deliveries = 0;
    const deliveryIds: string[] = [];

    for (const person of staff) {
      if (person.status === 'archived') continue;

      const lines: ShiftLine[] = shifts
        .filter((shift) => shift.employeeId === person.id)
        .filter((shift) => weekOf(shift.startsAt, location.timezone) === weekStart)
        .map((shift) => {
          const start = toLocal(shift.startsAt, location.timezone);
          const end = toLocal(shift.endsAt, location.timezone);
          return {
            date: start.date,
            startTime: start.time,
            endTime: end.time,
            roleName: shift.jobRoleId ? (roleNames.get(shift.jobRoleId) ?? null) : null,
          };
        });

      const message = renderSchedulePublished({
        employeeName: person.name,
        orgName: org.name,
        locationName: location.name,
        weekStart: weekStart,
        shifts: lines,
        changes: {
          added: payload.added ?? 0,
          changed: payload.changed ?? 0,
          removed: payload.removed ?? 0,
        },
      });

      const [notification] = await tx
        .insert(schema.notifications)
        .values({
          orgId: event.orgId,
          outboxId: event.id,
          employeeId: person.id,
          kind: 'schedule.published',
          subject: message.subject,
          body: message.body,
          payload: { weekStart: weekStart, shifts: lines.length, version: payload.version },
        })
        // A replayed event: this person already has their message.
        .onConflictDoNothing({
          target: [schema.notifications.outboxId, schema.notifications.employeeId],
        })
        .returning({ id: schema.notifications.id });

      if (!notification) continue;
      notifications += 1;

      const recipient = {
        preferredChannel: person.notifyChannel,
        email: person.email,
        phone: person.phone,
        pushSubscriptions: pushDevices.get(person.id) ?? 0,
      };
      const chain = routeChannels(recipient, usable);

      if (chain.length === 0) {
        // Nowhere to send: record the decision instead of pretending it was sent.
        const [skipped] = await tx
          .insert(schema.deliveries)
          .values({
            orgId: event.orgId,
            notificationId: notification.id,
            channel: 'email',
            address: null,
            status: 'skipped',
            lastError: 'No email address or phone number on file',
          })
          .returning({ id: schema.deliveries.id });
        if (skipped) deliveryIds.push(skipped.id);
        deliveries += 1;
        continue;
      }

      // The first rung is queued now. The rest of the chain is the fallback ladder for D4, which
      // needs the next channel recorded on the row so a permanent provider failure can move down
      // without recomputing who was reachable at publish time.
      const channel: Channel = chain[0]!;
      const [created] = await tx
        .insert(schema.deliveries)
        .values({
          orgId: event.orgId,
          notificationId: notification.id,
          channel,
          address: addressFor(recipient, channel),
          status: 'queued',
        })
        .onConflictDoNothing({
          target: [schema.deliveries.notificationId, schema.deliveries.channel],
        })
        .returning({ id: schema.deliveries.id });
      if (!created) continue;
      deliveryIds.push(created.id);
      deliveries += 1;
    }

    return { notifications, deliveries, deliveryIds };
  });
}

/** The org context every tenant query in this transaction runs under. */
export async function setOrg(tx: Transaction, orgId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
}

function weekOf(instant: Date, timezone: string): string {
  return startOfWeek(toLocal(instant, timezone).date);
}

async function roleNamesById(tx: Transaction): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: schema.jobRoles.id, name: schema.jobRoles.name })
    .from(schema.jobRoles);
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** How many browsers each of these people has subscribed, in one query rather than one each. */
async function pushSubscriptionCounts(
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
