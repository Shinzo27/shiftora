import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '../schema/columns.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

// Org A has two locations (a second branch in another zone) and two employees;
// org B exists to prove cross-org writes are refused by the same foreign keys.
const ASHA = newId();
const RAVI = newId();
const ORG_A = newId();
const ORG_B = newId();
const LOC_A = newId();
const LOC_A2 = newId();
const LOC_B = newId();
const ROLE_A = newId();
const EMP_A = newId();
const EMP_A2 = newId();
const EMP_B = newId();
const SCHED_A = newId();
const SCHED_A2 = newId();
const SCHED_B = newId();

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

interface ShiftValues {
  id?: string;
  schedule?: string;
  location?: string;
  employee?: string | null;
  role?: string | null;
  start?: string;
  end?: string;
  breakMinutes?: number;
  status?: 'open' | 'assigned' | 'cancelled';
}

/** Inserts a shift as app_user in org A. Status follows the assignee unless given. */
function insertShift(values: ShiftValues = {}) {
  const employee = values.employee === undefined ? EMP_A : values.employee;
  return db.query(
    `insert into shifts
       (id, org_id, schedule_id, location_id, job_role_id, employee_id,
        starts_at, ends_at, break_minutes, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      values.id ?? newId(),
      ORG_A,
      values.schedule ?? SCHED_A,
      values.location ?? LOC_A,
      values.role === undefined ? ROLE_A : values.role,
      employee,
      values.start ?? '2026-11-09T02:30:00Z',
      values.end ?? '2026-11-09T10:30:00Z',
      values.breakMinutes ?? 0,
      values.status ?? (employee ? 'assigned' : 'open'),
    ],
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
  for (const [org, user] of [
    [ORG_A, ASHA],
    [ORG_B, RAVI],
  ] as const) {
    await as(
      { user, org },
      async () => {
        await db.query('insert into organizations (id, name) values ($1, $2)', [org, 'Clinic']);
        await db.query(
          `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'owner')`,
          [newId(), org, user],
        );
      },
      { commit: true },
    );
  }

  await asA(
    async () => {
      for (const [id, name, zone] of [
        [LOC_A, 'Andheri', 'Asia/Kolkata'],
        [LOC_A2, 'Soho', 'Europe/London'],
      ] as const) {
        await db.query(
          `insert into locations (id, org_id, name, latitude, longitude, radius_m, timezone)
           values ($1, $2, $3, 19.07, 72.87, 100, $4)`,
          [id, ORG_A, name, zone],
        );
      }
      await db.query(`insert into job_roles (id, org_id, name) values ($1, $2, 'Nurse')`, [
        ROLE_A,
        ORG_A,
      ]);
      for (const id of [EMP_A, EMP_A2]) {
        await db.query(
          `insert into employees (id, org_id, name, hourly_rate_minor, max_weekly_minutes, min_rest_minutes)
           values ($1, $2, 'Staff', 25000, 2880, 660)`,
          [id, ORG_A],
        );
      }
      for (const [id, location] of [
        [SCHED_A, LOC_A],
        [SCHED_A2, LOC_A2],
      ] as const) {
        await db.query(
          `insert into schedules (id, org_id, location_id, week_start)
           values ($1, $2, $3, '2026-11-09')`,
          [id, ORG_A, location],
        );
      }
    },
    { commit: true },
  );

  await as(
    { user: RAVI, org: ORG_B },
    async () => {
      await db.query(
        `insert into locations (id, org_id, name, latitude, longitude, radius_m, timezone)
         values ($1, $2, 'Other', 19.07, 72.87, 100, 'Asia/Kolkata')`,
        [LOC_B, ORG_B],
      );
      await db.query(`insert into employees (id, org_id, name) values ($1, $2, 'Outsider')`, [
        EMP_B,
        ORG_B,
      ]);
      await db.query(
        `insert into schedules (id, org_id, location_id, week_start)
         values ($1, $2, $3, '2026-11-09')`,
        [SCHED_B, ORG_B, LOC_B],
      );
    },
    { commit: true },
  );
});

afterAll(async () => {
  await db?.end();
  await database?.stop();
});

beforeEach(async () => {
  await asA(() => db.query('delete from shifts'), { commit: true });
});

describe('no double-booking', () => {
  it('rejects an overlapping shift for the same employee', async () => {
    await asA(() => insertShift({ start: '2026-11-09T02:30:00Z', end: '2026-11-09T10:30:00Z' }), {
      commit: true,
    });
    await expect(
      asA(() => insertShift({ start: '2026-11-09T08:00:00Z', end: '2026-11-09T16:00:00Z' })),
    ).rejects.toSatisfy((error) => pgCode(error) === '23P01');
  });

  it('allows back-to-back shifts (the range end is exclusive)', async () => {
    await asA(() => insertShift({ start: '2026-11-09T02:30:00Z', end: '2026-11-09T10:30:00Z' }), {
      commit: true,
    });
    await expect(
      asA(() => insertShift({ start: '2026-11-09T10:30:00Z', end: '2026-11-09T18:30:00Z' })),
    ).resolves.toBeDefined();
  });

  it('checks across the whole org, not per location', async () => {
    await asA(() => insertShift({ start: '2026-11-09T02:30:00Z', end: '2026-11-09T10:30:00Z' }), {
      commit: true,
    });
    await expect(
      asA(() =>
        insertShift({
          schedule: SCHED_A2,
          location: LOC_A2,
          start: '2026-11-09T09:00:00Z',
          end: '2026-11-09T17:00:00Z',
        }),
      ),
    ).rejects.toSatisfy((error) => pgCode(error) === '23P01');
  });

  it('allows overlapping shifts for different employees', async () => {
    await asA(() => insertShift({ employee: EMP_A }), { commit: true });
    await expect(asA(() => insertShift({ employee: EMP_A2 }))).resolves.toBeDefined();
  });

  it('allows overlapping open shifts: nobody is booked yet', async () => {
    await asA(() => insertShift({ employee: null }), { commit: true });
    await expect(asA(() => insertShift({ employee: null }))).resolves.toBeDefined();
  });

  it('allows an overlapping cancelled shift', async () => {
    await asA(() => insertShift({ employee: EMP_A }), { commit: true });
    await expect(
      asA(() => insertShift({ employee: EMP_A, status: 'cancelled' })),
    ).resolves.toBeDefined();
  });
});

describe('constraints that keep a shift honest', () => {
  it("rejects a shift in a location that isn't its schedule's", async () => {
    await expect(asA(() => insertShift({ location: LOC_A2 }))).rejects.toSatisfy(
      (error) => pgCode(error) === '23503',
    );
  });

  it('rejects an employee from another org', async () => {
    await expect(asA(() => insertShift({ employee: EMP_B }))).rejects.toSatisfy(
      (error) => pgCode(error) === '23503',
    );
  });

  it("rejects a shift for another org's job role", async () => {
    const foreignRole = newId();
    await as(
      { user: RAVI, org: ORG_B },
      () =>
        db.query(`insert into job_roles (id, org_id, name) values ($1, $2, 'Nurse')`, [
          foreignRole,
          ORG_B,
        ]),
      { commit: true },
    );
    await expect(asA(() => insertShift({ role: foreignRole }))).rejects.toSatisfy(
      (error) => pgCode(error) === '23503',
    );
  });

  it('keeps status and assignee consistent', async () => {
    await expect(asA(() => insertShift({ employee: null, status: 'assigned' }))).rejects.toSatisfy(
      (error) => pgCode(error) === '23514',
    );
    await expect(asA(() => insertShift({ employee: EMP_A, status: 'open' }))).rejects.toSatisfy(
      (error) => pgCode(error) === '23514',
    );
  });

  it('rejects a break as long as the shift and an empty range', async () => {
    await expect(
      asA(() =>
        insertShift({
          start: '2026-11-09T02:30:00Z',
          end: '2026-11-09T03:30:00Z',
          breakMinutes: 60,
        }),
      ),
    ).rejects.toSatisfy((error) => pgCode(error) === '23514');
    await expect(
      asA(() => insertShift({ start: '2026-11-09T02:30:00Z', end: '2026-11-09T02:30:00Z' })),
    ).rejects.toSatisfy((error) => pgCode(error) === '23514');
  });
});

describe('tenant isolation', () => {
  it('hides another org’s shifts', async () => {
    await asA(() => insertShift(), { commit: true });
    const rows = await as({ user: RAVI, org: ORG_B }, () =>
      db.query<{ id: string }>('select id from shifts'),
    );
    expect(rows.rows).toEqual([]);
  });
});
