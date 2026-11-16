import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from './columns.js';
import { deliveryChannel } from './notifications.js';
import { organizations } from './organizations.js';

/**
 * Paid messages (WhatsApp, SMS) counted per org, month and channel: the monthly quota.
 *
 * The worker reserves a message before sending with one conditional upsert — the increment only
 * happens while `sent_count` is under the limit — so two workers racing for the last message of
 * the month cannot both win. A failed send gives its reservation back.
 *
 * Tenant table (RLS).
 */
export const messageUsage = pgTable(
  'message_usage',
  {
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Quota month on the billing calendar (Asia/Kolkata), "YYYY-MM". */
    month: text().notNull(),
    channel: deliveryChannel().notNull(),
    sentCount: integer().notNull().default(0),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'message_usage_pk', columns: [t.orgId, t.month, t.channel] }),
    check('message_usage_month_format', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    // Only channels that cost money are counted.
    check('message_usage_paid_channel', sql`${t.channel} in ('whatsapp', 'sms')`),
    check('message_usage_count_positive', sql`${t.sentCount} >= 0`),
  ],
);

export type MessageUsageRow = typeof messageUsage.$inferSelect;
