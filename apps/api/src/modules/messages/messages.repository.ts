import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, schema, sql } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { deliveries, notifications, employees, messageUsage, locations } = schema;

export interface DeadLetterRow {
  id: string;
  notificationId: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'push';
  address: string | null;
  lastError: string | null;
  attempts: number;
  replays: number;
  deadLetteredAt: Date;
  subject: string;
  employeeName: string | null;
  recipientEmail: string | null;
}

/** The dead-letter page shows the most recent failures; older ones are history, not a queue. */
const DEAD_LETTER_PAGE = 100;

@Injectable()
export class MessagesRepository {
  constructor(private readonly context: RequestContext) {}

  async deadLetters(): Promise<DeadLetterRow[]> {
    const rows = await this.context.tx
      .select({
        id: deliveries.id,
        notificationId: deliveries.notificationId,
        channel: deliveries.channel,
        address: deliveries.address,
        lastError: deliveries.lastError,
        attempts: deliveries.attempts,
        replays: deliveries.replays,
        deadLetteredAt: deliveries.deadLetteredAt,
        subject: notifications.subject,
        employeeName: employees.name,
        recipientEmail: notifications.recipientEmail,
      })
      .from(deliveries)
      .innerJoin(notifications, eq(notifications.id, deliveries.notificationId))
      .leftJoin(employees, eq(employees.id, notifications.employeeId))
      .where(and(eq(deliveries.orgId, this.context.orgId), isNotNull(deliveries.deadLetteredAt)))
      .orderBy(desc(deliveries.deadLetteredAt))
      .limit(DEAD_LETTER_PAGE);
    // isNotNull above guarantees the timestamp; the type system cannot see through the filter.
    return rows.map((row) => ({ ...row, deadLetteredAt: row.deadLetteredAt! }));
  }

  /** The other deliveries of these messages: where each one went after it gave up. */
  async siblings(
    notificationIds: string[],
  ): Promise<{ id: string; notificationId: string; channel: string; status: string }[]> {
    if (notificationIds.length === 0) return [];
    return this.context.tx
      .select({
        id: deliveries.id,
        notificationId: deliveries.notificationId,
        channel: deliveries.channel,
        status: deliveries.status,
      })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.orgId, this.context.orgId),
          inArray(deliveries.notificationId, notificationIds),
        ),
      )
      .orderBy(deliveries.createdAt);
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.context.tx
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.orgId, this.context.orgId), eq(deliveries.id, id)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Puts a dead letter back in line: queued, no longer dead, one more replay. Conditional on it
   * still being dead, so two owners pressing Replay at once produce one replay, not two.
   */
  async resetForReplay(id: string): Promise<{ replays: number; channel: string } | null> {
    const [row] = await this.context.tx
      .update(deliveries)
      .set({
        status: 'queued',
        deadLetteredAt: null,
        lastError: null,
        replays: sql`${deliveries.replays} + 1`,
      })
      .where(
        and(
          eq(deliveries.orgId, this.context.orgId),
          eq(deliveries.id, id),
          isNotNull(deliveries.deadLetteredAt),
        ),
      )
      .returning({ replays: deliveries.replays, channel: deliveries.channel });
    return row ?? null;
  }

  async usage(month: string): Promise<{ channel: string; sentCount: number }[]> {
    return this.context.tx
      .select({ channel: messageUsage.channel, sentCount: messageUsage.sentCount })
      .from(messageUsage)
      .where(and(eq(messageUsage.orgId, this.context.orgId), eq(messageUsage.month, month)));
  }

  /** Until billing (W8) every active location counts as paid, as in the worker's quota check. */
  async activeLocations(): Promise<number> {
    const [row] = await this.context.tx
      .select({ total: count() })
      .from(locations)
      .where(and(eq(locations.orgId, this.context.orgId), eq(locations.status, 'active')));
    return row?.total ?? 0;
  }
}
