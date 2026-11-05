import { pgTable, text } from 'drizzle-orm/pg-core';

import { citext, id, timestamps, timestamptz } from './columns.js';

/**
 * A person who can log in. Platform-level table: no org_id and no RLS, because one person
 * can belong to several organisations (memberships arrive in week 1, day 4).
 */
export const users = pgTable('users', {
  id: id(),
  email: citext().notNull().unique('users_email_unique'),
  name: text().notNull(),
  /** argon2id PHC string, e.g. "$argon2id$v=19$m=19456,t=2,p=1$…". Never returned by the API. */
  passwordHash: text().notNull(),
  emailVerifiedAt: timestamptz(),
  ...timestamps,
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
