import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/**
 * Primary key: UUIDv7, generated in the app. v7 ids start with a timestamp, so new rows
 * land at the end of the index (fast inserts) and ids sort by creation time.
 * Postgres 16 has no built-in uuidv7(), hence the app-side default.
 */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => newId());

/** A new UUIDv7, for when the app needs an id before inserting (e.g. to reference it). */
export function newId(): string {
  return uuidv7();
}

/** Case-insensitive text (extension enabled in 0000_foundation). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Every table stores instants as timestamptz (AGENTS.md → Time). */
export const timestamptz = () => timestamp({ withTimezone: true });

export const timestamps = {
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
