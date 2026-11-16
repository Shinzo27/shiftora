import { and, eq, schema, sql, type Database } from '@shiftora/db';
import { applyProviderReport, usageMonth, type ChannelPolicy } from '@shiftora/domain';
import type { DeliveryReportedEvent } from '@shiftora/shared';

import { setOrg } from './fan-out.js';
import { createFallback } from './fallback.js';
import { releaseMessage } from './quota.js';

export interface ReportsOutcome {
  /** Reports that moved a delivery forward (delivered, read) or failed it. */
  applied: number;
  /** Reports that changed nothing: duplicates, out-of-order, or about a skipped delivery. */
  ignored: number;
  /** Reports for a message id we never sent (another environment's number, or a stale id). */
  unknown: number;
  /** Fallback deliveries created after a late failure, for the caller to queue. */
  fallbacks: { deliveryId: string; orgId: string }[];
}

const LABEL = { whatsapp: 'WhatsApp', sms: 'SMS' } as const;

/**
 * Applies a provider's delivery reports (a `delivery.reported` event, written by the API after
 * it verified the webhook's signature).
 *
 * A report names a message by the provider's id and nothing else, so the first step is the one
 * cross-tenant read: find which org's delivery that is (`app.provider_report`, migration 0017,
 * ADR 019). Everything after that runs under that org's context, row-locked, so two copies of
 * the same report — providers resend — cannot both apply.
 *
 * A late failure (accepted, then "undeliverable") is treated like a permanent send error: the
 * delivery is failed with the provider's reason, the paid message goes back to the quota (it was
 * never delivered, so it is not billed), and the message moves down the person's ladder.
 */
export async function applyDeliveryReports(
  db: Database,
  event: DeliveryReportedEvent,
  usable: ChannelPolicy,
  now: Date = new Date(),
): Promise<ReportsOutcome> {
  const outcome: ReportsOutcome = { applied: 0, ignored: 0, unknown: 0, fallbacks: [] };

  for (const report of event.reports) {
    const target = await findDelivery(db, event.channel, report.messageId);
    if (!target) {
      outcome.unknown += 1;
      continue;
    }

    const change = await db.transaction(async (tx) => {
      await setOrg(tx, target.orgId);
      const [row] = await tx
        .select({
          status: schema.deliveries.status,
          deliveredAt: schema.deliveries.deliveredAt,
          readAt: schema.deliveries.readAt,
          sentAt: schema.deliveries.sentAt,
        })
        .from(schema.deliveries)
        .where(and(eq(schema.deliveries.orgId, target.orgId), eq(schema.deliveries.id, target.id)))
        .for('update');
      if (!row) return null;

      const next = applyProviderReport(row, {
        status: report.status,
        at: new Date(report.at),
        ...(report.error ? { error: report.error } : {}),
      });
      if (!next) return null;

      if (next.kind === 'progress') {
        await tx
          .update(schema.deliveries)
          .set({ status: 'delivered', deliveredAt: next.deliveredAt, readAt: next.readAt })
          .where(eq(schema.deliveries.id, target.id));
      } else {
        await tx
          .update(schema.deliveries)
          .set({ status: 'failed', lastError: `${LABEL[event.channel]}: ${next.reason}` })
          .where(eq(schema.deliveries.id, target.id));
      }
      return { kind: next.kind, sentAt: row.sentAt };
    });

    if (!change) {
      outcome.ignored += 1;
      continue;
    }
    outcome.applied += 1;

    if (change.kind === 'failed') {
      await releaseMessage(db, target.orgId, event.channel, usageMonth(change.sentAt ?? now));
      const fallbackId = await createFallback(db, target.orgId, target.id, usable);
      if (fallbackId) outcome.fallbacks.push({ deliveryId: fallbackId, orgId: target.orgId });
    }
  }

  return outcome;
}

/** The one cross-tenant read: which org's delivery carries this provider message id. */
async function findDelivery(
  db: Database,
  channel: 'whatsapp' | 'sms',
  messageId: string,
): Promise<{ id: string; orgId: string } | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.provider_report', 'on', true)`);
    const [row] = await tx
      .select({ id: schema.deliveries.id, orgId: schema.deliveries.orgId })
      .from(schema.deliveries)
      .where(
        and(
          eq(schema.deliveries.channel, channel),
          eq(schema.deliveries.providerMessageId, messageId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}
