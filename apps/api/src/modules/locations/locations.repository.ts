import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';
import type { LocationScope } from './location-access.service.js';

const { locations } = schema;
export type LocationRecord = typeof locations.$inferSelect;
type LocationFields = Omit<
  typeof locations.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class LocationsRepository {
  constructor(private readonly context: RequestContext) {}

  /** Locations of the current org that `scope` allows, by name. */
  async list(scope: LocationScope): Promise<LocationRecord[]> {
    const inOrg = eq(locations.orgId, this.context.orgId);
    return this.context.tx
      .select()
      .from(locations)
      .where(scope.kind === 'all' ? inOrg : and(inOrg, inArray(locations.id, [...scope.ids])))
      .orderBy(asc(locations.name));
  }

  async findById(id: string): Promise<LocationRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(locations)
      .where(and(eq(locations.orgId, this.context.orgId), eq(locations.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** How many of these ids are locations of the current org. */
  /** Several locations by id, for naming rows in a list (no scope check: callers filter first). */
  async findByIds(ids: string[]): Promise<LocationRecord[]> {
    if (ids.length === 0) return [];
    return this.context.tx
      .select()
      .from(locations)
      .where(and(eq(locations.orgId, this.context.orgId), inArray(locations.id, ids)));
  }

  async countExisting(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.context.tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.orgId, this.context.orgId), inArray(locations.id, ids)));
    return rows.length;
  }

  async create(fields: LocationFields): Promise<LocationRecord> {
    const [row] = await this.context.tx
      .insert(locations)
      .values({ ...fields, orgId: this.context.orgId })
      .returning();
    return row!;
  }

  async update(id: string, fields: Partial<LocationFields>): Promise<LocationRecord> {
    const [row] = await this.context.tx
      .update(locations)
      .set(fields)
      .where(and(eq(locations.orgId, this.context.orgId), eq(locations.id, id)))
      .returning();
    return row!;
  }
}
