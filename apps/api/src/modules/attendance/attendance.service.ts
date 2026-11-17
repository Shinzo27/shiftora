import { Injectable } from '@nestjs/common';
import {
  addDays,
  checkGeofence,
  deviceSkewFlag,
  matchShift,
  nominalMinutes,
  toInstant,
  toLocal,
  type GeofenceFlag,
} from '@shiftora/domain';
import { newId } from '@shiftora/db';
import {
  errorCodes,
  type Attendance,
  type AttendanceQuery,
  type AttendanceRow,
  type ClockInRequest,
  type ClockOutRequest,
  type ClockResult,
  type MyTimeEntries,
  type MyTimeEntriesQuery,
  type TimeEntry,
  type TimeEntryWithEdits,
  type ReviewTimeEntryRequest,
  type UpdateTimeEntryRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { uniqueViolation } from '../../common/db-errors.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { PayLocksService } from '../pay-periods/pay-locks.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { EmployeeRecord } from '../employees/employees.repository.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { LocationsRepository, type LocationRecord } from '../locations/locations.repository.js';
import { OrgsRepository } from '../orgs/orgs.repository.js';
import { ShiftsService } from '../scheduling/shifts.service.js';
import type { ShiftRecord } from '../scheduling/shifts.repository.js';
import { TimeEntriesRepository, type TimeEntryRow } from './time-entries.repository.js';

/** Longer than any real shift: sixteen hours catches "out at 08:00" for "out at 18:00". */
const MAX_PUNCH_MS = 16 * 60 * 60 * 1000;

const timeEntryNotFound = () =>
  new AppException(404, errorCodes.timeEntryNotFound, 'No such punch.');

const notLinked = () =>
  new AppException(
    403,
    errorCodes.attendanceNotLinked,
    'This login is not linked to a staff profile, so there is nothing to clock in as.',
  );

/**
 * Clocking in and out, and the manager's view of what happened.
 *
 * The decision that matters is the geofence, and it is made here — on the server, from the
 * organisation's own copy of the location's coordinates, never from a number the device sends
 * besides its own position. `packages/domain` holds the maths; this holds the policy:
 *
 * - **flag** (the default): the punch is recorded with an `outside_geofence` flag and the
 *   manager decides. A clinic would rather have the attendance than the argument.
 * - **reject**: answered with 422, so nobody starts a shift untracked.
 *
 * Punches are idempotent by `Idempotency-Key` (`client_event_id`): a phone that retries after a
 * dead connection gets the row it already created, marked `created: false`.
 *
 * **Lateness is derived, never stored.** A punch knows its shift; the difference between the two
 * is computed on read with the organisation's grace, so correcting a punch later cannot leave a
 * stale flag behind.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly entries: TimeEntriesRepository,
    private readonly employees: EmployeesService,
    private readonly locations: LocationsRepository,
    private readonly orgs: OrgsRepository,
    private readonly shifts: ShiftsService,
    private readonly access: LocationAccess,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly payLocks: PayLocksService,
  ) {}

  async clockIn(input: ClockInRequest, idempotencyKey?: string): Promise<ClockResult> {
    const employee = await this.requireEmployee();
    const location = await this.locations.findById(input.locationId);
    if (!location) throw new AppException(404, errorCodes.locationNotFound, 'No such location.');

    // One person punches one shift at a time: hold their lock for the rest of this transaction,
    // so a simultaneous retry waits here instead of colliding with the unique index below.
    await this.entries.lockEmployee(employee.id);

    // A retry of a punch already stored: answer with that row instead of refusing a duplicate.
    const key = idempotencyKey ?? newId();
    const existing = await this.entries.findByClientEventId(key);
    if (existing) return { entry: await this.entryView(existing, location), created: false };

    const receivedAt = new Date();
    const deviceTime = input.at ? new Date(input.at) : receivedAt;
    const grace = await this.orgs.attendanceGraceMinutes();

    // The app sends the shift it is showing; anything else (a widget, a manual punch) is matched
    // here — the employee's shift starting nearest to the punch, if one is within reach.
    let shiftId = input.shiftId ?? null;
    if (shiftId) {
      await this.shifts.assertPunchable(shiftId, employee.id, location.id);
    } else {
      shiftId = await this.matchShiftId(employee.id, deviceTime, grace);
    }

    const open = await this.entries.findOpen(employee.id);
    if (open) {
      throw new AppException(
        409,
        errorCodes.attendanceAlreadyClockedIn,
        'You are already clocked in — clock out before starting another shift.',
      );
    }

    const check = checkGeofence({
      from: { latitude: input.latitude, longitude: input.longitude },
      to: { latitude: location.latitude, longitude: location.longitude },
      radiusM: location.radiusM,
      accuracyM: input.accuracyM,
    });

    if (!check.inside && (await this.orgs.geofencePolicy()) === 'reject') {
      throw new AppException(
        422,
        errorCodes.attendanceOutsideGeofence,
        `You are ${check.distanceM} m from ${location.name}. Clock in within ${location.radiusM} m of it.`,
      );
    }

    const row = await this.insertPunch({
      employeeId: employee.id,
      locationId: location.id,
      shiftId,
      clockInAt: deviceTime,
      deviceTime,
      method: input.method ?? 'gps',
      inLatitude: input.latitude,
      inLongitude: input.longitude,
      inAccuracyM: input.accuracyM,
      inDistanceM: check.distanceM,
      flags: uniqueFlags([...check.flags, ...deviceSkewFlag(deviceTime, receivedAt)]),
      clientEventId: key,
    });

    await this.audit.record({
      action: 'attendance.clock_in',
      entity: 'time_entry',
      entityId: row.id,
      after: {
        employeeId: row.employeeId,
        locationId: row.locationId,
        shiftId: row.shiftId,
        clockInAt: row.clockInAt.toISOString(),
        distanceM: row.inDistanceM,
        accuracyM: row.inAccuracyM,
        flags: row.flags,
      },
    });

    return { entry: await this.entryView(row, location), created: true };
  }

  async clockOut(input: ClockOutRequest): Promise<ClockResult> {
    const employee = await this.requireEmployee();
    const open = await this.entries.findOpen(employee.id);
    if (!open) {
      throw new AppException(
        409,
        errorCodes.attendanceNoOpenEntry,
        'You are not clocked in, so there is nothing to close.',
      );
    }
    const location = await this.locations.findById(open.locationId);
    if (!location) throw new AppException(404, errorCodes.locationNotFound, 'No such location.');

    const receivedAt = new Date();
    const at = input.at ? new Date(input.at) : receivedAt;
    if (at.getTime() <= open.clockInAt.getTime()) {
      throw new AppException(
        400,
        errorCodes.validationFailed,
        'The clock-out must be after the clock-in.',
      );
    }

    const hasPosition =
      input.latitude !== undefined &&
      input.longitude !== undefined &&
      input.accuracyM !== undefined;
    const check = hasPosition
      ? checkGeofence({
          from: { latitude: input.latitude!, longitude: input.longitude! },
          to: { latitude: location.latitude, longitude: location.longitude },
          radiusM: location.radiusM,
          accuracyM: input.accuracyM!,
        })
      : null;

    const row = await this.entries.close(open.id, {
      clockOutAt: at,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM: input.accuracyM,
      distanceM: check?.distanceM,
      flags: uniqueFlags([
        // Keep what the clock-in found; add what this punch found.
        ...(open.flags as GeofenceFlag[]),
        ...(check?.flags ?? []),
        ...deviceSkewFlag(at, receivedAt),
      ]),
    });
    if (!row) {
      throw new AppException(
        409,
        errorCodes.attendanceNoOpenEntry,
        'That punch was closed by someone else in the meantime.',
      );
    }

    await this.audit.record({
      action: 'attendance.clock_out',
      entity: 'time_entry',
      entityId: row.id,
      before: { clockOutAt: null, flags: open.flags },
      after: {
        clockOutAt: row.clockOutAt?.toISOString() ?? null,
        distanceM: row.outDistanceM,
        flags: row.flags,
      },
    });

    return { entry: await this.entryView(row, location), created: false };
  }

  /**
   * The caller's own punches. The range is applied per row, in the wall clock of the location
   * it happened at, so a person who works in two time zones sees the days they asked for.
   */
  async listMine(query: MyTimeEntriesQuery): Promise<MyTimeEntries> {
    const employee = await this.employees.findByUserId(this.context.userId);
    if (!employee) return { items: [] };

    const { from, to } = windowOf(query.from, query.to);
    const rows = await this.entries.forEmployee(employee.id, from, to);
    if (rows.length === 0) return { items: [] };

    const [byLocation, grace, shiftById] = await Promise.all([
      this.locations.findByIds([...new Set(rows.map((row) => row.locationId))]),
      this.orgs.attendanceGraceMinutes(),
      this.shiftsById(rows),
    ]);
    const locationById = new Map(byLocation.map((location) => [location.id, location]));

    const items = rows
      .flatMap((row) => {
        const location = locationById.get(row.locationId);
        if (!location) return [];
        const entry = this.toEntry(row, location, shiftById.get(row.shiftId ?? '') ?? null, grace);
        if (entry.date < query.from || entry.date > query.to) return [];
        return [entry];
      })
      .sort((a, b) => b.clockInAt.localeCompare(a.clockInAt));

    return { items };
  }

  /**
   * A manager's correction of one punch, with a reason that goes into the audit trail.
   *
   * Times are corrected, never deleted: reopening a punch is allowed (someone forgot to clock
   * out) but two open punches for one person are not, so that case is a 409 rather than a
   * constraint violation. A punch longer than a day is a typo, not a shift.
   */
  async updateEntry(id: string, body: UpdateTimeEntryRequest): Promise<TimeEntryWithEdits> {
    const row = await this.entries.findById(id);
    if (!row) throw timeEntryNotFound();
    // Scope first: a manager outside this location must not learn that the punch exists.
    const location = await this.access.assertAccess(row.locationId);

    const zone = location.timezone;
    const current = toLocal(row.clockInAt, zone);
    const day = body.date ?? current.date;
    const inTime = body.clockInTime ?? current.time;
    const clockInAt = toInstant(day, inTime, zone);
    // A punch in an approved pay period has been paid: neither its old day nor its new one may
    // change under the payroll that was computed from it.
    await this.payLocks.assertDatesOpen([current.date, day]);

    // "Out at 06:00" after starting at 22:00 means the next morning, not minus sixteen hours.
    const outDay = body.clockOutTime && body.clockOutTime < inTime ? addDays(day, 1) : day;
    let clockOutAt: Date | null;
    if (body.clockOutTime === null) clockOutAt = null;
    else if (body.clockOutTime !== undefined)
      clockOutAt = toInstant(outDay, body.clockOutTime, zone);
    else if (row.clockOutAt)
      clockOutAt = toInstant(outDay, toLocal(row.clockOutAt, zone).time, zone);
    else clockOutAt = null;

    if (clockOutAt && clockOutAt.getTime() <= clockInAt.getTime()) {
      throw new AppException(
        400,
        errorCodes.validationFailed,
        'The clock-out must be after the clock-in.',
      );
    }
    if (clockOutAt && clockOutAt.getTime() - clockInAt.getTime() > MAX_PUNCH_MS) {
      throw new AppException(
        400,
        errorCodes.validationFailed,
        'That punch would last more than 16 hours — check the times.',
      );
    }
    if (clockOutAt === null) {
      const open = await this.entries.findOpen(row.employeeId);
      if (open && open.id !== id) {
        throw new AppException(
          409,
          errorCodes.attendanceAlreadyClockedIn,
          'This person already has an open punch, so this one cannot be reopened.',
        );
      }
    }

    const updated = await this.entries.update(id, { clockInAt, clockOutAt });
    if (!updated) throw timeEntryNotFound();

    await this.audit.record({
      action: 'attendance.edited',
      entity: 'time_entry',
      entityId: id,
      before: {
        clockInAt: row.clockInAt.toISOString(),
        clockOutAt: row.clockOutAt?.toISOString() ?? null,
      },
      after: {
        clockInAt: updated.clockInAt.toISOString(),
        clockOutAt: updated.clockOutAt?.toISOString() ?? null,
        reason: body.reason,
      },
    });

    return this.detail(id);
  }

  /**
   * The punches waiting for a decision: flagged by the geofence, the GPS accuracy or the clock,
   * and not yet answered. A queue rather than a badge, because "12 flagged" is not actionable
   * and "Asha was 340 m away at 09:02" is.
   */
  async flagged(query: AttendanceQuery): Promise<Attendance> {
    const location = await this.access.assertAccess(query.locationId);
    const { from, to } = windowOf(query.from, query.to);

    const rows = await this.entries.flagged(location.id, from, to);
    if (rows.length === 0) {
      return {
        locationId: location.id,
        locationName: location.name,
        from: query.from,
        to: query.to,
        items: [],
        totals: [],
      };
    }

    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const [employees, shiftById, grace] = await Promise.all([
      this.employees.findMany(employeeIds),
      this.shiftsById(rows),
      this.orgs.attendanceGraceMinutes(),
    ]);

    const items: AttendanceRow[] = rows.flatMap((row) => {
      const entry = this.toEntry(row, location, shiftById.get(row.shiftId ?? '') ?? null, grace);
      if (entry.date < query.from || entry.date > query.to) return [];
      return [{ ...entry, employeeName: employees.get(row.employeeId)?.name ?? 'Former employee' }];
    });

    return {
      locationId: location.id,
      locationName: location.name,
      from: query.from,
      to: query.to,
      items,
      totals: [],
    };
  }

  /**
   * Answers one flagged punch. The decision is not a correction — the times stay as recorded —
   * so a dispute is the manager saying "I do not accept this as attendance" while the punch, and
   * the argument for it, stay on the record for the conversation that follows.
   */
  async review(id: string, body: ReviewTimeEntryRequest): Promise<TimeEntryWithEdits> {
    const row = await this.entries.findById(id);
    if (!row) throw timeEntryNotFound();
    await this.access.assertAccess(row.locationId);

    if (row.reviewedAt) {
      throw new AppException(
        409,
        errorCodes.validationFailed,
        'This punch has already been reviewed.',
      );
    }

    const updated = await this.entries.review(id, {
      decision: body.decision,
      by: this.context.userId,
      note: body.note ?? null,
      at: new Date(),
    });
    if (!updated) throw timeEntryNotFound();

    await this.audit.record({
      action: 'attendance.reviewed',
      entity: 'time_entry',
      entityId: id,
      before: { decision: null, note: null, flags: row.flags },
      after: { decision: body.decision, note: body.note ?? null, flags: row.flags },
    });

    return this.detail(id);
  }

  /** One punch with its corrections, for the manager who is about to change it again. */
  async detail(id: string): Promise<TimeEntryWithEdits> {
    const row = await this.entries.findById(id);
    if (!row) throw timeEntryNotFound();
    const location = await this.access.assertAccess(row.locationId);
    const [shiftById, grace, employees, history] = await Promise.all([
      this.shiftsById([row]),
      this.orgs.attendanceGraceMinutes(),
      this.employees.findMany([row.employeeId]),
      this.audit.history('time_entry', id),
    ]);

    const entry = this.toEntry(row, location, shiftById.get(row.shiftId ?? '') ?? null, grace);
    return {
      entry: { ...entry, employeeName: employees.get(row.employeeId)?.name ?? 'Former employee' },
      edits: history
        .filter((item) => item.action === 'attendance.edited')
        .map((item) => {
          const before = (item.before ?? {}) as Record<string, unknown>;
          const after = (item.after ?? {}) as Record<string, unknown>;
          return {
            at: item.at,
            by: item.by,
            reason: typeof after.reason === 'string' ? after.reason : null,
            before: {
              clockInAt: typeof before.clockInAt === 'string' ? before.clockInAt : null,
              clockOutAt: typeof before.clockOutAt === 'string' ? before.clockOutAt : null,
            },
            after: {
              clockInAt: typeof after.clockInAt === 'string' ? after.clockInAt : null,
              clockOutAt: typeof after.clockOutAt === 'string' ? after.clockOutAt : null,
            },
          };
        }),
    };
  }

  /**
   * A manager's view of one location over a range: who punched, against which shift, how late,
   * and what it adds up to. Scoped by `LocationAccess` like every other location read.
   */
  async listForLocation(query: AttendanceQuery): Promise<Attendance> {
    const location = await this.access.assertAccess(query.locationId);
    const { from, to } = windowOf(query.from, query.to);

    const rows = await this.entries.forLocation(location.id, from, to);
    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const [employees, assigned, grace] = await Promise.all([
      this.employees.findMany(employeeIds),
      this.shifts.assignedIn(employeeIds, from, to),
      this.orgs.attendanceGraceMinutes(),
    ]);
    const shiftById = new Map(assigned.map((shift) => [shift.id, shift]));

    const items: AttendanceRow[] = rows
      .flatMap((row) => {
        const entry = this.toEntry(row, location, shiftById.get(row.shiftId ?? '') ?? null, grace);
        if (entry.date < query.from || entry.date > query.to) return [];
        return [
          { ...entry, employeeName: employees.get(row.employeeId)?.name ?? 'Former employee' },
        ];
      })
      .sort((a, b) => a.clockInAt.localeCompare(b.clockInAt));

    return {
      locationId: location.id,
      locationName: location.name,
      from: query.from,
      to: query.to,
      items,
      totals: totalsOf(items, assigned),
    };
  }

  // --------------------------------------------------------------------------- helpers

  /** The shift this punch most plausibly belongs to, or null when nobody was rostered. */
  private async matchShiftId(employeeId: string, at: Date, grace: number): Promise<string | null> {
    const around = await this.shifts.shiftsAround(employeeId, at);
    return matchShift(at, around, grace).shift?.id ?? null;
  }

  /** One punch with its shift and derived lateness. */
  private async entryView(row: TimeEntryRow, location: LocationRecord): Promise<TimeEntry> {
    const [shiftById, grace] = await Promise.all([
      this.shiftsById([row]),
      this.orgs.attendanceGraceMinutes(),
    ]);
    return this.toEntry(row, location, shiftById.get(row.shiftId ?? '') ?? null, grace);
  }

  /** The shifts behind a set of punches, fetched in one query. */
  private async shiftsById(rows: TimeEntryRow[]): Promise<Map<string, ShiftRecord>> {
    const ids = new Set(rows.map((row) => row.shiftId).filter((id): id is string => id !== null));
    if (ids.size === 0) return new Map();

    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const span = rows.reduce(
      (acc, row) => {
        const start = row.clockInAt.getTime();
        const end = row.clockOutAt?.getTime() ?? start;
        return {
          from: Math.min(acc.from, start - 2 * 60 * 60 * 1000),
          to: Math.max(acc.to, end + 2 * 60 * 60 * 1000),
        };
      },
      { from: Number.POSITIVE_INFINITY, to: Number.NEGATIVE_INFINITY },
    );

    const shifts = await this.shifts.assignedIn(
      employeeIds,
      new Date(span.from),
      new Date(span.to),
    );
    return new Map(shifts.filter((shift) => ids.has(shift.id)).map((shift) => [shift.id, shift]));
  }

  /**
   * Inserts the punch. A unique violation here would abort the transaction, so the recovery is a
   * plain 409 — the advisory lock taken above is what makes this unreachable in practice.
   */
  private async insertPunch(
    values: Parameters<TimeEntriesRepository['create']>[0],
  ): Promise<TimeEntryRow> {
    try {
      return await this.entries.create(values);
    } catch (error) {
      if (uniqueViolation(error) === null) throw error;
      throw new AppException(
        409,
        errorCodes.attendanceAlreadyClockedIn,
        'You are already clocked in — clock out before starting another shift.',
      );
    }
  }

  private async requireEmployee(): Promise<EmployeeRecord> {
    const employee = await this.employees.findByUserId(this.context.userId);
    if (!employee) throw notLinked();
    if (employee.status === 'archived') {
      throw new AppException(
        403,
        errorCodes.employeeArchived,
        'Your staff profile is archived, so you cannot clock in.',
      );
    }
    return employee;
  }

  /** One punch in the location's own wall clock; `minutes` keeps counting while it is open. */
  private toEntry(
    row: TimeEntryRow,
    location: LocationRecord,
    shift: ShiftRecord | null,
    graceMinutes: number,
  ): TimeEntry {
    const start = toLocal(row.clockInAt, location.timezone);
    const end = row.clockOutAt ? toLocal(row.clockOutAt, location.timezone) : null;
    const until = row.clockOutAt ?? new Date();
    const against = shift ? matchShift(row.clockInAt, [shift], graceMinutes) : null;

    return {
      id: row.id,
      employeeId: row.employeeId,
      locationId: row.locationId,
      locationName: location.name,
      shiftId: row.shiftId,
      shift: shift
        ? {
            id: shift.id,
            startTime: toLocal(shift.startsAt, location.timezone).time,
            endTime: toLocal(shift.endsAt, location.timezone).time,
          }
        : null,
      clockInAt: row.clockInAt.toISOString(),
      clockOutAt: row.clockOutAt?.toISOString() ?? null,
      date: start.date,
      clockInTime: start.time,
      clockOutTime: end?.time ?? null,
      minutes: Math.max(0, Math.round((until.getTime() - row.clockInAt.getTime()) / 60_000)),
      method: row.method,
      distanceM: row.inDistanceM,
      accuracyM: row.inAccuracyM,
      flags: row.flags as TimeEntry['flags'],
      edited: row.edited,
      review: row.reviewDecision
        ? {
            decision: row.reviewDecision,
            at: row.reviewedAt?.toISOString() ?? '',
            by: row.reviewedBy,
            note: row.reviewNote,
          }
        : null,
      lateMinutes: against?.lateMinutes ?? 0,
      earlyMinutes: against?.earlyMinutes ?? 0,
      state: against?.state ?? 'unscheduled',
    };
  }

  /** Open, unreviewed-flagged and disputed punches in a pay period (payroll's readiness). */
  periodReadiness(startsOn: string, endsOn: string) {
    return this.entries.periodReadiness(startsOn, endsOn);
  }
}

