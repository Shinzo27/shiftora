import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { employees } from './employees.js';
import { organizations } from './organizations.js';

/**
 * One browser's Web Push subscription, for one staff member.
 *
 * The endpoint is minted by the browser's push service (FCM, Mozilla, Apple), and `p256dh`/`auth`
 * are the keys the payload is encrypted with — the server never sees a token that could be
 * replayed anywhere else. `endpoint` is unique across the table because a browser that moves
 * between accounts must move its subscription, not duplicate it.
 *
 * Tenant table (RLS): a subscription belongs to a member of staff at a clinic.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employeeId: uuid().notNull(),
    /** The push service URL. Long, and the only address a push is sent to. */
    endpoint: text().notNull(),
    /** Base64url public key of the browser's subscription (P-256). */
    p256dh: text().notNull(),
    /** Base64url auth secret for the same subscription. */
    auth: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'push_subscriptions_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('cascade'),
    uniqueIndex('push_subscriptions_endpoint_unique').on(t.endpoint),
    index('push_subscriptions_employee_idx').on(t.orgId, t.employeeId),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export { employees };
