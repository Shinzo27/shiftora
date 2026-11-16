import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { employees } from './employees.js';
import { organizations } from './organizations.js';

/** Where a message can go. `push` is Web Push; the rest are providers (D3/D4). */
export const deliveryChannel = pgEnum('delivery_channel', ['email', 'whatsapp', 'sms', 'push']);

/**
 * A delivery's life: `queued` → `sent` → `delivered`, or `failed` / `skipped`.
 * `skipped` is a decision (no address, opted out, channel not allowed), never an error.
 */
export const deliveryStatus = pgEnum('delivery_status', [
  'queued',
  'sent',
  'delivered',
  'failed',
  'skipped',
]);

/** One message, before it is split into per-person deliveries. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The outbox row that caused this. */
    outboxId: uuid().notNull(),
    /** Who it is for, when that is a staff member. */
    employeeId: uuid(),
    /**
     * Or an address, when the person is not staff yet: an invite goes to an email, and so does a
     * password reset. At least one of the two is always set (CHECK in migration 0013).
     */
    recipientEmail: text(),
    /** `schedule.published`, `shift.reminder`, `attendance.missed`… same vocabulary as the outbox. */
    kind: text().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    /** What the template was rendered from; kept so a message can be explained later. */
    payload: jsonb().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    // Replaying an event cannot notify the same person twice.
    uniqueIndex('notifications_outbox_employee_unique').on(t.outboxId, t.employeeId),
    uniqueIndex('notifications_outbox_email_unique').on(t.outboxId, t.recipientEmail),
    uniqueIndex('notifications_org_id_id_unique').on(t.orgId, t.id),
    foreignKey({
      name: 'notifications_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('cascade'),
    index('notifications_org_created_idx').on(t.orgId, t.createdAt),
    // A notification nobody is addressed to is a message into the void.
    check(
      'notifications_recipient_present',
      sql`employee_id is not null or recipient_email is not null`,
    ),
  ],
);

/** One person, one channel. The unit an adapter actually sends. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: id(),
    orgId: uuid().notNull(),
    notificationId: uuid().notNull(),
    channel: deliveryChannel().notNull(),
    /** Where it goes: an email address or an E.164 number. Null when the channel has none. */
    address: text(),
    status: deliveryStatus().notNull().default('queued'),
    attempts: integer().notNull().default(0),
    /** Why it is where it is — a provider error, or the reason a channel was skipped. */
    lastError: text(),
    sentAt: timestamptz(),
    /**
     * Set when the queue gave up (every retry failed): the dead-letter list is
     * `dead_lettered_at IS NOT NULL`, and a replay clears it.
     */
    deadLetteredAt: timestamptz(),
    /** How many times an owner replayed it; part of the replay's job id, so each is a new job. */
    replays: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'deliveries_notification_fk',
      columns: [t.orgId, t.notificationId],
      foreignColumns: [notifications.orgId, notifications.id],
    }).onDelete('cascade'),
    // Composite, like every other child table: a cross-tenant delivery must be impossible.
    // One row per person per channel per notification: the fan-out cannot duplicate itself.
    uniqueIndex('deliveries_notification_channel_unique').on(t.notificationId, t.channel),
    index('deliveries_status_idx').on(t.orgId, t.status),
    // The dead-letter page reads only these rows; the index stays as small as the problem.
    index('deliveries_dead_letter_idx')
      .on(t.orgId, t.deadLetteredAt)
      .where(sql`dead_lettered_at is not null`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