/** The SQL window for a local-date range: a day wider at each end, then filtered per row. */
function windowOf(fromDate: string, toDate: string): { from: Date; to: Date } {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  to.setUTCDate(to.getUTCDate() + 2);
  return { from, to };
}

/** Worked and rostered minutes per person: what a timesheet adds up. */
function totalsOf(items: AttendanceRow[], assigned: ShiftRecord[]): Attendance['totals'] {
  const totals = new Map<string, Attendance['totals'][number]>();

  for (const item of items) {
    const row = totals.get(item.employeeId) ?? {
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      workedMinutes: 0,
      plannedMinutes: 0,
    };
    row.workedMinutes += countedMinutes(item);
    totals.set(item.employeeId, row);
  }

  for (const shift of assigned) {
    if (!shift.employeeId) continue;
    const row = totals.get(shift.employeeId);
    if (!row) continue;
    row.plannedMinutes += Math.max(
      0,
      Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000),
    );
  }

  return [...totals.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/**
 * How much of a punch counts towards the week.
 *
 * A closed punch counts as itself. An **open** one counts at most its rostered length: a
 * forgotten clock-out must not turn three days into seventy-seven hours of overtime. The row
 * still says "open", and the manager has a correction (or a dispute) to make — that is the
 * decision this refuses to make for them. An open punch with no rostered shift counts nothing
 * until someone says what it was.
 */
function countedMinutes(item: AttendanceRow): number {
  if (item.clockOutAt !== null) return item.minutes;
  if (!item.shift) return 0;
  return Math.min(item.minutes, nominalMinutes(item.shift.startTime, item.shift.endTime));
}

/** The same flag twice (outside the fence at both ends) is one fact. */
function uniqueFlags(flags: GeofenceFlag[]): GeofenceFlag[] {
  return [...new Set(flags)];
}
