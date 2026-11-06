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
  type Shift,
  type ShiftWriteResult,
  type UpdateShiftRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isExclusionViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService } from '../employees/availability.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import type { LocationRecord } from '../locations/locations.repository.js';
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
    private readonly audit: AuditService,
  ) {}

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

  async remove(id: string): Promise<void> {
    const { row, location } = await this.findShift(id, { writable: true });
    await this.shifts.remove(id);
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
