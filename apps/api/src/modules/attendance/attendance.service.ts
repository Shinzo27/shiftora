import { Injectable } from '@nestjs/common';
import { checkGeofence, deviceSkewFlag, toLocal, type GeofenceFlag } from '@shiftora/domain';
import { newId } from '@shiftora/db';
import {
  errorCodes,
  type ClockInRequest,
  type ClockOutRequest,
  type ClockResult,
  type MyTimeEntries,
  type MyTimeEntriesQuery,
  type TimeEntry,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { uniqueViolation } from '../../common/db-errors.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { EmployeeRecord } from '../employees/employees.repository.js';
import { LocationsRepository, type LocationRecord } from '../locations/locations.repository.js';
import { OrgsRepository } from '../orgs/orgs.repository.js';
import { ShiftsService } from '../scheduling/shifts.service.js';
import { TimeEntriesRepository, type TimeEntryRow } from './time-entries.repository.js';

const notLinked = () =>
  new AppException(
    403,
    errorCodes.attendanceNotLinked,
    'This login is not linked to a staff profile, so there is nothing to clock in as.',
  );

/**
 * Clocking in and out.
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
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly entries: TimeEntriesRepository,
    private readonly employees: EmployeesService,
    private readonly locations: LocationsRepository,
    private readonly orgs: OrgsRepository,
    private readonly shifts: ShiftsService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
  ) {}

  async clockIn(input: ClockInRequest, idempotencyKey?: string): Promise<ClockResult> {
    const employee = await this.requireEmployee();
    const location = await this.locations.findById(input.locationId);
    if (!location) throw new AppException(404, errorCodes.locationNotFound, 'No such location.');

    // A retry of a punch already stored: answer with that row instead of refusing a duplicate.
    const key = idempotencyKey ?? newId();
    const existing = await this.entries.findByClientEventId(key);
    if (existing) return { entry: this.toEntry(existing, location), created: false };

    if (input.shiftId) {
      await this.shifts.assertPunchable(input.shiftId, employee.id, location.id);
    }

    const open = await this.entries.findOpen(employee.id);
    if (open) {
      throw new AppException(
        409,
        errorCodes.attendanceAlreadyClockedIn,
        'You are already clocked in — clock out before starting another shift.',
      );
    }

    const receivedAt = new Date();
    const deviceTime = input.at ? new Date(input.at) : receivedAt;
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

    const row = await this.createOrExplain({
      employeeId: employee.id,
      locationId: location.id,
      shiftId: input.shiftId ?? null,
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
    if (!row) {
      // Lost a race: either the same key was inserted twice (idempotent — answer with it), or
      // another punch opened at the same moment.
      const raced = await this.entries.findByClientEventId(key);
      if (raced) return { entry: this.toEntry(raced, location), created: false };
      throw new AppException(
        409,
        errorCodes.attendanceAlreadyClockedIn,
        'You are already clocked in — clock out before starting another shift.',
      );
    }

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

    return { entry: this.toEntry(row, location), created: true };
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

    return { entry: this.toEntry(row, location), created: false };
  }

  /**
   * The caller's own punches. The range is applied per row, in the wall clock of the location
   * it happened at, so a person who works in two time zones sees the days they asked for.
   */
  async listMine(query: MyTimeEntriesQuery): Promise<MyTimeEntries> {
    const employee = await this.employees.findByUserId(this.context.userId);
    if (!employee) return { items: [] };

    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    to.setUTCDate(to.getUTCDate() + 2);

    const rows = await this.entries.forEmployee(employee.id, from, to);
    if (rows.length === 0) return { items: [] };

    const locations = await this.locations.findByIds([
      ...new Set(rows.map((row) => row.locationId)),
    ]);
    const byId = new Map(locations.map((location) => [location.id, location]));

    const items = rows
      .flatMap((row) => {
        const location = byId.get(row.locationId);
        if (!location) return [];
        const entry = this.toEntry(row, location);
        if (entry.date < query.from || entry.date > query.to) return [];
        return [entry];
      })
      .sort((a, b) => b.clockInAt.localeCompare(a.clockInAt));

    return { items };
  }

  // --------------------------------------------------------------------------- helpers

  /**
   * Inserts the punch, or returns null when a unique index says it already exists.
   *
   * Two indexes can refuse the row and they mean different things: `one_open` is "you are
   * already clocked in", `client_event_unique` is "this is the same punch twice". The caller
   * re-reads by key to tell them apart, because a concurrent retry is a success, not an error.
   */
  private async createOrExplain(
    values: Parameters<TimeEntriesRepository['create']>[0],
  ): Promise<TimeEntryRow | null> {
    try {
      return await this.entries.create(values);
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === null) throw error;
      if (
        constraint === 'time_entries_client_event_unique' ||
        constraint === 'time_entries_one_open'
      ) {
        return null;
      }
      throw error;
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

  /** One punch in the caller's own wall clock; `minutes` keeps counting while it is open. */
  private toEntry(row: TimeEntryRow, location: LocationRecord): TimeEntry {
    const start = toLocal(row.clockInAt, location.timezone);
    const end = row.clockOutAt ? toLocal(row.clockOutAt, location.timezone) : null;
    const until = row.clockOutAt ?? new Date();

    return {
      id: row.id,
      employeeId: row.employeeId,
      locationId: row.locationId,
      locationName: location.name,
      shiftId: row.shiftId,
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
    };
  }
}

/** The same flag twice (outside the fence at both ends) is one fact. */
function uniqueFlags(flags: GeofenceFlag[]): GeofenceFlag[] {
  return [...new Set(flags)];
}
