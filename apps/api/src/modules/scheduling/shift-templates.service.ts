import { Injectable } from '@nestjs/common';
import { nominalMinutes } from '@shiftora/domain';
import {
  errorCodes,
  shiftTemplateIssue,
  type CreateShiftTemplateRequest,
  type ListShiftTemplatesQuery,
  type ShiftTemplate,
  type UpdateShiftTemplateRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { nameTaken } from '../locations/locations.service.js';
import {
  ShiftTemplatesRepository,
  type ShiftTemplateRecord,
  type ShiftTemplateValues,
} from './shift-templates.repository.js';

/** Postgres `time` comes back as "HH:MM:SS"; the API speaks "HH:MM". */
const hhmm = (time: string) => time.slice(0, 5);

function valuesOf(row: ShiftTemplateRecord): ShiftTemplateValues {
  return {
    name: row.name,
    startTime: hhmm(row.startTime),
    endTime: hhmm(row.endTime),
    breakMinutes: row.breakMinutes,
    jobRoleId: row.jobRoleId,
  };
}

function toShiftTemplate(row: ShiftTemplateRecord): ShiftTemplate {
  const values = valuesOf(row);
  return {
    id: row.id,
    locationId: row.locationId,
    ...values,
    paidMinutes: nominalMinutes(values.startTime, values.endTime) - values.breakMinutes,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = () =>
  new AppException(404, errorCodes.shiftTemplateNotFound, 'No such shift template.');

@Injectable()
export class ShiftTemplatesService {
  constructor(
    private readonly templates: ShiftTemplatesRepository,
    private readonly access: LocationAccess,
    private readonly jobRoles: JobRolesService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListShiftTemplatesQuery): Promise<ShiftTemplate[]> {
    if (query.locationId) await this.access.assertAccess(query.locationId);
    const rows = await this.templates.list(await this.access.scope(), query.locationId);
    return rows.map(toShiftTemplate);
  }

  async create(body: CreateShiftTemplateRequest): Promise<ShiftTemplate> {
    this.access.assertWritable(await this.access.assertAccess(body.locationId));
    if (body.jobRoleId) await this.jobRoles.assertAllExist([body.jobRoleId]);
    const values: ShiftTemplateValues = {
      name: body.name,
      startTime: body.startTime,
      endTime: body.endTime,
      breakMinutes: body.breakMinutes,
      jobRoleId: body.jobRoleId ?? null,
    };
    const row = await this.withUniqueName(() => this.templates.create(body.locationId, values));
    await this.audit.record({
      action: 'shift_template.created',
      entity: 'shift_template',
      entityId: row.id,
      after: { locationId: row.locationId, ...values },
    });
    return toShiftTemplate(row);
  }

  async update(id: string, body: UpdateShiftTemplateRequest): Promise<ShiftTemplate> {
    const current = await this.findWritable(id);
    const before = valuesOf(current);
    const after: ShiftTemplateValues = {
      name: body.name ?? before.name,
      startTime: body.startTime ?? before.startTime,
      endTime: body.endTime ?? before.endTime,
      breakMinutes: body.breakMinutes ?? before.breakMinutes,
      jobRoleId: body.jobRoleId === undefined ? before.jobRoleId : body.jobRoleId,
    };
    // Changing only the end can make the stored break too long, so check the merged result.
    const issue = shiftTemplateIssue(after.startTime, after.endTime, after.breakMinutes);
    if (issue) {
      throw new AppException(400, errorCodes.validationFailed, 'The request is invalid.', [issue]);
    }
    if (after.jobRoleId && after.jobRoleId !== before.jobRoleId) {
      await this.jobRoles.assertAllExist([after.jobRoleId]);
    }
    const row = await this.withUniqueName(() => this.templates.update(id, after));
    await this.audit.record({
      action: 'shift_template.updated',
      entity: 'shift_template',
      entityId: id,
      before: { ...before },
      after: { ...after },
    });
    return toShiftTemplate(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findWritable(id);
    await this.templates.remove(id);
    await this.audit.record({
      action: 'shift_template.removed',
      entity: 'shift_template',
      entityId: id,
      before: { locationId: current.locationId, ...valuesOf(current) },
    });
  }

  /** The template, if its location is in the caller's scope (else 404) and writable (else 409). */
  private async findWritable(id: string): Promise<ShiftTemplateRecord> {
    const template = await this.templates.findById(id);
    if (!template) throw notFound();
    try {
      this.access.assertWritable(await this.access.assertAccess(template.locationId));
    } catch (error) {
      // Outside the caller's scope: answer as if the template didn't exist.
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw notFound();
      }
      throw error;
    }
    return template;
  }

  private async withUniqueName<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('shift template at this location');
      throw error;
    }
  }
}
