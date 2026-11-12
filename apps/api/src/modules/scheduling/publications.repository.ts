import { Injectable } from '@nestjs/common';
import { and, desc, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { schedulePublications } = schema;

export type PublicationRecord = typeof schedulePublications.$inferSelect;
export type PublicationShifts = typeof schedulePublications.$inferInsert.shifts;

/**
 * What each publish actually sent. The latest row is the "what staff were told" baseline that
 * the next publish diffs against; the rows themselves are history (never updated).
 */
@Injectable()
export class PublicationsRepository {
  constructor(private readonly context: RequestContext) {}

  async latest(scheduleId: string): Promise<PublicationRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(schedulePublications)
      .where(
        and(
          eq(schedulePublications.orgId, this.context.orgId),
          eq(schedulePublications.scheduleId, scheduleId),
        ),
      )
      .orderBy(desc(schedulePublications.publishedAt), desc(schedulePublications.version))
      .limit(1);
    return row ?? null;
  }

  async create(values: {
    scheduleId: string;
    version: number;
    shifts: PublicationShifts;
    affectedEmployeeIds: string[];
    publishedBy: string;
  }): Promise<PublicationRecord> {
    const [row] = await this.context.tx
      .insert(schedulePublications)
      .values({ ...values, orgId: this.context.orgId })
      .returning();
    return row!;
  }
}
