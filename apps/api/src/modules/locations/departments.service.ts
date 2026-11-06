import { Injectable } from '@nestjs/common';
import { errorCodes, type Department } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { DepartmentsRepository, type DepartmentRecord } from './departments.repository.js';
import { LocationAccess } from './location-access.service.js';
import { nameTaken } from './locations.service.js';

function toDepartment(row: DepartmentRecord): Department {
  return {
    id: row.id,
    locationId: row.locationId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = () => new AppException(404, errorCodes.departmentNotFound, 'No such department.');

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly departments: DepartmentsRepository,
    private readonly access: LocationAccess,
    private readonly audit: AuditService,
  ) {}

  async list(locationId: string): Promise<Department[]> {
    await this.access.assertAccess(locationId);
    return (await this.departments.listByLocation(locationId)).map(toDepartment);
  }

  async create(locationId: string, name: string): Promise<Department> {
    this.access.assertWritable(await this.access.assertAccess(locationId));
    const row = await this.withUniqueName(() => this.departments.create(locationId, name));
    await this.audit.record({
      action: 'department.created',
      entity: 'department',
      entityId: row.id,
      after: { name: row.name, locationId },
    });
    return toDepartment(row);
  }

  async rename(id: string, name: string): Promise<Department> {
    const current = await this.findAccessible(id);
    const row = await this.withUniqueName(() => this.departments.rename(id, name));
    await this.audit.record({
      action: 'department.renamed',
      entity: 'department',
      entityId: id,
      before: { name: current.name },
      after: { name: row.name },
    });
    return toDepartment(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findAccessible(id);
    await this.departments.remove(id);
    await this.audit.record({
      action: 'department.removed',
      entity: 'department',
      entityId: id,
      before: { name: current.name, locationId: current.locationId },
    });
  }

  /** The department, if its location is in the caller's scope and writable; else 404/409. */
  private async findAccessible(id: string): Promise<DepartmentRecord> {
    const department = await this.departments.findById(id);
    if (!department) throw notFound();
    try {
      this.access.assertWritable(await this.access.assertAccess(department.locationId));
    } catch (error) {
      // Outside the caller's scope: answer as if the department didn't exist.
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw notFound();
      }
      throw error;
    }
    return department;
  }

  private async withUniqueName<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('department at this location');
      throw error;
    }
  }
}
