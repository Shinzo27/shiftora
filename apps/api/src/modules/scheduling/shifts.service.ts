import { Injectable } from '@nestjs/common';
import {
  dayOfWeek,
  paidMinutes,
  shiftTimes,
  toLocal,
  validateShift,
  weekBounds,
  weekDates,
  type ShiftWarning,
} from '@shiftora/domain';
import {
  errorCodes,
  shiftTemplateIssue,
  type CreateShiftRequest,
  type ListShiftsQuery,
  type MyShifts,
  type MyShiftsQuery,
  type ScheduleConflicts,
  type Shift,
  type ShiftConflict,
  type ShiftWriteResult,
  type UpdateShiftRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isExclusionViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService } from '../employees/availability.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';
import { RequestContext } from '../../database/request-context.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { LocationRecord } from '../locations/locations.repository.js';
import type { OrgMember } from '../tenancy/member.js';
import { SchedulesRepository, type ScheduleRecord } from './schedules.repository.js';
import { ShiftsRepository, type ShiftRecord, type ShiftValues } from './shifts.repository.js';

/** The longest min-rest rule is two days, so this window always contains a neighbour. */
const REST_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const shiftNotFound = () => new AppException(404, errorCodes.shiftNotFound, 'No such shift.');
const scheduleNotFound = () =>
  new AppException(404, errorCodes.scheduleNotFound, 'No such schedule.');
const versionConflict = () =>
  new AppException(
    409,
    errorCodes.shiftVersionConflict,
    'This shift changed since you loaded it. Refresh and try again.',
  );

