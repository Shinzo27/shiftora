import { Injectable } from '@nestjs/common';
import { schema } from '@shiftora/db';

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
  constructor(private readonly context: RequestContext) {}

  async record(topic: string, payload: Record<string, unknown>): Promise<void> {
    await this.context.tx.insert(schema.outbox).values({
      orgId: this.context.orgId,
      topic,
      payload,
    });
  }
}
