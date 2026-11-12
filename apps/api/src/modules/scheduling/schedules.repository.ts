import { Injectable } from '@nestjs/common';
import { and, desc, eq, schema, sql } from '@shiftora/db';

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

  /**
   * Marks the week as changed. Every shift write calls this, so `version > publishedVersion`
   * means "the board has edits staff have not been told about" without a diff query.
   */
  async touch(id: string): Promise<void> {
    await this.context.tx
      .update(schedules)
      .set({ version: sql`${schedules.version} + 1` })
      .where(and(eq(schedules.orgId, this.context.orgId), eq(schedules.id, id)));
  }

  /**
   * Publishes: status, the moment, who did it, and both versions moving to the same number
   * (nothing outstanding). All SET expressions read the old row, so `version + 1` twice is
   * one increment, read as "the version this publication sent".
   */
  async publish(id: string, userId: string): Promise<ScheduleRecord | null> {
    const [row] = await this.context.tx
      .update(schedules)
      .set({
        status: 'published',
        version: sql`${schedules.version} + 1`,
        publishedVersion: sql`${schedules.version} + 1`,
        publishedAt: new Date(),
        publishedBy: userId,
      })
      .where(and(eq(schedules.orgId, this.context.orgId), eq(schedules.id, id)))
      .returning();
    return row ?? null;
  }
}
