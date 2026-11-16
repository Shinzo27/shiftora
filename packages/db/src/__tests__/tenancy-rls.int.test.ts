import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../schema/columns.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

// Two orgs, each with one owner; Asha is also an employee in org B.
const ASHA = newId();
const RAVI = newId();
const ORG_A = newId();
const ORG_B = newId();

let database: TestDatabase;
let db: pg.Client;

/** Runs `fn` in a transaction as app_user with the given context, then rolls back. */
async function as<T>(
  context: { user?: string; org?: string },
  fn: () => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  await db.query('begin');
  try {
    await db.query(
      "select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)",
      [context.user ?? '', context.org ?? ''],
    );
    const result = await fn();
    await db.query(commit ? 'commit' : 'rollback');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function rows<T extends pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return (await db.query<T>(text, params)).rows;
}

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = new pg.Client({ connectionString: database.urlFor('app_user') });
  await db.connect();

  await db.query(
    `insert into users (id, email, name, password_hash)
     values ($1, 'asha@x.com', 'Asha', 'x'), ($2, 'ravi@x.com', 'Ravi', 'x')`,
    [ASHA, RAVI],
  );
  // Creating an org: the context must already point at the new org (WITH CHECK).
  for (const [org, owner, name] of [
    [ORG_A, ASHA, 'Clinic A'],
    [ORG_B, RAVI, 'Clinic B'],
  ] as const) {
    await as(
      { user: owner, org },
      async () => {
        await db.query('insert into organizations (id, name) values ($1, $2)', [org, name]);
        await db.query(
          `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'owner')`,
          [newId(), org, owner],
        );
        await db.query(
          `insert into invites (id, org_id, email, role, token_hash, invited_by, expires_at)
           values ($1, $2, $3, 'employee', $4, $5, now() + interval '7 days')`,
          [newId(), org, `new@${name}.com`, `hash-${org}`, owner],
        );
      },
      { commit: true },
    );
  }
  await as(
    { user: RAVI, org: ORG_B },
    () =>
      db.query(
        `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'employee')`,
        [newId(), ORG_B, ASHA],
      ),
    { commit: true },
  );
});

afterAll(async () => {
  await db?.end();
  await database?.stop();
});

describe('every tenant table is protected', () => {
  it('has RLS enabled AND forced, plus at least one policy, on every table with org_id', async () => {
    const tables = await rows<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(
      `select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (exists (select 1 from information_schema.columns col
                      where col.table_name = c.relname and col.column_name = 'org_id')
              or c.relname = 'organizations')
       order by 1`,
    );

    // Adding a tenant table? Add it here too, after giving it RLS in its migration.
    expect(tables.map((t) => t.table)).toEqual([
      'audit_events',
      'availability',
      'deliveries',
      'departments',
      'employee_job_roles',
      'employee_locations',
      'employees',
      'invites',
      'job_roles',
      'locations',
      'membership_locations',
      'memberships',
      'message_usage',
      'notifications',
      'organizations',
      'outbox',
      'push_subscriptions',
      'schedule_publications',
      'schedules',
      'shift_alerts',
      'shift_templates',
      'shifts',
      'time_entries',
      'time_off',
    ]);
    for (const t of tables) {
      expect(t, t.table).toMatchObject({ enabled: true, forced: true });
      expect(t.policies, t.table).toBeGreaterThan(0);
    }
  });
});

describe('with no context set', () => {
  it('sees nothing at all', async () => {
    await as({}, async () => {
      for (const table of ['organizations', 'memberships', 'invites', 'audit_events']) {
        expect(await rows(`select * from ${table}`), table).toEqual([]);
      }
    });
  });
});

describe('with org A selected', () => {
  it('sees only org A rows, even without a WHERE clause', async () => {
    await as({ user: ASHA, org: ORG_A }, async () => {
      const orgs = await rows<{ id: string }>('select id from organizations');
      expect(orgs.map((r) => r.id)).toContain(ORG_A);
      // Ravi's membership lives in org B, so it must not show up here.
      expect(await rows('select org_id from memberships where user_id <> $1', [ASHA])).toEqual([]);
      const invites = await rows<{ org_id: string }>('select org_id from invites');
      expect(invites.map((r) => r.org_id)).toEqual([ORG_A]);
    });
  });

  it('cannot write a row into org B (WITH CHECK)', async () => {
    await expect(
      as({ user: ASHA, org: ORG_A }, () =>
        db.query(
          `insert into invites (id, org_id, email, role, token_hash, invited_by, expires_at)
           values ($1, $2, 'sneaky@x.com', 'owner', 'h', $3, now())`,
          [newId(), ORG_B, ASHA],
        ),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === '42501'); // insufficient_privilege (RLS violation)
  });

  it('cannot change org B rows: they are invisible, so 0 rows are affected', async () => {
    await as({ user: ASHA, org: ORG_A }, async () => {
      const updated = await db.query('update invites set revoked_at = now() where org_id = $1', [
        ORG_B,
      ]);
      const removed = await db.query('delete from memberships where org_id = $1', [ORG_B]);
      expect([updated.rowCount, removed.rowCount]).toEqual([0, 0]);
    });
  });
});

describe('with only a user set (no org selected)', () => {
  it('lets a user read their own memberships and orgs across orgs, and nothing else', async () => {
    await as({ user: ASHA }, async () => {
      const memberships = await rows<{ org_id: string; role: string }>(
        // role is an enum: it sorts in declaration order (owner, manager, employee, kiosk)
        'select org_id, role from memberships order by role',
      );
      expect(memberships).toEqual([
        { org_id: ORG_A, role: 'owner' },
        { org_id: ORG_B, role: 'employee' },
      ]);
      const orgs = await rows<{ name: string }>('select name from organizations order by name');
      expect(orgs.map((o) => o.name)).toEqual(['Clinic A', 'Clinic B']);
      expect(await rows('select * from invites')).toEqual([]);
    });
  });

  it("does not reveal other people's memberships", async () => {
    await as({ user: RAVI }, async () => {
      const memberships = await rows<{ user_id: string }>('select user_id from memberships');
      expect(new Set(memberships.map((m) => m.user_id))).toEqual(new Set([RAVI]));
    });
  });
});

describe('audit_events', () => {
  it('is append-only for app_user (UPDATE and DELETE are refused)', async () => {
    const eventId = newId();
    await as(
      { user: ASHA, org: ORG_A },
      () =>
        db.query(
          `insert into audit_events (id, org_id, actor_user_id, action, entity, entity_id)
           values ($1, $2, $3, 'test.created', 'test', $1)`,
          [eventId, ORG_A, ASHA],
        ),
      { commit: true },
    );

    await expect(
      as({ user: ASHA, org: ORG_A }, () => db.query('update audit_events set action = $1', ['x'])),
    ).rejects.toSatisfy((e) => pgCode(e) === '42501');
    await expect(
      as({ user: ASHA, org: ORG_A }, () => db.query('delete from audit_events')),
    ).rejects.toSatisfy((e) => pgCode(e) === '42501');
  });
});
