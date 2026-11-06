import { Injectable } from '@nestjs/common';
import {
  errorCodes,
  type Availability,
  type CreateTimeOffRequest,
  type SetAvailabilityRequest,
  type TimeOff,
  type TimeOffQuery,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityRepository, type TimeOffRecord } from './availability.repository.js';
import { EmployeesService } from './employees.service.js';

function toTimeOff(row: TimeOffRecord): TimeOff {
  return {
    id: row.id,
    employeeId: row.employeeId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Postgres `time` comes back as "HH:MM:SS"; the API speaks "HH:MM". */
const hhmm = (value: string) => value.slice(0, 5);

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly employees: EmployeesService,
    private readonly repository: AvailabilityRepository,
    private readonly audit: AuditService,
  ) {}

  async get(employeeId: string): Promise<Availability> {
    await this.employees.findAccessible(employeeId);
    const rows = await this.repository.slots(employeeId);
    return {
      employeeId,
      slots: rows.map((row) => ({
        weekday: row.weekday,
        start: hhmm(row.startLocal),
        end: hhmm(row.endLocal),
      })),
    };
  }

  /** Replaces the whole weekly pattern (already checked for overlaps by the schema). */
  async set(employeeId: string, input: SetAvailabilityRequest): Promise<Availability> {
    const before = await this.get(employeeId);
    await this.repository.replaceSlots(employeeId, input.slots);
    const after = await this.get(employeeId);
    await this.audit.record({
      action: 'availability.replaced',
      entity: 'employee',
      entityId: employeeId,
      before: { slots: before.slots },
      after: { slots: after.slots },
    });
    return after;
  }

  async listTimeOff(employeeId: string, query: TimeOffQuery): Promise<TimeOff[]> {
    await this.employees.findAccessible(employeeId);
    const rows = await this.repository.timeOff(
      employeeId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
    return rows.map(toTimeOff);
  }

  async addTimeOff(employeeId: string, input: CreateTimeOffRequest): Promise<TimeOff> {
    await this.employees.findAccessible(employeeId);
    const row = await this.repository.createTimeOff({
      employeeId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      reason: input.reason ?? null,
    });
    const created = toTimeOff(row);
    await this.audit.record({
      action: 'time_off.created',
      entity: 'time_off',
      entityId: row.id,
      after: { employeeId, startsAt: created.startsAt, endsAt: created.endsAt },
    });
    return created;
  }

  async removeTimeOff(id: string): Promise<void> {
    const row = await this.repository.findTimeOff(id);
    const notFound = () => new AppException(404, errorCodes.timeOffNotFound, 'No such time off.');
    if (!row) throw notFound();
    try {
      await this.employees.findAccessible(row.employeeId);
    } catch {
      throw notFound(); // the employee is outside the caller's scope
    }
    await this.repository.removeTimeOff(id);
    await this.audit.record({
      action: 'time_off.removed',
      entity: 'time_off',
      entityId: id,
      before: { employeeId: row.employeeId, startsAt: row.startsAt.toISOString() },
    });
  }
}
