import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../schema/columns.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

// Org A (Asha) and org B (Ravi), each with one location.
const ASHA = newId();
const RAVI = newId();
const ORG_A = newId();
const ORG_B = newId();
const LOC_A = newId();
const LOC_B = newId();

let database: TestDatabase;
let db: pg.Client;

async function as<T>(
  context: { user: string; org: string },
  fn: () => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  await db.query('begin');
  try {
    await db.query(
      "select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)",
      [context.user, context.org],
    );
    const result = await fn();
    await db.query(commit ? 'commit' : 'rollback');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function insertLocation(
  id: string,
  org: string,
  name: string,
  values: { lat?: number; lng?: number; radius?: number } = {},
) {
  return db.query(
    `insert into locations (id, org_id, name, latitude, longitude, radius_m, timezone)
     values ($1, $2, $3, $4, $5, $6, 'Asia/Kolkata')`,
    [id, org, name, values.lat ?? 19.07, values.lng ?? 72.87, values.radius ?? 100],
  );
}

function insertDepartment(org: string, location: string) {
  return db.query(
    `insert into departments (id, org_id, location_id, name) values ($1, $2, $3, 'OPD')`,
    [newId(), org, location],
  );
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
  for (const [org, user, location] of [
    [ORG_A, ASHA, LOC_A],
    [ORG_B, RAVI, LOC_B],
  ] as const) {
    await as(
      { user, org },
      async () => {
        await db.query('insert into organizations (id, name) values ($1, $2)', [org, 'Clinic']);
        await db.query(
          `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'owner')`,
          [newId(), org, user],
        );
        await insertLocation(location, org, 'Main branch');
      },
      { commit: true },
    );
  }
});

afterAll(async () => {
  await db?.end();
  await database?.stop();
});

describe('same-org foreign keys', () => {
  it("rejects a department in my org that points at another org's location", async () => {
    // RLS allows the row (org_id is mine), and a plain FK would allow LOC_B (it exists).
    // The composite (org_id, location_id) key is what stops it.
    await expect(
      as({ user: ASHA, org: ORG_A }, () => insertDepartment(ORG_A, LOC_B)),
    ).rejects.toSatisfy((e) => pgCode(e) === '23503'); // foreign_key_violation
  });

  it("rejects scoping a member to another org's location", async () => {
    await expect(
      as({ user: ASHA, org: ORG_A }, () =>
        db.query(
          `insert into membership_locations (org_id, user_id, location_id) values ($1, $2, $3)`,
          [ORG_A, ASHA, LOC_B],
        ),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === '23503');
  });

  it("rejects giving my employee another org's job role (0004)", async () => {
    const roleB = newId();
    await as(
      { user: RAVI, org: ORG_B },
      () =>
        db.query(`insert into job_roles (id, org_id, name) values ($1, $2, 'Surgeon')`, [
          roleB,
          ORG_B,
        ]),
      { commit: true },
    );
    await expect(
      as({ user: ASHA, org: ORG_A }, async () => {
        const employee = newId();
        await db.query(`insert into employees (id, org_id, name) values ($1, $2, 'Nina')`, [
          employee,
          ORG_A,
        ]);
        await db.query(
          `insert into employee_job_roles (org_id, employee_id, job_role_id) values ($1, $2, $3)`,
          [ORG_A, employee, roleB],
        );
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === '23503');
  });

  it('accepts a department at my own location', async () => {
    await expect(
      as({ user: ASHA, org: ORG_A }, () => insertDepartment(ORG_A, LOC_A)),
    ).resolves.toBeDefined();
  });
});

describe('locations constraints', () => {
  it.each([
    ['latitude above 90', { lat: 91 }],
    ['longitude below -180', { lng: -181 }],
    ['radius under 25 m', { radius: 10 }],
    ['radius over 1000 m', { radius: 5000 }],
  ])('rejects %s', async (_label, values) => {
    await expect(
      as({ user: ASHA, org: ORG_A }, () => insertLocation(newId(), ORG_A, 'Bad', values)),
    ).rejects.toSatisfy((e) => pgCode(e) === '23514'); // check_violation
  });

  it('keeps location names unique per org, ignoring case', async () => {
    await expect(
      as({ user: ASHA, org: ORG_A }, () => insertLocation(newId(), ORG_A, 'MAIN BRANCH')),
    ).rejects.toSatisfy((e) => pgCode(e) === '23505'); // unique_violation
    // The same name in another org is fine.
    await expect(
      as({ user: RAVI, org: ORG_B }, () => insertLocation(newId(), ORG_B, 'Second branch')),
    ).resolves.toBeDefined();
  });

  it('allows the same job role name in two different orgs', async () => {
    for (const [user, org] of [
      [ASHA, ORG_A],
      [RAVI, ORG_B],
    ] as const) {
      await expect(
        as({ user, org }, () =>
          db.query(`insert into job_roles (id, org_id, name) values ($1, $2, 'Nurse')`, [
            newId(),
            org,
          ]),
        ),
      ).resolves.toBeDefined();
    }
  });
});

describe('location scopes follow the membership', () => {
  it('removing a membership removes its location scopes', async () => {
    const nurse = newId();
    await db.query(
      `insert into users (id, email, name, password_hash) values ($1, 'nurse@x.com', 'N', 'x')`,
      [nurse],
    );
    const remaining = await as({ user: ASHA, org: ORG_A }, async () => {
      await db.query(
        `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'employee')`,
        [newId(), ORG_A, nurse],
      );
      await db.query(
        `insert into membership_locations (org_id, user_id, location_id) values ($1, $2, $3)`,
        [ORG_A, nurse, LOC_A],
      );
      await db.query('delete from memberships where org_id = $1 and user_id = $2', [ORG_A, nurse]);
      const scopes = await db.query('select * from membership_locations where user_id = $1', [
        nurse,
      ]);
      return scopes.rowCount;
    });
    expect(remaining).toBe(0);
  });
});
