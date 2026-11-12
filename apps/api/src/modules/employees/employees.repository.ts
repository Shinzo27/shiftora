import { Injectable } from '@nestjs/common';
import { and, asc, eq, exists, inArray, schema, sql, type Transaction } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';
import type { LocationScope } from '../locations/location-access.service.js';

const { employees, employeeJobRoles, employeeLocations } = schema;
export type EmployeeRecord = typeof employees.$inferSelect;
export type EmployeeFields = Omit<
  typeof employees.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
>;

export interface ListOptions {
  scope: LocationScope;
  status: 'active' | 'archived';
  locationId?: string;
  /** Return rows sorting after this (name, id) key. */
  after?: { name: string; id: string };
  limit: number;
}

@Injectable()
export class EmployeesRepository {
  constructor(private readonly context: RequestContext) {}

  /** Employees at any of `locationIds`, as a subquery condition. */
  private worksAt(tx: Transaction, locationIds: string[]) {
    return exists(
      tx
        .select({ one: sql`1` })
        .from(employeeLocations)
        .where(
          and(
            eq(employeeLocations.orgId, this.context.orgId),
            eq(employeeLocations.employeeId, employees.id),
            inArray(employeeLocations.locationId, locationIds),
          ),
        ),
    );
  }

  async list(options: ListOptions): Promise<EmployeeRecord[]> {
    const tx = this.context.tx;
    const conditions = [
      eq(employees.orgId, this.context.orgId),
      eq(employees.status, options.status),
    ];
    // A location-scoped caller only sees employees who work at one of their locations.
    if (options.scope.kind === 'some') conditions.push(this.worksAt(tx, [...options.scope.ids]));
    if (options.locationId) conditions.push(this.worksAt(tx, [options.locationId]));
    if (options.after) {
      conditions.push(
        sql`(${employees.name}, ${employees.id}) > (${options.after.name}, ${options.after.id})`,
      );
    }
    return tx
      .select()
      .from(employees)
      .where(and(...conditions))
      .orderBy(asc(employees.name), asc(employees.id))
      .limit(options.limit);
  }

  async findById(id: string): Promise<EmployeeRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(employees)
      .where(and(eq(employees.orgId, this.context.orgId), eq(employees.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** Several employees by id (archived included: history points at them). */
  async findByIds(ids: string[]): Promise<EmployeeRecord[]> {
    if (ids.length === 0) return [];
    return this.context.tx
      .select()
      .from(employees)
      .where(and(eq(employees.orgId, this.context.orgId), inArray(employees.id, ids)));
  }

  async create(fields: EmployeeFields): Promise<EmployeeRecord> {
    const [row] = await this.context.tx
      .insert(employees)
      .values({ ...fields, orgId: this.context.orgId })
      .returning();
    return row!;
  }

  async update(id: string, fields: Partial<EmployeeFields>): Promise<EmployeeRecord> {
    const [row] = await this.context.tx
      .update(employees)
      .set(fields)
      .where(and(eq(employees.orgId, this.context.orgId), eq(employees.id, id)))
      .returning();
    return row!;
  }

  /** Job role ids per employee, for a page of employees in one query. */
  async jobRoleIds(employeeIds: string[]): Promise<Map<string, string[]>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.context.tx
      .select({ employeeId: employeeJobRoles.employeeId, id: employeeJobRoles.jobRoleId })
      .from(employeeJobRoles)
      .where(
        and(
          eq(employeeJobRoles.orgId, this.context.orgId),
          inArray(employeeJobRoles.employeeId, employeeIds),
        ),
      )
      .orderBy(asc(employeeJobRoles.jobRoleId));
    return group(rows);
  }

  /** Location ids per employee, for a page of employees in one query. */
  async locationIds(employeeIds: string[]): Promise<Map<string, string[]>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.context.tx
      .select({ employeeId: employeeLocations.employeeId, id: employeeLocations.locationId })
      .from(employeeLocations)
      .where(
        and(
          eq(employeeLocations.orgId, this.context.orgId),
          inArray(employeeLocations.employeeId, employeeIds),
        ),
      )
      .orderBy(asc(employeeLocations.locationId));
    return group(rows);
  }

  async replaceJobRoles(employeeId: string, jobRoleIds: string[]): Promise<void> {
    const orgId = this.context.orgId;
    await this.context.tx
      .delete(employeeJobRoles)
      .where(and(eq(employeeJobRoles.orgId, orgId), eq(employeeJobRoles.employeeId, employeeId)));
    if (jobRoleIds.length > 0) {
      await this.context.tx
        .insert(employeeJobRoles)
        .values(jobRoleIds.map((jobRoleId) => ({ orgId, employeeId, jobRoleId })));
    }
  }

  async replaceLocations(employeeId: string, locationIds: string[]): Promise<void> {
    const orgId = this.context.orgId;
    await this.context.tx
      .delete(employeeLocations)
      .where(and(eq(employeeLocations.orgId, orgId), eq(employeeLocations.employeeId, employeeId)));
    if (locationIds.length > 0) {
      await this.context.tx
        .insert(employeeLocations)
        .values(locationIds.map((locationId) => ({ orgId, employeeId, locationId })));
    }
  }
}

function group(rows: { employeeId: string; id: string }[]): Map<string, string[]> {
  const byEmployee = new Map<string, string[]>();
  for (const row of rows) {
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push(row.id);
    byEmployee.set(row.employeeId, list);
  }
  return byEmployee;
}
