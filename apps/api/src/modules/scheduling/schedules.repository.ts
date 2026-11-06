import { Injectable } from '@nestjs/common';
import { and, desc, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { schedules } = schema;
export type ScheduleRecord = typeof schedules.$inferSelect;

/** How many weeks a list returns when no week is given (about six months). */
const RECENT_WEEKS = 26;

@Injectable()
export class SchedulesRepository {
  constructor(private readonly context: RequestContext) {}

  /** One location's schedules, newest week first; or just the given week. */
  async list(locationId: string, weekStart?: string): Promise<ScheduleRecord[]> {
    const conditions = [
      eq(schedules.orgId, this.context.orgId),
      eq(schedules.locationId, locationId),
    ];
    if (weekStart) conditions.push(eq(schedules.weekStart, weekStart));
    return this.context.tx
      .select()
      .from(schedules)
      .where(and(...conditions))
      .orderBy(desc(schedules.weekStart))
      .limit(RECENT_WEEKS);
  }

  async findById(id: string): Promise<ScheduleRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.orgId, this.context.orgId), eq(schedules.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** A new draft. Throws a unique violation if the week already has one. */
  async create(locationId: string, weekStart: string): Promise<ScheduleRecord> {
    const [row] = await this.context.tx
      .insert(schedules)
      .values({ orgId: this.context.orgId, locationId, weekStart })
      .returning();
    return row!;
  }
}
