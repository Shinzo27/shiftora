import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseConnection } from '@shiftora/db';

import { DATABASE } from '../../database/database.module.js';
import { RequestContext } from '../../database/request-context.js';

/**
 * The transactional outbox.
 *
 * A side effect that must leave the system — telling staff their week changed — is written as
 * an event row **inside the request's transaction**. It commits or rolls back with the change
 * that caused it, so "saved but nobody was told" cannot happen, and "told but the save failed"
 * cannot either. A worker relays the rows later (week 4) and marks them published.
 *
 * Request handlers never call WhatsApp, SMS, email or push directly (AGENTS.md).
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly context: RequestContext,
    @Inject(DATABASE) private readonly database: DatabaseConnection,
  ) {}

  async record(topic: string, payload: Record<string, unknown>): Promise<void> {
    await this.context.tx.insert(schema.outbox).values({
      orgId: this.context.orgId,
      topic,
      payload,
    });
  }

  /**
   * A platform event: an email verification or a password reset, which belongs to a person and
   * not to a tenant. `org_id` is null and migration 0014 allows exactly that; every tenant row
   * still goes through `record()`, under the request's own org.
   */
  async recordPlatform(topic: string, payload: Record<string, unknown>): Promise<void> {
    // Its own transaction, because auth routes have none: signup and password reset are not
    // tenant requests, so there is no request transaction to join. A lost event here costs one
    // email, and the resend endpoint exists for exactly that.
    await this.database.db.insert(schema.outbox).values({ orgId: null, topic, payload });
  }
}
