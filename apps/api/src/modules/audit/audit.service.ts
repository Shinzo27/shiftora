import { Injectable } from '@nestjs/common';
import { schema } from '@shiftora/db';

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
