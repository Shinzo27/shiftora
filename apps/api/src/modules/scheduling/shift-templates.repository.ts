import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';
import type { LocationScope } from '../locations/location-access.service.js';

const { shiftTemplates } = schema;
export type ShiftTemplateRecord = typeof shiftTemplates.$inferSelect;

export interface ShiftTemplateValues {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  jobRoleId: string | null;
}

@Injectable()
export class ShiftTemplatesRepository {
  constructor(private readonly context: RequestContext) {}

  /** Templates at one location, or at every location in the caller's scope. */
  async list(scope: LocationScope, locationId?: string): Promise<ShiftTemplateRecord[]> {
    const conditions = [eq(shiftTemplates.orgId, this.context.orgId)];
    if (locationId) conditions.push(eq(shiftTemplates.locationId, locationId));
    else if (scope.kind === 'some') {
      conditions.push(inArray(shiftTemplates.locationId, [...scope.ids]));
    }
    return this.context.tx
      .select()
      .from(shiftTemplates)
      .where(and(...conditions))
      .orderBy(asc(shiftTemplates.startTime), asc(shiftTemplates.name));
  }

  async findById(id: string): Promise<ShiftTemplateRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(shiftTemplates)
      .where(and(eq(shiftTemplates.orgId, this.context.orgId), eq(shiftTemplates.id, id)))
      .limit(1);
    return row ?? null;
  }

  async create(locationId: string, values: ShiftTemplateValues): Promise<ShiftTemplateRecord> {
    const [row] = await this.context.tx
      .insert(shiftTemplates)
      .values({ orgId: this.context.orgId, locationId, ...values })
      .returning();
    return row!;
  }

  async update(id: string, values: ShiftTemplateValues): Promise<ShiftTemplateRecord> {
    const [row] = await this.context.tx
      .update(shiftTemplates)
      .set(values)
      .where(and(eq(shiftTemplates.orgId, this.context.orgId), eq(shiftTemplates.id, id)))
      .returning();
    return row!;
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(shiftTemplates)
      .where(and(eq(shiftTemplates.orgId, this.context.orgId), eq(shiftTemplates.id, id)));
  }
}
