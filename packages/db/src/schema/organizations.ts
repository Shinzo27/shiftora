import { pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps } from './columns.js';

/**
 * The tenant. Its RLS policy compares `id` (not org_id) with current_org_id(), and also lets
 * members see orgs they belong to, so "list my organisations" works without an org selected.
 */
export const organizations = pgTable('organizations', {
  id: id(),
  name: text().notNull(),
  ...timestamps,
});

export type OrganizationRow = typeof organizations.$inferSelect;
