import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '../schema/columns.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

/**
 * W5 D1: the `shift_requests` table refuses the shapes the state machine never produces — two
 * open requests on one shift, a swap with nobody to swap with, a colleague who is the requester,
 * a request across organisations, an open request with a decision on it.
 */

const OWNER_A = newId();
const OWNER_B = newId();
const ORG_A = newId();
const ORG_B = newId();
const LOC_A = newId();
const LOC_B = newId();
const ASHA = newId();
const ROHAN = newId();
const EMP_B = newId();
const SCHED_A = newId();
const SCHED_B = newId();
const SHIFT_ASHA = newId();
const SHIFT_ASHA_2 = newId();
const SHIFT_ROHAN = newId();
const SHIFT_B = newId();

let database: TestDatabase;
let db: pg.Client;

/** Runs `fn` in an org and rolls back (unless told to commit), so tests start from the same rows. */
async function inOrg<T>(org: string, user: string, fn: () => Promise<T>, commit = false) {
  await db.query('begin');
  try {
    await db.query(
      "select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)",
      [user, org],
    );
    const result = await fn();
    await db.query(commit ? 'commit' : 'rollback');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}
const inA = <T>(fn: () => Promise<T>, commit = false) => inOrg(ORG_A, OWNER_A, fn, commit);

interface RequestValues {
  type?: 'swap' | 'drop' | 'pickup';
  status?: string;
  shift?: string;
  target?: string | null;
  targetShift?: string | null;
  decidedAt?: string | null;
}

function insertRequest(values: RequestValues = {}) {
  const type = values.type ?? 'swap';
  const status = values.status ?? (type === 'swap' ? 'pending_colleague' : 'pending_manager');
  return db.query(
    `insert into shift_requests
       (id, org_id, type, status, shift_id, requester_employee_id, target_employee_id,
        target_shift_id, decided_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newId(),
      ORG_A,
      type,
      status,
      values.shift ?? SHIFT_ASHA,
      ASHA,
      values.target === undefined ? (type === 'swap' ? ROHAN : null) : values.target,
      values.targetShift ?? null,
      values.decidedAt ?? null,
    ],
  );
}

/** The write must fail with this SQLSTATE (and constraint, when given). */
async function expectRefused(write: Promise<unknown>, code: string, name?: string) {
  const error = await write.then(
    () => null,
    (caught: unknown) => caught as { code?: string; constraint?: string },
  );
  expect(error, 'the database accepted it').not.toBeNull();
  expect(error?.code).toBe(code);
  if (name) expect(error?.constraint).toBe(name);
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = new pg.Client({ connectionString: database.urlFor('app_user') });
  await db.connect();

  await db.query(
    `insert into users (id, email, name, password_hash)
     values ($1, 'a@x.com', 'Priya', 'x'), ($2, 'b@x.com', 'Ravi', 'x')`,
    [OWNER_A, OWNER_B],
  );
  const orgs = [
    {
      org: ORG_A,
      owner: OWNER_A,
      loc: LOC_A,
      sched: SCHED_A,
      employees: [ASHA, ROHAN],
      shifts: [
        [SHIFT_ASHA, ASHA, '2026-11-17'],
        [SHIFT_ASHA_2, ASHA, '2026-11-19'],
        [SHIFT_ROHAN, ROHAN, '2026-11-18'],
      ],
    },
    {
      org: ORG_B,
      owner: OWNER_B,
      loc: LOC_B,
      sched: SCHED_B,
      employees: [EMP_B],
      shifts: [[SHIFT_B, EMP_B, '2026-11-17']],
    },
  ];
  for (const { org, owner, loc, sched, employees, shifts } of orgs) {
    await inOrg(
      org,
      owner,
      async () => {
        await db.query('insert into organizations (id, name) values ($1, $2)', [org, 'Clinic']);
        await db.query(
          `insert into memberships (id, org_id, user_id, role) values ($1, $2, $3, 'owner')`,
          [newId(), org, owner],
        );
        await db.query(
          `insert into locations (id, org_id, name, latitude, longitude, radius_m, timezone)
           values ($1, $2, 'Andheri', 19.07, 72.87, 100, 'Asia/Kolkata')`,
          [loc, org],
        );
        for (const id of employees) {
          await db.query(
            `insert into employees (id, org_id, name, hourly_rate_minor)
             values ($1, $2, 'Staff', 25000)`,
            [id, org],
          );
        }
        await db.query(
          `insert into schedules (id, org_id, location_id, week_start)
           values ($1, $2, $3, '2026-11-16')`,
          [sched, org, loc],
        );
        for (const [id, employee, day] of shifts) {
          await db.query(
            `insert into shifts
               (id, org_id, schedule_id, location_id, employee_id, starts_at, ends_at, status)
             values ($1, $2, $3, $4, $5, $6, $7, 'assigned')`,
            [id, org, sched, loc, employee, `${day}T03:30:00Z`, `${day}T11:30:00Z`],
          );
        }
      },
      true,
    );
  }
});

afterAll(async () => {
  await db?.end();
  await database?.stop();
});

describe('shift_requests', () => {
  it('accepts a swap (with a shift in return) and a drop', async () => {
    await inA(async () => {
      await insertRequest({ type: 'swap', targetShift: SHIFT_ROHAN });
      const rows = await db.query('select type, status from shift_requests');
      expect(rows.rows).toEqual([{ type: 'swap', status: 'pending_colleague' }]);
    });
    await inA(() => insertRequest({ type: 'drop' }));
  });

  it('keeps one open request per shift — a closed one does not count', async () => {
    await inA(async () => {
      await insertRequest({
        type: 'drop',
        status: 'cancelled',
        decidedAt: '2026-11-16T00:00:00Z',
      });
      await insertRequest({ type: 'drop' });
      await expectRefused(
        insertRequest({ type: 'swap' }),
        '23505',
        'shift_requests_one_open_per_shift',
      );
    });
  });

  it('a shift offered in return cannot be in two open swaps either', async () => {
    await inA(async () => {
      await insertRequest({ type: 'swap', targetShift: SHIFT_ROHAN });
      await expectRefused(
        insertRequest({ type: 'swap', shift: SHIFT_ASHA_2, targetShift: SHIFT_ROHAN }),
        '23505',
        'shift_requests_one_open_per_target_shift',
      );
    });
  });

  it('a swap needs a colleague; a drop must not have one; nobody swaps with themselves', async () => {
    await inA(() =>
      expectRefused(
        insertRequest({ type: 'swap', target: null }),
        '23514',
        'shift_requests_swap_has_colleague',
      ),
    );
    await inA(() =>
      expectRefused(
        insertRequest({ type: 'drop', target: ROHAN }),
        '23514',
        'shift_requests_swap_has_colleague',
      ),
    );
    await inA(() =>
      expectRefused(
        insertRequest({ type: 'swap', target: ASHA }),
        '23514',
        'shift_requests_not_self',
      ),
    );
    await inA(() =>
      expectRefused(
        insertRequest({ type: 'swap', targetShift: SHIFT_ASHA }),
        '23514',
        'shift_requests_two_shifts',
      ),
    );
  });

  it('open means undecided, and decided means closed', async () => {
    await inA(() =>
      expectRefused(
        insertRequest({ type: 'drop', decidedAt: '2026-11-16T00:00:00Z' }),
        '23514',
        'shift_requests_open_undecided',
      ),
    );
    await inA(() =>
      expectRefused(
        insertRequest({ type: 'drop', status: 'approved' }),
        '23514',
        'shift_requests_open_undecided',
      ),
    );
  });

  it("refuses another org's shift or employee, even with org A's context", async () => {
    await inA(() => expectRefused(insertRequest({ type: 'drop', shift: SHIFT_B }), '23503'));
    await inA(() => expectRefused(insertRequest({ type: 'swap', target: EMP_B }), '23503'));
  });

  it('is invisible to another org (RLS)', async () => {
    await inA(() => insertRequest({ type: 'drop' }), true);
    const seenByB = await inOrg(ORG_B, OWNER_B, () => db.query('select id from shift_requests'));
    expect(seenByB.rows).toEqual([]);
    await inA(() => db.query('delete from shift_requests'), true);
  });

  it('goes away with its shift', async () => {
    await inA(async () => {
      await insertRequest({ type: 'swap', targetShift: SHIFT_ROHAN });
      await db.query('delete from shifts where id = $1', [SHIFT_ROHAN]);
      const left = await db.query('select id from shift_requests');
      expect(left.rows).toEqual([]);
    });
  });
});
