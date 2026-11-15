import { Injectable } from '@nestjs/common';
import { and, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { pushSubscriptions } = schema;

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Web Push subscriptions, one per browser per person.
 *
 * Runs inside the request's transaction (`context.tx`), like every other tenant table: the RLS
 * setting lives on that transaction, and a pooled connection outside it would see no org at all.
 *
 * Saving is an upsert on `endpoint`: the same browser signing in again, or a person subscribing on
 * a second device, must not create a duplicate row — and a device that changes hands must move its
 * row to the new person rather than leave messages going to the old one.
 */
@Injectable()
export class PushSubscriptionsRepository {
  constructor(private readonly context: RequestContext) {}

  async save(orgId: string, employeeId: string, input: PushSubscriptionInput): Promise<void> {
    await this.context.tx
      .insert(pushSubscriptions)
      .values({
        orgId,
        employeeId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          orgId,
          employeeId,
          p256dh: input.p256dh,
          auth: input.auth,
        },
      });
  }

  /** Removing is scoped to the person asking, so a guessed endpoint cannot be unsubscribed. */
  async remove(orgId: string, employeeId: string, endpoint: string): Promise<boolean> {
    const rows = await this.context.tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.orgId, orgId),
          eq(pushSubscriptions.employeeId, employeeId),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  }
}
