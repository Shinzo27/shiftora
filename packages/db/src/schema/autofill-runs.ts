import { check, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { id, timestamptz } from './columns.js';
import { organizations } from './organizations.js';

/**
 * One run of the auto-scheduler against one week (W7 D3).
 *
 * The solver is a job, not a request: it can take a second or two, and the manager should see
 * something happen while it does. The row is the record of that run — what it filled, what it
 * could not, and the sentence explaining why — and the worker updates it as it goes, so a page
 * that reloads can still see the outcome.
 */
export const autofillRuns = pgTable(
  'autofill_runs',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scheduleId: uuid().notNull(),
    /** queued → running → succeeded | failed. Text with a CHECK, like the other small enums. */
    status: text().notNull().default('queued'),
    /** Which path the solver took: `greedy` or `greedy+backtracking`. */
    strategy: text(),
    assigned: integer().notNull().default(0),
    /** The slots nobody could take, with their blockers and explanations. */
    unfilled: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    score: jsonb(),
    error: text(),
    createdBy: uuid(),
    createdAt: timestamptz().notNull().defaultNow(),
    finishedAt: timestamptz(),
  },
  (t) => [
    check(
      'autofill_runs_status_check',
      sql`${t.status} in ('queued', 'running', 'succeeded', 'failed')`,
    ),
  ],
);

export type AutofillRunRow = typeof autofillRuns.$inferSelect;
