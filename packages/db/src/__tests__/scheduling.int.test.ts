import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../schema/columns.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

// Org A (Asha) and org B (Ravi), each with one location and one job role.
const ASHA = newId();
const RAVI = newId();
const ORG_A = newId();
const ORG_B = newId();
const LOC_A = newId();
const LOC_B = newId();
const ROLE_A = newId();
const ROLE_B = newId();

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

const asA = <T>(fn: () => Promise<T>, options?: { commit?: boolean }) =>
  as({ user: ASHA, org: ORG_A }, fn, options);

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

interface TemplateValues {
  id?: string;
  location?: string;
  role?: string | null;
  name?: string;
  start?: string;
  end?: string;
  breakMinutes?: number;
}

function insertTemplate(values: TemplateValues = {}) {
  return db.query(
    `insert into shift_templates
       (id, org_id, location_id, name, start_time, end_time, break_minutes, job_role_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      values.id ?? newId(),
      ORG_A,
      values.location ?? LOC_A,
      values.name ?? `Template ${newId()}`,
      values.start ?? '07:00',
      values.end ?? '15:00',
      values.breakMinutes ?? 0,
      values.role === undefined ? ROLE_A : values.role,
    ],
  );
}

function insertSchedule(weekStart: string, location = LOC_A) {
  return db.query(
    `insert into schedules (id, org_id, location_id, week_start) values ($1, $2, $3, $4)`,
    [newId(), ORG_A, location, weekStart],
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
  for (const [org, user, location, role] of [
    [ORG_A, ASHA, LOC_A, ROLE_A],
    [ORG_B, RAVI, LOC_B, ROLE_B],
  ] as const) {
    await as(
      { user, org },
      async () => {
        await db.query('insert into organizations (id, name) values ($1, $2)', [org, 'Clinic']);
        await db.query(
          `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'owner')`,
          [newId(), org, user],
        );
        await db.query(
          `insert into locations (id, org_id, name, latitude, longitude, radius_m, timezone)
           values ($1, $2, 'Main', 19.07, 72.87, 100, 'Asia/Kolkata')`,
          [location, org],
        );
        await db.query(`insert into job_roles (id, org_id, name) values ($1, $2, 'Nurse')`, [
          role,
          org,
        ]);
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
  it("rejects a template at another org's location", async () => {
    await expect(asA(() => insertTemplate({ location: LOC_B }))).rejects.toSatisfy(
      (e) => pgCode(e) === '23503',
    );
  });

  it("rejects a template for another org's job role", async () => {
    await expect(asA(() => insertTemplate({ role: ROLE_B }))).rejects.toSatisfy(
      (e) => pgCode(e) === '23503',
    );
  });

  it("rejects a schedule for another org's location", async () => {
    await expect(asA(() => insertSchedule('2026-11-09', LOC_B))).rejects.toSatisfy(
      (e) => pgCode(e) === '23503',
    );
  });
});

describe('shift_templates constraints', () => {
  it('accepts an overnight template', async () => {
    await expect(
      asA(() => insertTemplate({ start: '22:00', end: '06:00', breakMinutes: 30 })),
    ).resolves.toBeDefined();
  });

  it.each([
    ['equal start and end', { start: '09:00', end: '09:00' }],
    ['a negative break', { breakMinutes: -5 }],
    ['a break over 240 minutes', { breakMinutes: 300 }],
  ])('rejects %s', async (_label, values: TemplateValues) => {
    await expect(asA(() => insertTemplate(values))).rejects.toSatisfy(
      (e) => pgCode(e) === '23514', // check_violation
    );
  });

  it('keeps names unique per location, ignoring case', async () => {
    await expect(
      asA(async () => {
        await insertTemplate({ name: 'Morning' });
        await insertTemplate({ name: 'MORNING' });
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === '23505');
  });

  it('deleting a job role clears it from templates and keeps the template', async () => {
    const template = newId();
    const role = newId();
    const after = await asA(async () => {
      await db.query(`insert into job_roles (id, org_id, name) values ($1, $2, 'Cleaner')`, [
        role,
        ORG_A,
      ]);
      await insertTemplate({ id: template, role });
      await db.query('delete from job_roles where id = $1', [role]);
      const rows = await db.query<{ org_id: string; job_role_id: string | null }>(
        'select org_id, job_role_id from shift_templates where id = $1',
        [template],
      );
      return rows.rows[0];
    });
    // Only job_role_id is nulled; org_id stays (SET NULL (job_role_id), see 0005).
    expect(after).toEqual({ org_id: ORG_A, job_role_id: null });
  });
});

describe('schedules constraints', () => {
  it('accepts a Monday and rejects any other weekday', async () => {
    await expect(asA(() => insertSchedule('2026-11-09'))).resolves.toBeDefined();
    await expect(asA(() => insertSchedule('2026-11-11'))).rejects.toSatisfy(
      (e) => pgCode(e) === '23514',
    );
  });

  it('allows one schedule per location and week', async () => {
    await expect(
      asA(async () => {
        await insertSchedule('2026-11-16');
        await insertSchedule('2026-11-16');
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === '23505');
  });

  it('a published schedule must say when it was published', async () => {
    await expect(
      asA(() =>
        db.query(
          `insert into schedules (id, org_id, location_id, week_start, status)
           values ($1, $2, $3, '2026-11-23', 'published')`,
          [newId(), ORG_A, LOC_A],
        ),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === '23514');
  });

  it("org B can't see org A's schedules", async () => {
    await asA(() => insertSchedule('2026-11-30'), { commit: true });
    const seen = await as(
      { user: RAVI, org: ORG_B },
      async () => (await db.query<{ id: string }>('select id from schedules')).rows,
    );
    expect(seen).toEqual([]);
  });
});
