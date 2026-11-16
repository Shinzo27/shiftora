import { and, eq, schema, type Database } from '@shiftora/db';
import {
  renderShiftClaimed,
  toLocal,
  type RequestShiftLine,
  type RenderedMessage,
} from '@shiftora/domain';

import type { OutboxEvent } from '../outbox-relay.js';
import type { FanOutResult } from './fan-out.js';
import { setOrg } from './fan-out.js';
import { managersOf } from './managers.js';

const NOTHING: FanOutResult = { notifications: 0, deliveries: 0, deliveryIds: [] };

export interface ClaimNotifyDeps {
  appUrl: string;
}

/**
 * Someone took an open shift (W5 D4).
 *
 * The person who claimed it is looking at the app — they are the one who pressed the button — so
 * there is nothing to tell them. The managers are the ones who need to know, because the rota
 * they published has changed and a shift they were still trying to fill is now filled.
 */
export async function handleShiftClaimed(
  db: Database,
  event: OutboxEvent,
  deps: ClaimNotifyDeps,
): Promise<FanOutResult> {
  const shiftId = (event.payload as { shiftId?: unknown } | null)?.shiftId;
  if (typeof shiftId !== 'string') return NOTHING;

  return db.transaction(async (tx) => {
    await setOrg(tx, event.orgId);

    const [row] = await tx
      .select({
        shift: schema.shifts,
        locationName: schema.locations.name,
        timezone: schema.locations.timezone,
        employeeName: schema.employees.name,
      })
      .from(schema.shifts)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.shifts.locationId))
      .innerJoin(schema.employees, eq(schema.employees.id, schema.shifts.employeeId))
      .where(and(eq(schema.shifts.orgId, event.orgId), eq(schema.shifts.id, shiftId)))
      .limit(1);
    if (!row) return NOTHING;

    const start = toLocal(row.shift.startsAt, row.timezone);
    const end = toLocal(row.shift.endsAt, row.timezone);
    const line: RequestShiftLine = {
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      locationName: row.locationName,
    };

    const appUrl = `${deps.appUrl}/o/${event.orgId}/schedule`;
    const deliveryIds: string[] = [];
    let notifications = 0;

    for (const manager of await managersOf(tx, event.orgId, row.shift.locationId)) {
      const message: RenderedMessage = renderShiftClaimed({
        managerName: manager.name,
        employeeName: row.employeeName,
        shift: line,
        appUrl,
      });
      const created = await emailOnce(tx, event, manager.email, message, shiftId);
      if (created.created) {
        notifications += 1;
        if (created.deliveryId) deliveryIds.push(created.deliveryId);
      }
    }

    return { notifications, deliveries: deliveryIds.length, deliveryIds };
  });
}

/** One email to this manager for this event, unless a replayed job already sent it. */
async function emailOnce(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  event: OutboxEvent,
  email: string,
  message: RenderedMessage,
  shiftId: string,
): Promise<{ created: boolean; deliveryId: string | null }> {
  const [notification] = await tx
    .insert(schema.notifications)
    .values({
      orgId: event.orgId,
      outboxId: event.id,
      recipientEmail: email,
      kind: event.topic,
      subject: message.subject,
      body: message.body,
      payload: { shiftId },
    })
    .onConflictDoNothing({
      target: [schema.notifications.outboxId, schema.notifications.recipientEmail],
    })
    .returning({ id: schema.notifications.id });
  if (!notification) return { created: false, deliveryId: null };

  const [delivery] = await tx
    .insert(schema.deliveries)
    .values({
      orgId: event.orgId,
      notificationId: notification.id,
      channel: 'email',
      address: email,
      status: 'queued',
    })
    .returning({ id: schema.deliveries.id });
  return { created: true, deliveryId: delivery?.id ?? null };
}
