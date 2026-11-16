import { Inject, Injectable } from '@nestjs/common';
import { maskAddress, monthlyLimit, PAID_CHANNELS, usageMonth, type Clock } from '@shiftora/domain';
import {
  errorCodes,
  type DeadLetter,
  type MessageUsage,
  type RecentMessage,
  type ReplayResult,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { CLOCK } from '../../common/clock.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { MessagesRepository } from './messages.repository.js';

/**
 * The owner's window onto outgoing messages: what the queue gave up on, a way to send it again,
 * and the month's paid-message usage.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly messages: MessagesRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async deadLetters(): Promise<DeadLetter[]> {
    const rows = await this.messages.deadLetters();
    const siblings = await this.messages.siblings([...new Set(rows.map((r) => r.notificationId))]);

    return rows.map((row) => {
      // Where the message went after this channel gave up: its next delivery, if any.
      const next = siblings.find(
        (other) => other.notificationId === row.notificationId && other.id !== row.id,
      );
      return {
        id: row.id,
        channel: row.channel,
        recipient: row.employeeName ?? row.recipientEmail ?? 'Unknown recipient',
        address: maskAddress(row.address),
        subject: row.subject,
        reason: row.lastError,
        attempts: row.attempts,
        replays: row.replays,
        deadLetteredAt: row.deadLetteredAt.toISOString(),
        fallback: next
          ? { channel: next.channel as DeadLetter['channel'], status: next.status }
          : null,
      };
    });
  }

  /** The last deliveries with how far each got, for the owner to see that messages arrive. */
  async recent(): Promise<RecentMessage[]> {
    const rows = await this.messages.recent();
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      recipient: row.employeeName ?? row.recipientEmail ?? 'Unknown recipient',
      address: maskAddress(row.address),
      subject: row.subject,
      kind: row.kind,
      status: row.status === 'delivered' && row.readAt ? 'read' : row.status,
      reason: row.status === 'failed' || row.status === 'skipped' ? row.lastError : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: (row.readAt ?? row.deliveredAt ?? row.sentAt ?? row.createdAt).toISOString(),
    }));
  }

  /**
   * Sends a dead letter again. The API does not touch the queue (AGENTS.md: side effects go
   * through the outbox): it resets the row and writes `delivery.replay` in the same
   * transaction, and the worker queues it. A row that is not dead-lettered is a 409 — replaying
   * a message that was sent, or is already queued, would only send it twice.
   */
  async replay(id: string): Promise<ReplayResult> {
    const reset = await this.messages.resetForReplay(id);
    if (!reset) {
      if (!(await this.messages.exists(id))) {
        throw new AppException(404, errorCodes.deliveryNotFound, 'No such message.');
      }
      throw new AppException(
        409,
        errorCodes.deliveryNotDeadLettered,
        'Only a message that failed every retry can be replayed.',
      );
    }

    await this.outbox.record('delivery.replay', { deliveryId: id, replays: reset.replays });
    await this.audit.record({
      action: 'delivery.replayed',
      entity: 'delivery',
      entityId: id,
      after: { channel: reset.channel, replays: reset.replays },
    });
    return { id, status: 'queued', replays: reset.replays };
  }

  async usage(): Promise<MessageUsage> {
    const month = usageMonth(this.clock.now());
    const [rows, paidLocations] = await Promise.all([
      this.messages.usage(month),
      this.messages.activeLocations(),
    ]);
    return {
      month,
      channels: PAID_CHANNELS.map((channel) => ({
        channel,
        used: rows.find((row) => row.channel === channel)?.sentCount ?? 0,
        limit: monthlyLimit(channel, paidLocations),
      })),
    };
  }
}
