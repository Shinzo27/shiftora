import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { toInstant } from '@shiftora/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OutboxEvent } from '../outbox-relay.js';
import { calculatePayroll } from './calculate.js';

/**
 * W6 D4, "approve → lines computed": the worker job turns an approved period's punches into
 * timesheet lines with `computePay`, under the org's pay rules and each person's rate.
 */

const ZONE = 'Asia/Kolkata';
let database: TestDatabase;
let db: Database;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface Org {
  id: string;
  userId: string;
  locationId: string;
  asha: string;
  rohan: string;
}

const asOrg = <T>(org: Org, run: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId: org.userId, orgId: org.id });
    return run(tx);
  });

async function createOrg(): Promise<Org> {
  const user = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, ${`${crypto.randomUUID()}@x.test`}, 'Priya', 'x') returning id`,
  );
  const org: Org = {
    id: crypto.randomUUID(),
    userId: user.rows[0]!.id,
    locationId: '',
    asha: '',
    rohan: '',
  };
  await asOrg(org, async (tx) => {
    await tx.insert(schema.organizations).values({ id: org.id, name: 'Sunrise Clinic' });
    const [location] = await tx
      .insert(schema.locations)
      .values({
        orgId: org.id,
        name: 'Andheri',
        latitude: 19.1,
        longitude: 72.8,
        radiusM: 100,
        timezone: ZONE,
      })
      .returning();
    org.locationId = location!.id;
    const [asha, rohan] = await tx
      .insert(schema.employees)
      .values([
        { orgId: org.id, name: 'Asha Mehta', hourlyRateMinor: 30_000 },
        { orgId: org.id, name: 'Rohan Desai', hourlyRateMinor: 24_000 },
      ])
      .returning();
    org.asha = asha!.id;
    org.rohan = rohan!.id;
    // Overtime after 9 h a day at 1.5×, and after 40 h a week at 1.5×.
    await tx.insert(schema.payRules).values({
      orgId: org.id,
      version: 1,
      effectiveFrom: '2026-01-01',
      rules: {
        overtime: [
          { period: 'day', thresholdMinutes: 540, multiplier: 1.5 },
          { period: 'week', thresholdMinutes: 2400, multiplier: 1.5 },
        ],
        nightPremium: null,
        breaks: [],
        rounding: null,
      },
    });
  });
  return org;
}

async function punch(
  org: Org,
  employeeId: string,
  date: string,
  from: string,
  to: string,
  options: { endDate?: string; disputed?: boolean } = {},
) {
  await asOrg(org, (tx) =>
    tx.insert(schema.timeEntries).values({
      orgId: org.id,
      employeeId,
      locationId: org.locationId,
      clockInAt: toInstant(date, from, ZONE),
      clockOutAt: toInstant(options.endDate ?? date, to, ZONE),
      inLatitude: 19.1,
      inLongitude: 72.8,
      inAccuracyM: 10,
      inDistanceM: 5,
      deviceTime: toInstant(date, from, ZONE),
      ...(options.disputed
        ? {
            reviewDecision: 'disputed' as const,
            reviewedAt: new Date(),
            reviewedBy: org.userId,
            reviewNote: 'Not on shift',
          }
        : {}),
    }),
  );
}

/** A period approved by an owner: what the API leaves behind for the worker. */
async function approvedPeriod(org: Org, startsOn: string, endsOn: string): Promise<OutboxEvent> {
  return asOrg(org, async (tx) => {
    const [period] = await tx
      .insert(schema.payPeriods)
      .values({
        orgId: org.id,
        startsOn,
        endsOn,
        status: 'calculating',
        approvedAt: new Date(),
        approvedBy: org.userId,
      })
      .returning();
    return {
      id: crypto.randomUUID(),
      orgId: org.id,
      topic: 'pay_period.approved',
      payload: { payPeriodId: period!.id },
    };
  });
}

const periodOf = (org: Org, event: OutboxEvent) =>
  asOrg(org, async (tx) => {
    const id = (event.payload as { payPeriodId: string }).payPeriodId;
    const [period] = await tx
      .select()
      .from(schema.payPeriods)
      .where(sql`id = ${id}`);
    const lines = await tx
      .select()
      .from(schema.timesheetLines)
      .where(sql`pay_period_id = ${id}`)
      .orderBy(schema.timesheetLines.date, schema.timesheetLines.category);
    return { period: period!, lines };
  });

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;
});

afterAll(async () => {
  await database?.stop();
});

describe('calculating an approved period', () => {
  it('writes each person’s lines at their own rate, with overtime, and marks it approved', async () => {
    const org = await createOrg();
    await punch(org, org.asha, '2026-12-01', '08:00', '19:00'); // 11 h: 2 h daily overtime
    await punch(org, org.rohan, '2026-12-01', '09:00', '17:00'); // 8 h
    const event = await approvedPeriod(org, '2026-12-01', '2026-12-15');

    const result = await calculatePayroll(db, event);

    expect(result).toMatchObject({ calculated: true, employees: 2 });
    const { period, lines } = await periodOf(org, event);
    const asha = lines.filter((l) => l.employeeId === org.asha);
    expect(asha.map((l) => [l.category, l.minutes, l.amountMinor])).toEqual([
      ['overtime', 120, 90_000],
      ['regular', 540, 270_000],
    ]);
    expect(lines.filter((l) => l.employeeId === org.rohan)).toEqual([
      expect.objectContaining({ minutes: 480, rateMinor: 24_000, amountMinor: 192_000 }),
    ]);
    expect(period).toMatchObject({
      status: 'approved',
      employees: 2,
      paidMinutes: 540 + 120 + 480,
      amountMinor: 270_000 + 90_000 + 192_000,
    });
    expect(period.calculatedAt).toBeInstanceOf(Date);
  });

  it('leaves out disputed punches (owner’s rule)', async () => {
    const org = await createOrg();
    await punch(org, org.asha, '2026-12-02', '09:00', '17:00');
    await punch(org, org.asha, '2026-12-03', '09:00', '17:00', { disputed: true });
    const event = await approvedPeriod(org, '2026-12-01', '2026-12-15');

    await calculatePayroll(db, event);

    const { lines } = await periodOf(org, event);
    expect(lines.map((l) => l.date)).toEqual(['2026-12-02']);
  });

  it('pays each minute in exactly one period: an overnight shift at the edge is split', async () => {
    const org = await createOrg();
    await punch(org, org.asha, '2026-11-30', '22:00', '06:00', { endDate: '2026-12-01' });
    const november = await approvedPeriod(org, '2026-11-16', '2026-11-30');
    const december = await approvedPeriod(org, '2026-12-01', '2026-12-15');

    await calculatePayroll(db, november);
    await calculatePayroll(db, december);

    expect((await periodOf(org, november)).lines.map((l) => [l.date, l.minutes])).toEqual([
      ['2026-11-30', 120],
    ]);
    expect((await periodOf(org, december)).lines.map((l) => [l.date, l.minutes])).toEqual([
      ['2026-12-01', 360],
    ]);
  });

  it('weekly overtime counts the days of the week before the period started', async () => {
    const org = await createOrg();
    // Mon 30 Nov – Wed 2 Dec: 3 × 9 h = 27 h. The period starts Thursday 3 Dec.
    for (const day of ['2026-11-30', '2026-12-01', '2026-12-02']) {
      await punch(org, org.rohan, day, '08:00', '17:00');
    }
    // Thu and Fri, 9 h each: 27 + 18 = 45 h → the last 5 h of the week are overtime.
    await punch(org, org.rohan, '2026-12-03', '08:00', '17:00');
    await punch(org, org.rohan, '2026-12-04', '08:00', '17:00');
    const event = await approvedPeriod(org, '2026-12-03', '2026-12-16');

    await calculatePayroll(db, event);

    const { lines } = await periodOf(org, event);
    expect(lines.map((l) => [l.date, l.category, l.minutes])).toEqual([
      ['2026-12-03', 'regular', 540],
      ['2026-12-04', 'overtime', 300],
      ['2026-12-04', 'regular', 240],
    ]);
  });

  it('a replayed job does nothing: the period is already approved', async () => {
    const org = await createOrg();
    await punch(org, org.asha, '2026-12-01', '09:00', '17:00');
    const event = await approvedPeriod(org, '2026-12-01', '2026-12-15');

    await calculatePayroll(db, event);
    const again = await calculatePayroll(db, event);

    expect(again.calculated).toBe(false);
    expect((await periodOf(org, event)).lines).toHaveLength(1);
  });

  it("only touches its own organisation's punches", async () => {
    const a = await createOrg();
    const b = await createOrg();
    await punch(a, a.asha, '2026-12-01', '09:00', '17:00');
    await punch(b, b.asha, '2026-12-01', '09:00', '19:00');
    const event = await approvedPeriod(a, '2026-12-01', '2026-12-15');

    await calculatePayroll(db, event);

    const { lines } = await periodOf(a, event);
    expect(lines.map((l) => l.minutes)).toEqual([480]);
  });
});