/** Postgres `time` is not involved here: instants are formatted in the location's zone. */
function toShift(row: ShiftRecord, timezone: string): Shift {
  const start = toLocal(row.startsAt, timezone);
  const end = toLocal(row.endsAt, timezone);
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    locationId: row.locationId,
    jobRoleId: row.jobRoleId,
    employeeId: row.employeeId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    breakMinutes: row.breakMinutes,
    paidMinutes: paidMinutes(row),
    status: row.status,
    version: row.version,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the audit log records: the shift's meaningful fields, no ids of related rows' names. */
function snapshot(shift: Shift): Record<string, unknown> {
  return {
    scheduleId: shift.scheduleId,
    locationId: shift.locationId,
    employeeId: shift.employeeId,
    jobRoleId: shift.jobRoleId,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    breakMinutes: shift.breakMinutes,
    status: shift.status,
  };
}

interface ShiftCheck {
  employeeId: string;
  candidate: { startsAt: Date; endsAt: Date; breakMinutes: number };
  local: { weekday: number; startTime: string; endTime: string };
  schedule: ScheduleRecord;
  location: LocationRecord;
  /** The shift being edited, so it doesn't conflict with itself. */
  ignoreShiftId?: string;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly shifts: ShiftsRepository,
    private readonly schedules: SchedulesRepository,
    private readonly access: LocationAccess,
    private readonly employees: EmployeesService,
    private readonly availability: AvailabilityService,
    private readonly jobRoles: JobRolesService,
    private readonly locations: LocationsRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly context: RequestContext,
  ) {}

  /**
   * The caller's own shifts, for the phone app.
   *
   * The range is given in local dates and applied **per shift**: each row is turned into the
   * wall clock of its own location before its date is compared, so a person who works across
   * two time zones sees exactly the days they asked for. The SQL window is a day wider at each
   * end to make that exact rather than lucky.
   *
   * No location-scope check: these are shifts already assigned to the caller.
   */
  /**
   * Attendance's one question: is this shift really this employee's, at this location?
   * Answered as 404 (not 400) so a punch cannot be used to probe which shift ids exist.
   */
  async assertPunchable(shiftId: string, employeeId: string, locationId: string): Promise<void> {
    const row = await this.shifts.findById(shiftId);
    if (!row || row.employeeId !== employeeId || row.locationId !== locationId) {
      throw shiftNotFound();
    }
  }

  async listMine(member: OrgMember, query: MyShiftsQuery): Promise<MyShifts> {
    const employee = await this.employees.findByUserId(member.userId);
    if (!employee) return { items: [] };

    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    to.setUTCDate(to.getUTCDate() + 2);

    const rows = await this.shifts.forEmployee(employee.id, from, to);
    if (rows.length === 0) return { items: [] };

    const [locations, roles] = await Promise.all([
      this.locations.findByIds([...new Set(rows.map((row) => row.locationId))]),
      this.jobRoles.list(),
    ]);
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const roleName = new Map(roles.map((role) => [role.id, role.name]));

    const items = rows
      .map((row) => {
        const location = locationById.get(row.locationId);
        if (!location) return null;
        const shift = toShift(row, location.timezone);
        if (shift.date < query.from || shift.date > query.to) return null;
        return {
          ...shift,
          locationName: location.name,
          locationTimezone: location.timezone,
          jobRoleName: row.jobRoleId ? (roleName.get(row.jobRoleId) ?? null) : null,
        };
      })
      .filter((item) => item !== null);

    return { items: items.sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
  }

  /** Other screens looking at this week should refetch (the write has landed by now). */
  private announce(schedule: ScheduleRecord, locationId: string): void {
    this.realtime.scheduleChanged({
      orgId: this.context.orgId,
      scheduleId: schedule.id,
      locationId,
      weekStart: schedule.weekStart,
      kind: 'shifts',
    });
  }

  async list(query: ListShiftsQuery): Promise<Shift[]> {
    const schedule = await this.findSchedule(query.scheduleId);
    const location = await this.access.assertAccess(schedule.locationId);
    const rows = await this.shifts.listBySchedule(schedule.id);
    return rows.map((row) => toShift(row, location.timezone));
  }

  async get(id: string): Promise<Shift> {
    const { row, location } = await this.findShift(id);
    return toShift(row, location.timezone);
  }

  /**
   * Places a shift on a week. Overlap is refused (the database refuses it too); availability,
   * time off, weekly hours and rest come back as warnings for the manager to weigh up.
   */
  async create(body: CreateShiftRequest): Promise<ShiftWriteResult> {
    const schedule = await this.findSchedule(body.scheduleId);
    const location = await this.writableLocation(schedule.locationId);
    this.assertInWeek(body.date, schedule);

    const times = shiftTimes(body.date, body.startTime, body.endTime, location.timezone);
    if (body.jobRoleId) await this.jobRoles.assertAllExist([body.jobRoleId]);

    const employeeId = body.employeeId ?? null;
    const warnings = employeeId
      ? await this.check({
          employeeId,
          candidate: { ...times, breakMinutes: body.breakMinutes },
          local: {
            weekday: dayOfWeek(body.date),
            startTime: body.startTime,
            endTime: body.endTime,
          },
          schedule,
          location,
        })
      : [];
    this.assertNoOverlap(warnings);

    const values: ShiftValues = {
      scheduleId: schedule.id,
      locationId: location.id,
      jobRoleId: body.jobRoleId ?? null,
      employeeId,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      breakMinutes: body.breakMinutes,
      status: employeeId ? 'assigned' : 'open',
      notes: body.notes ?? null,
    };
    const row = await this.write(() => this.shifts.create(values));
    await this.schedules.touch(schedule.id);
    this.announce(schedule, location.id);
    const created = toShift(row, location.timezone);
    await this.audit.record({
      action: 'shift.created',
      entity: 'shift',
      entityId: row.id,
      after: snapshot(created),
    });
    return { shift: created, warnings };
  }

  async update(id: string, body: UpdateShiftRequest): Promise<ShiftWriteResult> {
    const { row: current, schedule, location } = await this.findShift(id, { writable: true });
    if (body.version !== undefined && body.version !== current.version) throw versionConflict();

    const before = toShift(current, location.timezone);
    const date = body.date ?? before.date;
    const startTime = body.startTime ?? before.startTime;
    const endTime = body.endTime ?? before.endTime;
    const breakMinutes = body.breakMinutes ?? current.breakMinutes;
    const employeeId = body.employeeId === undefined ? current.employeeId : body.employeeId;
    const jobRoleId = body.jobRoleId === undefined ? current.jobRoleId : body.jobRoleId;

    // Changing one end can make the stored break too long, so check the merged result.
    const issue = shiftTemplateIssue(startTime, endTime, breakMinutes);
    if (issue) {
      throw new AppException(400, errorCodes.validationFailed, 'The request is invalid.', [issue]);
    }
    this.assertInWeek(date, schedule);
    if (jobRoleId && jobRoleId !== current.jobRoleId) {
      await this.jobRoles.assertAllExist([jobRoleId]);
    }

    const times = shiftTimes(date, startTime, endTime, location.timezone);
    const warnings = employeeId
      ? await this.check({
          employeeId,
          candidate: { ...times, breakMinutes },
          local: { weekday: dayOfWeek(date), startTime, endTime },
          schedule,
          location,
          ignoreShiftId: id,
        })
      : [];
    this.assertNoOverlap(warnings);

    const values: Partial<ShiftValues> = {
      jobRoleId,
      employeeId,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      breakMinutes,
      // An open shift has nobody on it; assigning someone makes it theirs. (Cancelling and
      // the swap/claim flows arrive in W5.)
      status: employeeId ? 'assigned' : 'open',
      notes: body.notes === undefined ? current.notes : body.notes,
    };
    const row = await this.write(() => this.shifts.update(id, current.version, values));
    if (!row) throw versionConflict();
    await this.schedules.touch(schedule.id);
    this.announce(schedule, location.id);

    const updated = toShift(row, location.timezone);
    await this.audit.record({
      action: 'shift.updated',
      entity: 'shift',
      entityId: id,
      before: snapshot(before),
      after: snapshot(updated),
    });
    return { shift: updated, warnings };
  }

  /**
   * Every advisory on the week's assigned shifts, in one request and a handful of queries
   * (availability, time off and other shifts are fetched for all the week's employees at
   * once). Used by the board to badge shifts; the same pure checks run on every write.
   *
   * Overlap cannot exist between stored shifts (the exclusion constraint refuses it), but if
   * it ever did it would be reported here like any other warning.
   */
  async conflicts(scheduleId: string): Promise<ScheduleConflicts> {
    const schedule = await this.findSchedule(scheduleId);
    const location = await this.access.assertAccess(schedule.locationId);
    const rows = await this.shifts.listBySchedule(schedule.id);
    const assigned = rows.filter((row) => row.employeeId !== null && row.status !== 'cancelled');
    if (assigned.length === 0) return { scheduleId: schedule.id, conflicts: [] };

    const employeeIds = [...new Set(assigned.map((row) => row.employeeId!))];
    const week = weekBounds(schedule.weekStart, location.timezone);
    const window = {
      start: new Date(week.start.getTime() - REST_WINDOW_MS),
      end: new Date(week.end.getTime() + REST_WINDOW_MS),
    };
    const [employees, availability, timeOff, otherShifts] = await Promise.all([
      this.employees.findMany(employeeIds),
      this.availability.slotsFor(employeeIds),
      this.availability.timeOffFor(employeeIds, window.start, window.end),
      this.shifts.forEmployees(employeeIds, window.start, window.end),
    ]);

    const byEmployee = new Map<string, ShiftRecord[]>();
    for (const row of otherShifts) {
      if (!row.employeeId) continue;
      const own = byEmployee.get(row.employeeId) ?? [];
      own.push(row);
      byEmployee.set(row.employeeId, own);
    }

    const conflicts: ShiftConflict[] = [];
    for (const row of assigned) {
      const employee = employees.get(row.employeeId!);
      if (!employee) continue; // outside the org's current data: nothing to check against
      const start = toLocal(row.startsAt, location.timezone);
      const end = toLocal(row.endsAt, location.timezone);
      const warnings = validateShift({
        candidate: {
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          breakMinutes: row.breakMinutes,
          weekday: dayOfWeek(start.date),
          startTime: start.time,
          endTime: end.time,
        },
        timezone: location.timezone,
        week,
        availability: availability.get(row.employeeId!) ?? [],
        timeOff: timeOff.get(row.employeeId!) ?? [],
        otherShifts: (byEmployee.get(row.employeeId!) ?? []).filter((other) => other.id !== row.id),
        maxWeeklyMinutes: employee.maxWeeklyMinutes,
        minRestMinutes: employee.minRestMinutes,
      });
      if (warnings.length > 0) conflicts.push({ shiftId: row.id, warnings });
    }
    return { scheduleId: schedule.id, conflicts };
  }

  async remove(id: string): Promise<void> {
    const { row, schedule, location } = await this.findShift(id, { writable: true });
    await this.shifts.remove(id);
    await this.schedules.touch(schedule.id);
    this.announce(schedule, location.id);
    await this.audit.record({
      action: 'shift.removed',
      entity: 'shift',
      entityId: id,
      before: snapshot(toShift(row, location.timezone)),
    });
  }

  // ------------------------------------------------------------------------- helpers

  private async findSchedule(scheduleId: string): Promise<ScheduleRecord> {
    const schedule = await this.schedules.findById(scheduleId);
    if (!schedule) throw scheduleNotFound();
    return schedule;
  }

  /** The shift, its schedule and location; 404 if any of them is outside the caller's scope. */
  private async findShift(
    id: string,
    { writable = false } = {},
  ): Promise<{ row: ShiftRecord; schedule: ScheduleRecord; location: LocationRecord }> {
    const row = await this.shifts.findById(id);
    if (!row) throw shiftNotFound();
    const schedule = await this.schedules.findById(row.scheduleId);
    if (!schedule) throw shiftNotFound();
    let location: LocationRecord;
    try {
      location = await this.access.assertAccess(row.locationId);
    } catch (error) {
      // A location outside the caller's scope must look like a shift that doesn't exist.
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw shiftNotFound();
      }
      throw error;
    }
    if (writable) this.access.assertWritable(location);
    return { row, schedule, location };
  }

  private async writableLocation(locationId: string): Promise<LocationRecord> {
    const location = await this.access.assertAccess(locationId);
    this.access.assertWritable(location);
    return location;
  }

  /** A shift belongs to one week: another date is another schedule. */
  private assertInWeek(date: string, schedule: ScheduleRecord): void {
    if (!weekDates(schedule.weekStart).includes(date)) {
      throw new AppException(400, errorCodes.validationFailed, 'The request is invalid.', [
        { path: 'date', message: 'The shift must be inside the schedule’s week' },
      ]);
    }
  }

  /**
   * Loads everything the pure checks need: the employee, their availability and time off, and
   * every shift they already have around this one (any location). One window for all three,
   * so the checks are a handful of indexed queries.
   */
  private async check(input: ShiftCheck): Promise<ShiftWarning[]> {
    const employee = await this.employees.findAccessible(input.employeeId);
    if (employee.status === 'archived') {
      throw new AppException(
        409,
        errorCodes.employeeArchived,
        'This employee is archived. Bring them back before scheduling them.',
      );
    }

    const week = weekBounds(input.schedule.weekStart, input.location.timezone);
    const window = {
      start: new Date(
        Math.min(week.start.getTime(), input.candidate.startsAt.getTime() - REST_WINDOW_MS),
      ),
      end: new Date(
        Math.max(week.end.getTime(), input.candidate.endsAt.getTime() + REST_WINDOW_MS),
      ),
    };
    const [availability, timeOff, others] = await Promise.all([
      this.availability.get(input.employeeId),
      this.availability.listTimeOff(input.employeeId, {
        from: window.start.toISOString(),
        to: window.end.toISOString(),
      }),
      this.shifts.forEmployee(input.employeeId, window.start, window.end),
    ]);

    return validateShift({
      candidate: {
        ...input.candidate,
        weekday: input.local.weekday,
        startTime: input.local.startTime,
        endTime: input.local.endTime,
      },
      timezone: input.location.timezone,
      week,
      availability: availability.slots,
      timeOff: timeOff.map((period) => ({
        id: period.id,
        startsAt: new Date(period.startsAt),
        endsAt: new Date(period.endsAt),
      })),
      otherShifts: others.filter((shift) => shift.id !== input.ignoreShiftId),
      maxWeeklyMinutes: employee.maxWeeklyMinutes,
      minRestMinutes: employee.minRestMinutes,
    });
  }

  /** Overlap is the one constraint the manager cannot talk their way past. */
  private assertNoOverlap(warnings: ShiftWarning[]): void {
    const overlap = warnings.find((warning) => warning.code === 'overlap');
    if (overlap) {
      throw new AppException(
        409,
        errorCodes.shiftOverlap,
        `${overlap.message}. Move one of the shifts first.`,
      );
    }
  }

  /**
   * Writes, turning the database's own refusal into the same 409 the pre-check gives. The
   * constraint still matters: two requests can pass the check at the same moment.
   */
  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new AppException(
          409,
          errorCodes.shiftOverlap,
          'This employee is already working at that time.',
        );
      }
      throw error;
    }
  }
}
