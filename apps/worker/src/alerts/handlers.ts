import { and, eq, gte, lt, schema, sql, type Database, type Transaction } from '@shiftora/db';
import {
  EARLY_CLOCK_IN_MINUTES,
  leadLabel,
  renderMissedClockIn,
  renderMissedClockInForManager,
  renderShiftReminder,
  toLocal,
  type ChannelPolicy,
} from '@shiftora/domain';

import type { FanOutResult } from '../notifications/fan-out.js';
import { setOrg } from '../notifications/fan-out.js';
import { notifyEmployee, pushSubscriptionCounts } from '../notifications/notify.js';
import type { OutboxEvent } from '../outbox-relay.js';

export interface AlertDeps {
  usable: ChannelPolicy;
  /** The web app's URL, for the links in the messages. */
  appUrl: string;
}

const NOTHING: FanOutResult = { notifications: 0, deliveries: 0, deliveryIds: [] };

/**
 * `shift.reminder`: "your shift starts in 2 hours", to the person on the shift.
 *
 * The scan raised it a moment ago, but the queue may have been slow: the shift is re-read now,
 * and a shift that was cancelled, reassigned or has already started gets nothing — a reminder
 * that arrives after the start is noise.
 */
export async function handleShiftReminder(
  db: Database,
  event: OutboxEvent,
  deps: AlertDeps,
  now: Date = new Date(),
): Promise<FanOutResult> {
  const shiftId = shiftIdOf(event);
  if (!shiftId) return NOTHING;

  return db.transaction(async (tx) => {
    await setOrg(tx, event.orgId);
    const shift = await loadShift(tx, event.orgId, shiftId);
    if (!shift || shift.startsAt <= now) return NOTHING;

    const start = toLocal(shift.startsAt, shift.timezone);
    const end = toLocal(shift.endsAt, shift.timezone);
    const path = `/o/${event.orgId}/shifts`;
    const message = renderShiftReminder({
      employeeName: shift.employee.name,
      orgName: shift.orgName,
      locationName: shift.locationName,
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      lead: leadLabel(shift.startsAt, now),
      appUrl: `${deps.appUrl}${path}`,
    });

    const devices = await pushSubscriptionCounts(tx, [shift.employee.id]);
    const result = await notifyEmployee(tx, {
      orgId: event.orgId,
      outboxId: event.id,
      employee: shift.employee,
      pushDevices: devices.get(shift.employee.id) ?? 0,
      kind: 'shift.reminder',
      message,
      payload: { shiftId, url: path },
      usable: deps.usable,
    });
    return collect(result ? [result.deliveryId] : null);
  });
}

/**
 * `attendance.missed`: the shift started, the grace passed, and nobody clocked in.
 *
 * Two audiences: the person ("did you clock in?"), on their own channel ladder, and the managers
 * who look after that location, by email — owners always, managers whose scope includes the
 * location (no scope rows means every location). A punch that arrived since the scan cancels it.
 */
export async function handleMissedClockIn(
  db: Database,
  event: OutboxEvent,
  deps: AlertDeps,
  now: Date = new Date(),
): Promise<FanOutResult> {
  const shiftId = shiftIdOf(event);
  if (!shiftId) return NOTHING;

  return db.transaction(async (tx) => {
    await setOrg(tx, event.orgId);
    const shift = await loadShift(tx, event.orgId, shiftId);
    if (!shift || shift.endsAt <= now) return NOTHING;
    if (await hasClockedIn(tx, event.orgId, shift)) return NOTHING;

    const start = toLocal(shift.startsAt, shift.timezone);
    const staffPath = `/o/${event.orgId}/shifts`;
    const devices = await pushSubscriptionCounts(tx, [shift.employee.id]);
    const own = await notifyEmployee(tx, {
      orgId: event.orgId,
      outboxId: event.id,
      employee: shift.employee,
      pushDevices: devices.get(shift.employee.id) ?? 0,
      kind: 'attendance.missed',
      message: renderMissedClockIn({
        employeeName: shift.employee.name,
        orgName: shift.orgName,
        locationName: shift.locationName,
        date: start.date,
        startTime: start.time,
      }),
      payload: { shiftId, url: staffPath },
      usable: deps.usable,
    });
    // This event already produced its messages (a replayed job): send nothing twice.
    if (!own) return NOTHING;

    const deliveryIds: (string | null)[] = [own.deliveryId];
    for (const manager of await managersOf(tx, event.orgId, shift.locationId)) {
      const message = renderMissedClockInForManager({
        managerName: manager.name,
        employeeName: shift.employee.name,
        orgName: shift.orgName,
        locationName: shift.locationName,
        date: start.date,
        startTime: start.time,
        appUrl: `${deps.appUrl}/o/${event.orgId}/timesheets`,
      });
      const [notification] = await tx
        .insert(schema.notifications)
        .values({
          orgId: event.orgId,
          outboxId: event.id,
          recipientEmail: manager.email,
          kind: 'attendance.missed',
          subject: message.subject,
          body: message.body,
          payload: { shiftId, url: `/o/${event.orgId}/timesheets` },
        })
        .onConflictDoNothing({
          target: [schema.notifications.outboxId, schema.notifications.recipientEmail],
        })
        .returning({ id: schema.notifications.id });
      if (!notification) continue;

      const [delivery] = await tx
        .insert(schema.deliveries)
        .values({
          orgId: event.orgId,
          notificationId: notification.id,
          channel: 'email',
          address: manager.email,
          status: 'queued',
        })
        .returning({ id: schema.deliveries.id });
      deliveryIds.push(delivery?.id ?? null);
    }
    return collect(deliveryIds);
  });
}

