import { and, createDatabaseConnection, eq, schema, sql, type Database } from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAutofill } from './autofill.js';

/**
 * W7 D3, end to end inside the worker: coverage in, draft shifts out.
 *
 * The interesting assertion is not "it made shifts" but "it made the *right* shifts and said why
 * it could not make the rest" — a solver that silently leaves a Tuesday uncovered is worse than no
 * solver at all.
 */
let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;
let locationId: string;
let scheduleId: string;
let ashaId: string;
let rohanId: string;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const asOrg = async <T>(run: (tx: Tx) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return run(tx);
  });

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;

  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'fill@test.local', 'Owner', 'x') returning id`,
  );
  userId = owner.rows[0]!.id;
  orgId = crypto.randomUUID();

  await asOrg(async (tx) => {
    await tx.insert(schema.organizations).values({ id: orgId, name: 'Sunrise Clinic' });

    const [location] = await tx
      .insert(schema.locations)
      .values({
        orgId,
        name: 'Andheri',
        latitude: 19.1,
        longitude: 72.8,
        radiusM: 120,
        timezone: 'Asia/Kolkata',
      })
      .returning();
    locationId = location!.id;

    const [schedule] = await tx
      .insert(schema.schedules)
      .values({ orgId, locationId, weekStart: '2027-03-01', status: 'draft' })
      .returning();
    scheduleId = schedule!.id;

    const staff = await tx
      .insert(schema.employees)
      .values([
        { orgId, name: 'Asha Mehta', email: 'asha@fill.test', hourlyRateMinor: 45_000 },
        { orgId, name: 'Rohan Desai', email: 'rohan@fill.test', hourlyRateMinor: 40_000 },
      ])
      .returning();
    ashaId = staff[0]!.id;
    rohanId = staff[1]!.id;

    await tx.insert(schema.employeeLocations).values([
      { orgId, employeeId: ashaId, locationId },
      { orgId, employeeId: rohanId, locationId },
    ]);

    await tx
      .insert(schema.coverageRequirements)
      .values([
        { orgId, locationId, weekday: 1, startLocal: '09:00', endLocal: '17:00', headcount: 2 },
      ]);
  });
});

afterAll(async () => {
  await database?.stop();
});

const run = async () =>
  asOrg(async (tx) => {
    const [row] = await tx
      .insert(schema.autofillRuns)
      .values({ orgId, scheduleId, status: 'queued', createdBy: userId })
      .returning();
    return row!.id;
  });

describe('runAutofill', () => {
  it('fills a week from the coverage rules and writes draft shifts', async () => {
    const runId = await run();
    const result = await runAutofill(db, { orgId, payload: { runId, scheduleId } });

    expect(result).toEqual({ assigned: 2, unfilled: 0 });

    const shifts = await asOrg((tx) =>
      tx.select().from(schema.shifts).where(eq(schema.shifts.scheduleId, scheduleId)),
    );
    expect(shifts).toHaveLength(2);
    expect(new Set(shifts.map((shift) => shift.employeeId))).toEqual(new Set([ashaId, rohanId]));
    // Draft, not published: a rota nobody has looked at is not a rota.
    const [schedule] = await asOrg((tx) =>
      tx.select().from(schema.schedules).where(eq(schema.schedules.id, scheduleId)),
    );
    expect(schedule?.status).toBe('draft');

    const [finished] = await asOrg((tx) =>
      tx.select().from(schema.autofillRuns).where(eq(schema.autofillRuns.id, runId)),
    );
    expect(finished?.status).toBe('succeeded');
    expect(finished?.assigned).toBe(2);
  });

  it('does not double the week when run again', async () => {
    const runId = await run();
    const result = await runAutofill(db, { orgId, payload: { runId, scheduleId } });

    // Both slots are already covered, so the second run fills nothing and adds nothing.
    expect(result.assigned).toBe(0);
    const shifts = await asOrg((tx) =>
      tx.select().from(schema.shifts).where(eq(schema.shifts.scheduleId, scheduleId)),
    );
    expect(shifts).toHaveLength(2);
  });

  it('records what it could not fill, with a reason a manager can act on', async () => {
    // A third slot on a day nobody is available for: a night shift with a role nobody has.
    await asOrg(async (tx) => {
      const [nurse] = await tx.insert(schema.jobRoles).values({ orgId, name: 'Nurse' }).returning();
      await tx.insert(schema.coverageRequirements).values({
        orgId,
        locationId,
        weekday: 3,
        startLocal: '22:00',
        endLocal: '06:00',
        headcount: 1,
        jobRoleId: null,
      });
      void nurse;
    });

    const runId = await run();
    const result = await runAutofill(db, { orgId, payload: { runId, scheduleId } });
    expect(result.unfilled).toBe(0); // two people are still free on Wednesday

    // Now take both of them out of Wednesday's reach with approved leave.
    await asOrg(async (tx) => {
      const wednesday = new Date('2027-03-03T00:00:00+05:30');
      const thursday = new Date('2027-03-04T00:00:00+05:30');
      await tx.insert(schema.timeOff).values([
        { orgId, employeeId: ashaId, startsAt: wednesday, endsAt: thursday },
        { orgId, employeeId: rohanId, startsAt: wednesday, endsAt: thursday },
      ]);
      await tx
        .delete(schema.shifts)
        .where(
          and(
            eq(schema.shifts.scheduleId, scheduleId),
            eq(schema.shifts.startsAt, new Date('2027-03-03T16:30:00Z')),
          ),
        );
    });

    const secondId = await run();
    const second = await runAutofill(db, { orgId, payload: { runId: secondId, scheduleId } });
    expect(second.unfilled).toBe(1);

    const [finished] = await asOrg((tx) =>
      tx.select().from(schema.autofillRuns).where(eq(schema.autofillRuns.id, secondId)),
    );
    const unfilled = finished?.unfilled as { explanation: string }[];
    expect(unfilled[0]?.explanation).toContain('No one free for 2027-03-03');
    expect(unfilled[0]?.explanation).toContain('approved time off');
  });
});
