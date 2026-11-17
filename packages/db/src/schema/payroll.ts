import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { employees } from './employees.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * `open` → (an owner approves) → `calculating` → (the worker writes the lines) → `approved`.
 * Approval is a decision, calculation is work: the request records the first and the outbox
 * hands the second to the worker.
 */
export const payPeriodStatus = pgEnum('pay_period_status', ['open', 'calculating', 'approved']);

/**
 * A run of local dates to pay for (W6 D4): picked by a manager, at most 31 days, never
 * overlapping another period of the same organisation (an exclusion constraint, added by hand in
 * migration 0022). Tenant table (RLS).
 */
export const payPeriods = pgTable(
  'pay_periods',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }).notNull(),
    status: payPeriodStatus().notNull().default('open'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamptz(),
    calculatedAt: timestamptz(),
    /** Filled in by the worker with the lines: people paid, minutes, money. */
    employees: integer(),
    paidMinutes: integer(),
    amountMinor: integer(),
  },
  (t) => [
    unique('pay_periods_org_id_id_unique').on(t.orgId, t.id),
    check('pay_periods_dates_ordered', sql`${t.endsOn} >= ${t.startsOn}`),
    check('pay_periods_at_most_31_days', sql`${t.endsOn} - ${t.startsOn} < 31`),
    check(
      'pay_periods_approved_has_approver',
      sql`${t.status} = 'open' or ${t.approvedAt} is not null`,
    ),
    index('pay_periods_org_dates_idx').on(t.orgId, t.startsOn),
  ],
);

/**
 * What an approved period pays: one row per employee, day, kind and rate — `computePay`'s
 * lines, with the rate that was used. Written by the worker in one transaction; recalculating
 * replaces them. Tenant table (RLS).
 */
export const timesheetLines = pgTable(
  'timesheet_lines',
  {
    id: id(),
    orgId: uuid().notNull(),
    payPeriodId: uuid().notNull(),
    employeeId: uuid().notNull(),
    date: date({ mode: 'string' }).notNull(),
    category: text().notNull(),
    night: boolean().notNull(),
    minutes: integer().notNull(),
    multiplierBp: integer().notNull(),
    rateMinor: integer().notNull(),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'timesheet_lines_period_fk',
      columns: [t.orgId, t.payPeriodId],
      foreignColumns: [payPeriods.orgId, payPeriods.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'timesheet_lines_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('restrict'),
    index('timesheet_lines_period_employee_idx').on(t.payPeriodId, t.employeeId, t.date),
    check('timesheet_lines_category', sql`${t.category} in ('regular', 'overtime')`),
    check('timesheet_lines_minutes_positive', sql`${t.minutes} > 0`),
    check('timesheet_lines_multiplier', sql`${t.multiplierBp} >= 10000`),
    check('timesheet_lines_money', sql`${t.rateMinor} >= 0 and ${t.amountMinor} >= 0`),
  ],
);

export type PayPeriodRow = typeof payPeriods.$inferSelect;
export type TimesheetLineRow = typeof timesheetLines.$inferSelect;
