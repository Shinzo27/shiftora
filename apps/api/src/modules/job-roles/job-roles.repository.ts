import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { jobRoles } = schema;
export type JobRoleRecord = typeof jobRoles.$inferSelect;

@Injectable()
export class JobRolesRepository {
  constructor(private readonly context: RequestContext) {}

  async list(): Promise<JobRoleRecord[]> {
    return this.context.tx
      .select()
      .from(jobRoles)
      .where(eq(jobRoles.orgId, this.context.orgId))
      .orderBy(asc(jobRoles.name));
  }

  async findById(id: string): Promise<JobRoleRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(jobRoles)
      .where(and(eq(jobRoles.orgId, this.context.orgId), eq(jobRoles.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** How many of these ids are job roles of the current org. */
  async countExisting(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.context.tx
      .select({ id: jobRoles.id })
      .from(jobRoles)
      .where(and(eq(jobRoles.orgId, this.context.orgId), inArray(jobRoles.id, ids)));
    return rows.length;
  }

  async create(name: string): Promise<JobRoleRecord> {
    const [row] = await this.context.tx
      .insert(jobRoles)
      .values({ orgId: this.context.orgId, name })
      .returning();
    return row!;
  }

  async rename(id: string, name: string): Promise<JobRoleRecord> {
    const [row] = await this.context.tx
      .update(jobRoles)
      .set({ name })
      .where(and(eq(jobRoles.orgId, this.context.orgId), eq(jobRoles.id, id)))
      .returning();
    return row!;
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(jobRoles)
      .where(and(eq(jobRoles.orgId, this.context.orgId), eq(jobRoles.id, id)));
  }
}