interface LoadedShift {
  startsAt: Date;
  endsAt: Date;
  locationId: string;
  locationName: string;
  timezone: string;
  orgName: string;
  employee: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    notifyChannel: 'email' | 'whatsapp' | 'sms' | 'push';
  };
}

/** The shift as it is now, if it is still assigned to an active member of staff. */
async function loadShift(
  tx: Transaction,
  orgId: string,
  shiftId: string,
): Promise<LoadedShift | null> {
  const [row] = await tx
    .select({
      startsAt: schema.shifts.startsAt,
      endsAt: schema.shifts.endsAt,
      status: schema.shifts.status,
      locationId: schema.shifts.locationId,
      locationName: schema.locations.name,
      timezone: schema.locations.timezone,
      orgName: schema.organizations.name,
      employeeId: schema.employees.id,
      employeeName: schema.employees.name,
      email: schema.employees.email,
      phone: schema.employees.phone,
      notifyChannel: schema.employees.notifyChannel,
      employeeStatus: schema.employees.status,
    })
    .from(schema.shifts)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.shifts.locationId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.shifts.orgId))
    .innerJoin(schema.employees, eq(schema.employees.id, schema.shifts.employeeId))
    .where(and(eq(schema.shifts.orgId, orgId), eq(schema.shifts.id, shiftId)));

  if (!row || row.status !== 'assigned' || row.employeeStatus === 'archived') return null;
  return {
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    locationId: row.locationId,
    locationName: row.locationName,
    timezone: row.timezone,
    orgName: row.orgName,
    employee: {
      id: row.employeeId,
      name: row.employeeName,
      email: row.email,
      phone: row.phone,
      notifyChannel: row.notifyChannel,
    },
  };
}

/** The same test the scan uses: any punch from a little before the start until the end. */
async function hasClockedIn(tx: Transaction, orgId: string, shift: LoadedShift): Promise<boolean> {
  const earliest = new Date(shift.startsAt.getTime() - EARLY_CLOCK_IN_MINUTES * 60_000);
  const [row] = await tx
    .select({ id: schema.timeEntries.id })
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.orgId, orgId),
        eq(schema.timeEntries.employeeId, shift.employee.id),
        gte(schema.timeEntries.clockInAt, earliest),
        lt(schema.timeEntries.clockInAt, shift.endsAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Owners, and managers whose scope includes this location (no `membership_locations` rows means
 * "every location", the same rule as `LocationAccess` in the API).
 */
async function managersOf(
  tx: Transaction,
  orgId: string,
  locationId: string,
): Promise<{ name: string; email: string }[]> {
  const rows = await tx.execute<{ name: string; email: string }>(sql`
    select u.name, u.email
    from memberships m
    join users u on u.id = m.user_id
    where m.org_id = ${orgId}
      and (
        m.role = 'owner'
        or (
          m.role = 'manager'
          and (
            not exists (
              select 1 from membership_locations ml
              where ml.org_id = m.org_id and ml.user_id = m.user_id
            )
            or exists (
              select 1 from membership_locations ml
              where ml.org_id = m.org_id and ml.user_id = m.user_id and ml.location_id = ${locationId}
            )
          )
        )
      )
    order by u.name`);
  return rows.rows;
}

function shiftIdOf(event: OutboxEvent): string | null {
  const payload = (event.payload ?? {}) as { shiftId?: unknown };
  return typeof payload.shiftId === 'string' ? payload.shiftId : null;
}

function collect(ids: (string | null)[] | null): FanOutResult {
  if (!ids) return NOTHING;
  const deliveryIds = ids.filter((id): id is string => id !== null);
  return { notifications: ids.length, deliveries: deliveryIds.length, deliveryIds };
}
