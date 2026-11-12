import { Injectable } from '@nestjs/common';
import {
  errorCodes,
  type CreateEmployeeRequest,
  type Employee,
  type ListEmployeesQuery,
  type Me,
  type Page,
  type UpdateEmployeeRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { decodeCursor, encodeCursor } from '../../common/cursor.js';
import { uniqueViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { MembershipsRepository } from '../orgs/memberships.repository.js';
import type { OrgMember } from '../tenancy/member.js';
import {
  EmployeesRepository,
  type EmployeeFields,
  type EmployeeRecord,
} from './employees.repository.js';

export const employeeNotFound = () =>
  new AppException(404, errorCodes.employeeNotFound, 'No such employee.');

function toEmployee(row: EmployeeRecord, jobRoleIds: string[], locationIds: string[]): Employee {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    hourlyRateMinor: row.hourlyRateMinor,
    currency: row.currency,
    maxWeeklyMinutes: row.maxWeeklyMinutes,
    minRestMinutes: row.minRestMinutes,
    notifyChannel: row.notifyChannel,
    status: row.status,
    jobRoleIds,
    locationIds,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly employees: EmployeesRepository,
    private readonly access: LocationAccess,
    private readonly jobRoles: JobRolesService,
    private readonly memberships: MembershipsRepository,
    private readonly locations: LocationsRepository,
    private readonly audit: AuditService,
  ) {}

  /** The staff profile behind this login, or null when this person is not on the rota. */
  findByUserId(userId: string): Promise<EmployeeRecord | null> {
    return this.employees.findByUserId(userId);
  }

  /**
   * The caller's own profile for the staff app.
   *
   * Deliberately not scope-checked: a person's own record, roles and locations are theirs to
   * see even if a manager later trims their location scope — that is a staffing question, not
   * a privacy one.
   */
  async findMine(member: OrgMember): Promise<Me> {
    const employee = await this.employees.findByUserId(member.userId);
    if (!employee) return { userId: member.userId, role: member.role, profile: null };

    const [roleIdsByEmployee, locationIdsByEmployee, roles] = await Promise.all([
      this.employees.jobRoleIds([employee.id]),
      this.employees.locationIds([employee.id]),
      this.jobRoles.list(),
    ]);
    const locations = await this.locations.findByIds(locationIdsByEmployee.get(employee.id) ?? []);
    const roleName = new Map(roles.map((role) => [role.id, role.name]));

    return {
      userId: member.userId,
      role: member.role,
      profile: {
        employeeId: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        notifyChannel: employee.notifyChannel,
        jobRoleNames: (roleIdsByEmployee.get(employee.id) ?? [])
          .map((id) => roleName.get(id))
          .filter((name): name is string => Boolean(name)),
        locations: locations
          .map((location) => ({
            id: location.id,
            name: location.name,
            timezone: location.timezone,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  }

  async list(query: ListEmployeesQuery): Promise<Page<Employee>> {
    if (query.locationId) await this.access.assertAccess(query.locationId);
    const after = query.cursor ? decodeCursor(query.cursor, 2) : undefined;

    // Fetch one extra row: if it exists, there is a next page.
    const rows = await this.employees.list({
      scope: await this.access.scope(),
      status: query.status,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(after ? { after: { name: after[0]!, id: after[1]! } } : {}),
      limit: query.limit + 1,
    });
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      items: await this.withRelations(pageRows),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.name, last.id]) : null,
    };
  }

  /**
   * Several employee records by id, without the per-caller location scope: only callers that
   * have already established access to rows referencing these people (the week board, whose
   * shifts are in scope) use it, and an out-of-scope employee simply has no such rows.
   */
  async findMany(ids: string[]): Promise<Map<string, EmployeeRecord>> {
    const rows = await this.employees.findByIds(ids);
    return new Map(rows.map((row) => [row.id, row]));
  }

  async get(id: string): Promise<Employee> {
    const [employee] = await this.withRelations([await this.findAccessible(id)]);
    return employee!;
  }

  async create(input: CreateEmployeeRequest): Promise<Employee> {
    const { jobRoleIds = [], locationIds = [], ...fields } = input;
    const roles = unique(jobRoleIds);
    const locations = unique(locationIds);

    const scope = await this.access.scope();
    if (scope.kind === 'some' && locations.length === 0) {
      // Otherwise the manager would create someone they can't see.
      throw new AppException(400, errorCodes.validationFailed, 'Assign at least one location.', [
        { path: 'locationIds', message: 'Assign at least one of your locations' },
      ]);
    }
    await this.assertAssignableLocations(locations);
    await this.jobRoles.assertAllExist(roles);
    if (fields.userId) await this.assertMember(fields.userId);

    const row = await this.withUniqueChecks(() =>
      this.employees.create({ ...toFields(fields), name: fields.name }),
    );
    await this.employees.replaceJobRoles(row.id, roles);
    await this.employees.replaceLocations(row.id, locations);
    const created = toEmployee(row, roles.sort(), locations.sort());
    await this.audit.record({
      action: 'employee.created',
      entity: 'employee',
      entityId: row.id,
      after: snapshot(created),
    });
    return created;
  }

  async update(id: string, changes: UpdateEmployeeRequest): Promise<Employee> {
    const current = await this.get(id);
    const { jobRoleIds, locationIds, ...fields } = changes;

    let roles = current.jobRoleIds;
    if (jobRoleIds) {
      roles = unique(jobRoleIds).sort();
      await this.jobRoles.assertAllExist(roles);
    }

    let locations = current.locationIds;
    if (locationIds) {
      const requested = unique(locationIds);
      await this.assertAssignableLocations(requested);
      // A scoped manager only edits assignments inside their scope; others stay as they are.
      const scope = await this.access.scope();
      const outside =
        scope.kind === 'some' ? current.locationIds.filter((l) => !scope.ids.has(l)) : [];
      locations = unique([...outside, ...requested]).sort();
    }
    if (fields.userId) await this.assertMember(fields.userId);

    const row =
      Object.keys(fields).length > 0
        ? await this.withUniqueChecks(() => this.employees.update(id, toFields(fields)))
        : await this.findAccessible(id);
    if (jobRoleIds) await this.employees.replaceJobRoles(id, roles);
    if (locationIds) await this.employees.replaceLocations(id, locations);

    const updated = toEmployee(row, roles, locations);
    await this.audit.record({
      action: changes.status === 'archived' ? 'employee.archived' : 'employee.updated',
      entity: 'employee',
      entityId: id,
      before: snapshot(current),
      after: snapshot(updated),
    });
    return updated;
  }

  /**
   * The employee, if the caller may see them: owners and unrestricted members see everyone;
   * a location-scoped member sees employees working at one of their locations. Others → 404.
   */
  async findAccessible(id: string): Promise<EmployeeRecord> {
    const row = await this.employees.findById(id);
    if (!row) throw employeeNotFound();
    const scope = await this.access.scope();
    if (scope.kind === 'some') {
      const locations = (await this.employees.locationIds([id])).get(id) ?? [];
      if (!locations.some((l) => scope.ids.has(l))) throw employeeNotFound();
    }
    return row;
  }

  private async withRelations(rows: EmployeeRecord[]): Promise<Employee[]> {
    const ids = rows.map((row) => row.id);
    const [roles, locations] = await Promise.all([
      this.employees.jobRoleIds(ids),
      this.employees.locationIds(ids),
    ]);
    return rows.map((row) => toEmployee(row, roles.get(row.id) ?? [], locations.get(row.id) ?? []));
  }

  /** Each location must be visible to the caller and active. */
  private async assertAssignableLocations(locationIds: string[]): Promise<void> {
    for (const locationId of locationIds) {
      this.access.assertWritable(await this.access.assertAccess(locationId));
    }
  }

  private async assertMember(userId: string): Promise<void> {
    if (!(await this.memberships.find(userId))) {
      throw new AppException(
        404,
        errorCodes.memberNotFound,
        'Only members of this organisation can be linked to an employee.',
      );
    }
  }

  private async withUniqueChecks<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === 'employees_org_email_unique') {
        throw new AppException(
          409,
          errorCodes.duplicate,
          'An employee with this email already exists.',
        );
      }
      if (constraint === 'employees_org_user_unique') {
        throw new AppException(
          409,
          errorCodes.duplicate,
          'This member is already linked to an employee.',
        );
      }
      throw error;
    }
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Request fields → column values (undefined = leave unchanged). */
function toFields(
  input: Omit<UpdateEmployeeRequest, 'jobRoleIds' | 'locationIds'>,
): Partial<EmployeeFields> {
  const fields: Partial<EmployeeFields> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (fields as Record<string, unknown>)[key] = value;
  }
  return fields;
}

/** What goes into the audit log (no ids of the row itself, no timestamps). */
function snapshot(employee: Employee): Record<string, unknown> {
  const { id, createdAt, ...rest } = employee;
  return rest;
}
