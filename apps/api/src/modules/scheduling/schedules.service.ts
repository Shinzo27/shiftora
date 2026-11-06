import { Injectable } from '@nestjs/common';
import { weekBounds } from '@shiftora/domain';
import {
  errorCodes,
  type CreateScheduleRequest,
  type ListSchedulesQuery,
  type Schedule,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { SchedulesRepository, type ScheduleRecord } from './schedules.repository.js';

/** The week's real start and end come from the location's zone (167–169 h around DST). */
function toSchedule(row: ScheduleRecord, timezone: string): Schedule {
  const week = weekBounds(row.weekStart, timezone);
  return {
    id: row.id,
    locationId: row.locationId,
    weekStart: row.weekStart,
    status: row.status,
    version: row.version,
    timezone,
    startsAt: week.start.toISOString(),
    endsAt: week.end.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = () => new AppException(404, errorCodes.scheduleNotFound, 'No such schedule.');

@Injectable()
export class SchedulesService {
  constructor(
    private readonly schedules: SchedulesRepository,
    private readonly access: LocationAccess,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListSchedulesQuery): Promise<Schedule[]> {
    const location = await this.access.assertAccess(query.locationId);
    const rows = await this.schedules.list(query.locationId, query.weekStart);
    return rows.map((row) => toSchedule(row, location.timezone));
  }

  async get(id: string): Promise<Schedule> {
    const row = await this.schedules.findById(id);
    if (!row) throw notFound();
    try {
      const location = await this.access.assertAccess(row.locationId);
      return toSchedule(row, location.timezone);
    } catch (error) {
      // Outside the caller's scope: answer as if the schedule didn't exist.
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw notFound();
      }
      throw error;
    }
  }

  /** Starts a draft for a location's week. One per week: a second create is a 409. */
  async create(body: CreateScheduleRequest): Promise<Schedule> {
    const location = await this.access.assertAccess(body.locationId);
    this.access.assertWritable(location);
    let row: ScheduleRecord;
    try {
      row = await this.schedules.create(body.locationId, body.weekStart);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          409,
          errorCodes.duplicate,
          'This location already has a schedule for that week.',
        );
      }
      throw error;
    }
    await this.audit.record({
      action: 'schedule.created',
      entity: 'schedule',
      entityId: row.id,
      after: { locationId: row.locationId, weekStart: row.weekStart, status: row.status },
    });
    return toSchedule(row, location.timezone);
  }
}
