import { Injectable } from '@nestjs/common';
import { errorCodes, type JobRole } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { nameTaken } from '../locations/locations.service.js';
import { JobRolesRepository, type JobRoleRecord } from './job-roles.repository.js';

function toJobRole(row: JobRoleRecord): JobRole {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

const notFound = () => new AppException(404, errorCodes.jobRoleNotFound, 'No such job role.');

/** Org-wide work roles (Nurse, Receptionist). Not member roles (owner, manager…). */
@Injectable()
export class JobRolesService {
  constructor(
    private readonly jobRoles: JobRolesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<JobRole[]> {
    return (await this.jobRoles.list()).map(toJobRole);
  }

  async create(name: string): Promise<JobRole> {
    const row = await this.withUniqueName(() => this.jobRoles.create(name));
    await this.audit.record({
      action: 'job_role.created',
      entity: 'job_role',
      entityId: row.id,
      after: { name: row.name },
    });
    return toJobRole(row);
  }

  async rename(id: string, name: string): Promise<JobRole> {
    const current = await this.jobRoles.findById(id);
    if (!current) throw notFound();
    const row = await this.withUniqueName(() => this.jobRoles.rename(id, name));
    await this.audit.record({
      action: 'job_role.renamed',
      entity: 'job_role',
      entityId: id,
      before: { name: current.name },
      after: { name: row.name },
    });
    return toJobRole(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.jobRoles.findById(id);
    if (!current) throw notFound();
    await this.jobRoles.remove(id);
    await this.audit.record({
      action: 'job_role.removed',
      entity: 'job_role',
      entityId: id,
      before: { name: current.name },
    });
  }

  private async withUniqueName<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('job role');
      throw error;
    }
  }
}
