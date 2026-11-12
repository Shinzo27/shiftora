import { Injectable } from '@nestjs/common';
import { and, asc, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

export interface AuditEntry {
  /** What happened, as `entity.past_tense`, e.g. "membership.role_changed". */
  action: string;
  entity: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Records who changed what, in the SAME transaction as the change (via RequestContext):
 * if the change rolls back, so does its audit entry, and vice versa.
 */
@Injectable()
export class AuditService {
  constructor(private readonly context: RequestContext) {}

  /**
   * The trail for one row, oldest first. The attendance timesheet shows it next to a corrected
   * punch, which is the only place a manager can see what changed without opening the log.
   */
  async history(
    entity: string,
    entityId: string,
  ): Promise<{ at: string; by: string | null; action: string; before: unknown; after: unknown }[]> {
    const rows = await this.context.tx
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.orgId, this.context.orgId),
          eq(schema.auditEvents.entity, entity),
          eq(schema.auditEvents.entityId, entityId),
        ),
      )
      .orderBy(asc(schema.auditEvents.createdAt));
    return rows.map((row) => ({
      at: row.createdAt.toISOString(),
      by: row.actorUserId,
      action: row.action,
      before: row.before,
      after: row.after,
    }));
  }

  async record(entry: AuditEntry): Promise<void> {
    await this.context.tx.insert(schema.auditEvents).values({
      orgId: this.context.orgId,
      actorUserId: this.context.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  }
}
