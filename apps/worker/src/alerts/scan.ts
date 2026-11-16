import { schema, sql, type Database } from '@shiftora/db';
import { EARLY_CLOCK_IN_MINUTES, missedClockInWindow, reminderWindow } from '@shiftora/domain';

import { setOrg } from '../notifications/fan-out.js';

export interface ScanResult {
  /** Organisations looked at. */
  orgs: number;
  /** Alerts raised this scan — each one an outbox event. */
  reminders: number;
  missed: number;
  /** Swap/drop requests closed because their shift started before anyone decided (W5 D2). */
  expired: number;
}

/**
 * The minute-by-minute scan behind shift reminders and missed clock-in alerts (a BullMQ job
 * scheduler runs it; see main.ts).
 *
 * It only **raises** alerts: for each shift that is due, one `shift_alerts` row and one outbox
 * event, written together in the org's transaction. Writing the message, routing it and sending
 * it is the normal pipeline's job (relay → `shift.reminder` / `attendance.missed` handlers →
 * deliveries), so reminders get the same channels, quota, retries and fallback as everything else.
 *
 * Exactly once per shift and kind: the insert into `shift_alerts` is `ON CONFLICT DO NOTHING`
 * and the outbox row is written only for the rows it returned. Two workers scanning the same
 * minute, or a scan that runs again after a crash, raise nothing new.
 *
 * Only what staff were told counts: a shift is due only if it is in the schedule's **latest
 * publication** with the same person. A draft shift, or one reassigned since the last publish,
 * is not announced by a reminder before the manager has published it.
 */
export async function scanShiftAlerts(db: Database, now: Date = new Date()): Promise<ScanResult> {
  const orgs = await listOrgs(db);
  const result: ScanResult = { orgs: orgs.length, reminders: 0, missed: 0, expired: 0 };

  for (const org of orgs) {
    await db.transaction(async (tx) => {
      await setOrg(tx, org.id);
      result.reminders += await raiseReminders(tx, org.id, now);
      result.missed += await raiseMissedClockIns(tx, org.id, org.graceMinutes, now);
      result.expired += await expireStartedRequests(tx, org.id, now);
    });
  }
  return result;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The scan's one cross-tenant read: which organisations exist (migration 0017, ADR 019). */
async function listOrgs(db: Database): Promise<{ id: string; graceMinutes: number }[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.alert_scan', 'on', true)`);
    return tx
      .select({
        id: schema.organizations.id,
        graceMinutes: schema.organizations.attendanceGraceMinutes,
      })
      .from(schema.organizations);
  });
}

/** "In the latest publication, with this person": the shift as staff were told about it. */
const publishedToEmployee = sql`
  sc.published_version is not null
  and exists (
    select 1 from schedule_publications p
    where p.org_id = s.org_id
      and p.schedule_id = sc.id
      and p.version = sc.published_version
      and p.shifts @> jsonb_build_array(
        jsonb_build_object('shiftId', s.id, 'employeeId', s.employee_id)
      )
  )`;

async function raiseReminders(tx: Tx, orgId: string, now: Date): Promise<number> {
  const window = reminderWindow(now);
  const due = await tx.execute<{ id: string }>(sql`
    with due as (
      select s.id
      from shifts s
      join schedules sc on sc.org_id = s.org_id and sc.id = s.schedule_id
      where s.org_id = ${orgId}
        and s.status = 'assigned'
        and s.starts_at > ${window.after.toISOString()}
        and s.starts_at <= ${window.until.toISOString()}
        and ${publishedToEmployee}
    )
    select id from due`);
  return raise(
    tx,
    orgId,
    'reminder',
    'shift.reminder',
    due.rows.map((row) => row.id),
  );
}

async function raiseMissedClockIns(
  tx: Tx,
  orgId: string,
  graceMinutes: number,
  now: Date,
): Promise<number> {
  const window = missedClockInWindow(now, graceMinutes);
  const due = await tx.execute<{ id: string }>(sql`
    with due as (
      select s.id
      from shifts s
      join schedules sc on sc.org_id = s.org_id and sc.id = s.schedule_id
      where s.org_id = ${orgId}
        and s.status = 'assigned'
        and s.starts_at > ${window.after.toISOString()}
        and s.starts_at <= ${window.until.toISOString()}
        -- A shift that is already over is a timesheet question, not an alert.
        and s.ends_at > ${now.toISOString()}
        and ${publishedToEmployee}
        -- Any punch from a little before the start counts: early arrivals are not missing.
        and not exists (
          select 1 from time_entries te
          where te.org_id = s.org_id
            and te.employee_id = s.employee_id
            and te.clock_in_at >= s.starts_at - make_interval(mins => ${EARLY_CLOCK_IN_MINUTES})
            and te.clock_in_at < s.ends_at
        )
    )
    select id from due`);
  return raise(
    tx,
    orgId,
    'missed_clock_in',
    'attendance.missed',
    due.rows.map((row) => row.id),
  );
}

/**
 * Records the alerts and writes their outbox events, in the caller's transaction. Only shifts the
 * `shift_alerts` insert actually created get an event: that conflict is the exactly-once.
 */
async function raise(
  tx: Tx,
  orgId: string,
  kind: 'reminder' | 'missed_clock_in',
  topic: 'shift.reminder' | 'attendance.missed',
  shiftIds: string[],
): Promise<number> {
  if (shiftIds.length === 0) return 0;
  const alerted = await tx
    .insert(schema.shiftAlerts)
    .values(shiftIds.map((shiftId) => ({ orgId, shiftId, kind })))
    .onConflictDoNothing()
    .returning({ shiftId: schema.shiftAlerts.shiftId });
  if (alerted.length === 0) return 0;

  await tx
    .insert(schema.outbox)
    .values(alerted.map(({ shiftId }) => ({ orgId, topic, payload: { shiftId } })));
  return alerted.length;
}

/**
 * A swap or drop nobody decided before the shift started is moot: it is closed as `expired` (no
 * decider), so it leaves the inbox and frees the shift for a new request. The API refuses to act
 * on such a request too; this makes the stored state say so.
 */
async function expireStartedRequests(tx: Tx, orgId: string, now: Date): Promise<number> {
  const expired = await tx.execute<{ id: string }>(sql`
    update shift_requests r
    set status = 'expired', decided_at = ${now.toISOString()}, updated_at = now()
    where r.org_id = ${orgId}
      and r.status in ('pending_colleague', 'pending_manager')
      and exists (
        select 1 from shifts s
        where s.org_id = r.org_id
          and s.id in (r.shift_id, r.target_shift_id)
          and s.starts_at <= ${now.toISOString()}
      )
    returning r.id`);
  return expired.rows.length;
}
