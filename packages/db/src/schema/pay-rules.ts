import type { PayRules } from '@shiftora/domain';
import { sql } from 'drizzle-orm';
import { check, date, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * An organisation's pay rules, one row per version (W6 D1; rules as data, PRD A4).
 *
 * Versions are **immutable** — the migration revokes UPDATE from the app's role — and start on a
 * local date: a change is a new version from a later date, so recalculating an old period uses
 * the rules that were in force then (`rulesInForce`). No rows = plain hourly pay (owner's
 * decision: Shiftora never assumes a labour-law rule). Tenant table (RLS).
 */
export const payRules = pgTable(
  'pay_rules',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    /** Validated by `payRules` in packages/shared before it is stored. */
    rules: jsonb().$type<PayRules>().notNull(),
    note: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('pay_rules_org_version_unique').on(t.orgId, t.version),
    unique('pay_rules_org_effective_unique').on(t.orgId, t.effectiveFrom),
    check('pay_rules_version_positive', sql`${t.version} >= 1`),
  ],
);

export type PayRulesRow = typeof payRules.$inferSelect;
