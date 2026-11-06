import { Injectable } from '@nestjs/common';
import { and, asc, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { departments } = schema;
export type DepartmentRecord = typeof departments.$inferSelect;

@Injectable()
export class DepartmentsRepository {
  constructor(private readonly context: RequestContext) {}

  async listByLocation(locationId: string): Promise<DepartmentRecord[]> {
    return this.context.tx
      .select()
      .from(departments)
      .where(and(eq(departments.orgId, this.context.orgId), eq(departments.locationId, locationId)))
      .orderBy(asc(departments.name));
  }

  async findById(id: string): Promise<DepartmentRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(departments)
      .where(and(eq(departments.orgId, this.context.orgId), eq(departments.id, id)))
      .limit(1);
    return row ?? null;
  }

  async create(locationId: string, name: string): Promise<DepartmentRecord> {
    const [row] = await this.context.tx
      .insert(departments)
      .values({ orgId: this.context.orgId, locationId, name })
      .returning();
    return row!;
  }

  async rename(id: string, name: string): Promise<DepartmentRecord> {
    const [row] = await this.context.tx
      .update(departments)
      .set({ name })
      .where(and(eq(departments.orgId, this.context.orgId), eq(departments.id, id)))
      .returning();
    return row!;
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(departments)
      .where(and(eq(departments.orgId, this.context.orgId), eq(departments.id, id)));
  }
}
