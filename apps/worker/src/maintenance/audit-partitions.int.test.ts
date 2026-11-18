import { createDatabaseConnection, sql, type DatabaseConnection } from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_MONTHS_AHEAD, ensureAuditPartitions } from './audit-partitions.js';

/**
 * The worker keeps the audit log's monthly partitions ahead of time, as app_user, through the one
 * SECURITY DEFINER function it is allowed to call.
 */

let database: TestDatabase;
let connection: DatabaseConnection;
/** Stands in for an operator: only the owner can remove a partition. */
let owner: DatabaseConnection;

beforeAll(async () => {
  database = await startTestDatabase();
  connection = createDatabaseConnection(database.urlFor('app_user'));
  owner = createDatabaseConnection(database.urlFor('app_owner'));
});

afterAll(async () => {
  await owner?.close();
  await connection?.close();
  await database?.stop();
});

const monthName = (offset: number) => {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `audit_events_${month.toISOString().slice(0, 7).replace('-', '_')}`;
};

const exists = async (table: string) =>
  (await owner.db.execute<{ t: string | null }>(sql`select to_regclass(${table})::text as t`))
    .rows[0]?.t != null;

/** Detaches and removes one month, as if it had never been prepared. */
async function removeMonth(table: string) {
  await owner.db.execute(sql.raw(`alter table audit_events detach partition ${table}`));
  await owner.db.execute(sql.raw(`drop table ${table}`));
}

describe('ensureAuditPartitions', () => {
  it('has nothing to do right after the migration', async () => {
    expect(await ensureAuditPartitions(connection.db)).toBe(0);
    for (let i = 0; i <= AUDIT_MONTHS_AHEAD; i += 1) {
      expect(await exists(monthName(i)), monthName(i)).toBe(true);
    }
  });

  it('recreates a month that is missing, as app_user', async () => {
    const last = monthName(AUDIT_MONTHS_AHEAD);
    await removeMonth(last);
    expect(await exists(last)).toBe(false);

    expect(await ensureAuditPartitions(connection.db)).toBe(1);
    expect(await exists(last)).toBe(true);
  });

  it('two workers at once create each month exactly once', async () => {
    const last = monthName(AUDIT_MONTHS_AHEAD);
    await removeMonth(last);

    // The first worker has created the month but not committed when the second one starts: the
    // second must wait and then find it, not try to create it again (a duplicate-table error).
    let second: Promise<number> | undefined;
    const first = await connection.db.transaction(async (tx) => {
      const made = await ensureAuditPartitions(tx);
      second = ensureAuditPartitions(connection.db);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return made;
    });
    expect(first).toBe(1);
    expect(await second).toBe(0);
  });
});
