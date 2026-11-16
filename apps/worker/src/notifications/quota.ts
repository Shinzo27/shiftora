import { and, count, eq, schema, sql, type Database } from '@shiftora/db';
import { monthlyLimit, usageMonth, type PaidChannel } from '@shiftora/domain';

import { setOrg } from './fan-out.js';

export interface Reservation {
  reserved: boolean;
  limit: number;
  month: string;
}

/**
 * Takes one paid message out of the org's monthly quota, or says there is none left.
 *
 * One conditional upsert: the row is created at 1, or incremented **only while** it is under the
 * limit, and `returning` tells us which. Two workers racing for the last message both run the
 * same statement; Postgres locks the row, so exactly one gets a row back. Checking first and
 * incrementing after would let both through.
 *
 * Until billing exists (W8), every active location counts as paid; read-only locations do not.
 */
export async function reserveMessage(
  db: Database,
  orgId: string,
  channel: PaidChannel,
  now: Date,
): Promise<Reservation> {
  const month = usageMonth(now);
  return db.transaction(async (tx) => {
    await setOrg(tx, orgId);
    const [locations] = await tx
      .select({ active: count() })
      .from(schema.locations)
      .where(and(eq(schema.locations.orgId, orgId), eq(schema.locations.status, 'active')));
    const limit = monthlyLimit(channel, locations?.active ?? 0);
    if (limit <= 0) return { reserved: false, limit, month };

    const result = await tx.execute<{ sent_count: number }>(sql`
      insert into message_usage (org_id, month, channel, sent_count)
      values (${orgId}, ${month}, ${channel}, 1)
      on conflict (org_id, month, channel) do update
        set sent_count = message_usage.sent_count + 1, updated_at = now()
        where message_usage.sent_count < ${limit}
      returning sent_count`);
    return { reserved: result.rows.length > 0, limit, month };
  });
}

/** Gives a reservation back after a send that did not happen (the provider refused it). */
export async function releaseMessage(
  db: Database,
  orgId: string,
  channel: PaidChannel,
  month: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await setOrg(tx, orgId);
    await tx
      .update(schema.messageUsage)
      .set({ sentCount: sql`greatest(${schema.messageUsage.sentCount} - 1, 0)` })
      .where(
        and(
          eq(schema.messageUsage.orgId, orgId),
          eq(schema.messageUsage.month, month),
          eq(schema.messageUsage.channel, channel),
        ),
      );
  });
}
