import { foreignKey, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from './columns.js';
import { shifts } from './shifts.js';

/** The two things the minute-by-minute scan tells people about a shift. */
export const shiftAlertKind = pgEnum('shift_alert_kind', ['reminder', 'missed_clock_in']);

/**
 * "This shift's reminder (or missed clock-in alert) has been raised." One row per shift and kind.
 *
 * The worker scans every minute, and the same shift sits in the reminder window for two hours,
 * so without this every scan would remind again. The scan inserts here and writes the outbox
 * event **in the same transaction**, and only for rows the insert actually created
 * (`ON CONFLICT DO NOTHING … RETURNING`): two workers scanning at once raise one alert.
 *
 * Tenant table (RLS). Deleting the shift removes its alerts.
 */
export const shiftAlerts = pgTable(
  'shift_alerts',
  {
    orgId: uuid().notNull(),
    shiftId: uuid().notNull(),
    kind: shiftAlertKind().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'shift_alerts_pk', columns: [t.orgId, t.shiftId, t.kind] }),
    foreignKey({
      name: 'shift_alerts_shift_fk',
      columns: [t.orgId, t.shiftId],
      foreignColumns: [shifts.orgId, shifts.id],
    }).onDelete('cascade'),
  ],
);

export type ShiftAlertRow = typeof shiftAlerts.$inferSelect;
