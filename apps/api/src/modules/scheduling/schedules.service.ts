import { Injectable } from '@nestjs/common';
import { diffPublication, toLocal, weekBounds, type PublishedShift } from '@shiftora/domain';
import {
  errorCodes,
  type CreateScheduleRequest,
  type ListSchedulesQuery,
  type Publication,
  type PublicationDiff,
  type PublishPreview,
  type PublishResult,
  type Schedule,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import type { LocationRecord } from '../locations/locations.repository.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PublicationsRepository, type PublicationRecord } from './publications.repository.js';
import { SchedulesRepository, type ScheduleRecord } from './schedules.repository.js';
import { ShiftsRepository } from './shifts.repository.js';

/** The week's real start and end come from the location's zone (167–169 h around DST). */
function toSchedule(row: ScheduleRecord, timezone: string): Schedule {
  const week = weekBounds(row.weekStart, timezone);
  return {
    id: row.id,
    locationId: row.locationId,
    weekStart: row.weekStart,
    status: row.status,
    version: row.version,
    publishedVersion: row.publishedVersion,
    timezone,
    startsAt: week.start.toISOString(),
    endsAt: week.end.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPublication(row: PublicationRecord, diff: PublicationDiff): Publication {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    version: row.version,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedBy,
    diff,
  };
}

const notFound = () => new AppException(404, errorCodes.scheduleNotFound, 'No such schedule.');

@Injectable()
export class SchedulesService {
  constructor(
    private readonly schedules: SchedulesRepository,
    private readonly shifts: ShiftsRepository,
    private readonly publications: PublicationsRepository,
    private readonly outbox: OutboxService,
    private readonly context: RequestContext,
    private readonly access: LocationAccess,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(query: ListSchedulesQuery): Promise<Schedule[]> {
    const location = await this.access.assertAccess(query.locationId);
    const rows = await this.schedules.list(query.locationId, query.weekStart);
    return rows.map((row) => toSchedule(row, location.timezone));
  }

  async get(id: string): Promise<Schedule> {
    const { schedule, location } = await this.find(id);
    return toSchedule(schedule, location.timezone);
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

  /**
   * Sends the week to staff.
   *
   * One transaction does four things: bump the version, record what was published, write the
   * `schedule.published` outbox event (the worker notifies `affectedEmployeeIds` in W4), and
   * audit it. The diff is against the previous publication, so only people whose week really
   * changed hear about it — an unchanged shift is silent even when the week is sent again.
   */
  async publish(id: string): Promise<PublishResult> {
    const { schedule, location } = await this.find(id, { writable: true });
    const current = await this.snapshotOf(schedule, location.timezone);
    const previous = await this.publications.latest(schedule.id);
    const diff = diffPublication(previous?.shifts ?? [], current);

    const row = await this.schedules.publish(schedule.id, this.context.userId);
    if (!row) throw notFound();

    const publication = await this.publications.create({
      scheduleId: schedule.id,
      version: row.version,
      shifts: current,
      affectedEmployeeIds: diff.affectedEmployeeIds,
      publishedBy: this.context.userId,
    });
    await this.outbox.record('schedule.published', {
      scheduleId: schedule.id,
      locationId: location.id,
      weekStart: schedule.weekStart,
      publicationId: publication.id,
      version: row.version,
      affectedEmployeeIds: diff.affectedEmployeeIds,
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed.length,
    });
    await this.audit.record({
      action: 'schedule.published',
      entity: 'schedule',
      entityId: schedule.id,
      before: previous
        ? { version: previous.version, affected: previous.affectedEmployeeIds.length }
        : {},
      after: {
        version: row.version,
        added: diff.added.length,
        changed: diff.changed.length,
        removed: diff.removed.length,
        affected: diff.affectedEmployeeIds.length,
      },
    });
    this.realtime.scheduleChanged({
      orgId: this.context.orgId,
      scheduleId: schedule.id,
      locationId: location.id,
      weekStart: schedule.weekStart,
      kind: 'published',
    });
    return {
      schedule: toSchedule(row, location.timezone),
      publication: toPublication(publication, diff),
    };
  }

  /** The same diff, without writing: what the Publish dialog shows before the manager commits. */
  async publishPreview(id: string): Promise<PublishPreview> {
    const { schedule, location } = await this.find(id);
    const current = await this.snapshotOf(schedule, location.timezone);
    const previous = await this.publications.latest(schedule.id);
    const diff = diffPublication(previous?.shifts ?? [], current);
    return {
      scheduleId: schedule.id,
      publishedVersion: schedule.publishedVersion,
      hasChanges: diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0,
      diff,
    };
  }

  // ------------------------------------------------------------------------- helpers

  /** The schedule and its location, if the caller may see both (anything else is a 404). */
  private async find(
    id: string,
    { writable = false } = {},
  ): Promise<{ schedule: ScheduleRecord; location: LocationRecord }> {
    const schedule = await this.schedules.findById(id);
    if (!schedule) throw notFound();
    let location: LocationRecord;
    try {
      location = await this.access.assertAccess(schedule.locationId);
    } catch (error) {
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw notFound();
      }
      throw error;
    }
    if (writable) this.access.assertWritable(location);
    return { schedule, location };
  }

  /** Every live shift of the week, as the person working it sees it (local wall clock). */
  private async snapshotOf(schedule: ScheduleRecord, timezone: string): Promise<PublishedShift[]> {
    const rows = await this.shifts.listBySchedule(schedule.id);
    return rows
      .filter((row) => row.status !== 'cancelled')
      .map((row) => {
        const start = toLocal(row.startsAt, timezone);
        const end = toLocal(row.endsAt, timezone);
        return {
          shiftId: row.id,
          employeeId: row.employeeId,
          date: start.date,
          startTime: start.time,
          endTime: end.time,
          breakMinutes: row.breakMinutes,
          jobRoleId: row.jobRoleId,
        };
      });
  }
}
