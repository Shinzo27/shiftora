import { Injectable } from '@nestjs/common';
import { and, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { idempotencyKeys } = schema;

export interface StoredResponse {
  status: number;
  body: unknown;
}

/** One row per (organisation, route, key); the unique index is the lock. */
@Injectable()
export class IdempotencyKeysRepository {
  constructor(private readonly context: RequestContext) {}

  /** Claims the key for this request. False means somebody else already holds it. */
  async reserve(input: {
    orgId: string;
    route: string;
    key: string;
    requestHash: string;
  }): Promise<boolean> {
    const inserted = await this.context.tx
      .insert(idempotencyKeys)
      .values({ ...input, responseStatus: null, responseBody: null })
      .onConflictDoNothing({
        target: [idempotencyKeys.orgId, idempotencyKeys.route, idempotencyKeys.key],
      })
      .returning({ id: idempotencyKeys.id });
    return inserted.length === 1;
  }

  /**
   * The row for this key. `for update` because the other request may still be finishing: the
   * caller must wait for its answer rather than read a reservation with no response.
   */
  async find(orgId: string, route: string, key: string) {
    const [row] = await this.context.tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.orgId, orgId),
          eq(idempotencyKeys.route, route),
          eq(idempotencyKeys.key, key),
        ),
      )
      .for('update');
    return row ?? null;
  }

  async store(id: string, response: StoredResponse): Promise<void> {
    await this.context.tx
      .update(idempotencyKeys)
      .set({ responseStatus: response.status, responseBody: response.body })
      .where(eq(idempotencyKeys.id, id));
  }

  /** A reservation whose request died before answering: take it over with the same body. */
  async takeover(id: string, requestHash: string): Promise<void> {
    await this.context.tx
      .update(idempotencyKeys)
      .set({ requestHash })
      .where(eq(idempotencyKeys.id, id));
  }
}
