import { addDays, startOfWeek, toLocal } from '@shiftora/domain';
import type { ScheduleCost } from '@shiftora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  createOrg,
  signUp,
  startTestApp,
  type TestApp,
  type TestUser,
} from '../../../testing/test-app.js';

/**
 * W6 D6, "a draft schedule shows projected cost": the week's shifts priced with the pay engine,
 * the planned break unpaid, and overtime counted with the person's shifts at other branches.
 */

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const ZONE = 'Asia/Kolkata';
const WEEK = addDays(startOfWeek(toLocal(new Date(), ZONE).date), 14);
const day = (n: number) => addDays(WEEK, n);

interface Clinic {
  owner: TestUser;
  org: string;
  andheri: string;
  bandra: string;
  andheriWeek: string;
  bandraWeek: string;
  asha: string;
}

async function clinic(): Promise<Clinic> {
  const owner = await signUp(t.app, 'Priya Nair');
  const org = await createOrg(owner);
  const location = async (name: string) =>
    (
      await owner.call('POST', '/locations', {
        org,
        body: { name, latitude: 19.1, longitude: 72.8, timezone: ZONE },
      })
    ).json<{ id: string }>().id;
  const andheri = await location('Andheri');
  const bandra = await location('Bandra');
  const week = async (locationId: string) =>
    (await owner.call('POST', '/schedules', { org, body: { locationId, weekStart: WEEK } })).json<{
      id: string;
    }>().id;
  const asha = (
    await owner.call('POST', '/employees', {
      org,
      body: { name: 'Asha Mehta', hourlyRateMinor: 30_000, locationIds: [andheri, bandra] },
    })
  ).json<{ id: string }>().id;
  return {
    owner,
    org,
    andheri,
    bandra,
    andheriWeek: await week(andheri),
    bandraWeek: await week(bandra),
    asha,
  };
}

async function shift(
  c: Clinic,
  scheduleId: string,
  date: string,
  options: {
    employeeId?: string | null;
    start?: string;
    end?: string;
    breakMinutes?: number;
  } = {},
) {
  const res = await c.owner.call('POST', '/shifts', {
    org: c.org,
    body: {
      scheduleId,
      employeeId: options.employeeId === undefined ? c.asha : options.employeeId,
      date,
      startTime: options.start ?? '08:00',
      endTime: options.end ?? '17:00',
      breakMinutes: options.breakMinutes ?? 0,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

const costOf = (c: Clinic, scheduleId: string, as: TestUser = c.owner) =>
  as.call('GET', `/schedules/${scheduleId}/cost`, { org: c.org });

describe('projected labour cost', () => {
  it('prices the week’s shifts with the planned break unpaid; open shifts counted, not priced', async () => {
    const c = await clinic();
    await shift(c, c.andheriWeek, day(0), { start: '09:00', end: '17:00', breakMinutes: 30 });
    await shift(c, c.andheriWeek, day(1), { employeeId: null });

    const res = await costOf(c, c.andheriWeek);

    expect(res.status).toBe(200);
    expect(res.json<ScheduleCost>()).toEqual({
      scheduleId: c.andheriWeek,
      currency: 'INR',
      costMinor: 225_000, // 7.5 h × ₹300
      paidMinutes: 450,
      overtimeMinutes: 0,
      openShifts: 1,
      people: [
        {
          employeeId: c.asha,
          name: 'Asha Mehta',
          paidMinutes: 450,
          overtimeMinutes: 0,
          costMinor: 225_000,
        },
      ],
    });
  });

  it('counts hours at the other branch: this week’s shift is the one that tips into overtime', async () => {
    const c = await clinic();
    // Overtime after 40 h a week at 1.5×, from before this week.
    await c.owner.call('POST', '/pay-rules', {
      org: c.org,
      body: {
        effectiveFrom: '2026-01-01',
        rules: { overtime: [{ period: 'week', thresholdMinutes: 2400, multiplier: 1.5 }] },
      },
    });
    // Mon–Thu at Bandra, 9 h each = 36 h. Friday at Andheri, 9 h: the last 5 h are overtime.
    for (const n of [0, 1, 2, 3]) await shift(c, c.bandraWeek, day(n));
    await shift(c, c.andheriWeek, day(4));

    const andheri = (await costOf(c, c.andheriWeek)).json<ScheduleCost>();
    expect(andheri).toMatchObject({
      paidMinutes: 540,
      overtimeMinutes: 300,
      costMinor: 4 * 30_000 + 5 * 45_000,
    });
    // Bandra on its own is all regular: overtime is charged to the week that causes it.
    const bandra = (await costOf(c, c.bandraWeek)).json<ScheduleCost>();
    expect(bandra).toMatchObject({ overtimeMinutes: 0 });
  });

  it('a manager of another branch cannot see it (404); staff cannot at all (403)', async () => {
    const c = await clinic();
    const bandraManager = await addMember(t.app, c.owner, c.org, 'manager');
    await c.owner.call('PUT', `/members/${bandraManager.id}/locations`, {
      org: c.org,
      body: { locationIds: [c.bandra] },
    });
    const employee = await addMember(t.app, c.owner, c.org, 'employee');

    expect((await costOf(c, c.andheriWeek, bandraManager)).status).toBe(404);
    expect((await costOf(c, c.andheriWeek, employee)).status).toBe(403);
  });

  it("another org's schedule does not exist here", async () => {
    const a = await clinic();
    const b = await clinic();
    const res = await b.owner.call('GET', `/schedules/${a.andheriWeek}/cost`, { org: b.org });
    expect(res.status).toBe(404);
  });
});
