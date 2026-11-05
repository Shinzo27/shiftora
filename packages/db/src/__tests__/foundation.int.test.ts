import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrate.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

const ORG_ID = '0193a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';

let database: TestDatabase;
let appUser: pg.Client;

async function currentOrgId(client: pg.Client): Promise<string | null> {
  const { rows } = await client.query<{ org: string | null }>('select current_org_id() as org');
  return rows[0]?.org ?? null;
}

beforeAll(async () => {
  database = await startTestDatabase();
  appUser = new pg.Client({ connectionString: database.urlFor('app_user') });
  await appUser.connect();
});

afterAll(async () => {
  await appUser?.end();
  await database?.stop();
});

describe('0000_foundation', () => {
  it('app_user is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await appUser.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('installs btree_gist and citext', async () => {
    const { rows } = await appUser.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('btree_gist', 'citext') order by 1",
    );
    expect(rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext']);
  });

  it('current_org_id() is NULL when no tenant is set', async () => {
    expect(await currentOrgId(appUser)).toBeNull();
  });

  it('current_org_id() returns the tenant only inside the transaction that set it', async () => {
    await appUser.query('begin');
    await appUser.query("select set_config('app.org_id', $1, true)", [ORG_ID]);
    expect(await currentOrgId(appUser)).toBe(ORG_ID);
    await appUser.query('commit');

    // Same pooled connection, next request: the tenant must not leak.
    expect(await currentOrgId(appUser)).toBeNull();
  });

  it('can run again without changes (already-applied migrations are skipped)', async () => {
    await expect(runMigrations(database.urlFor('app_owner'))).resolves.toBeUndefined();
  });
});
