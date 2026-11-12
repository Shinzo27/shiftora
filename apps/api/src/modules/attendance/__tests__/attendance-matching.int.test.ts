import { eq, schema } from '@shiftora/db';
import type { Attendance, ClockResult, MyTimeEntries } from '@shiftora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  createOrg,
  signUp,
  startTestApp,
  type TestApp,
  type TestUser,
} from '../../../testing/test-app.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const clinic = { latitude: 19.1197, longitude: 72.8468 };
const inside = { ...clinic, accuracyM: 8 };
const WEEK = '2026-11-09';

interface Setup {
  owner: TestUser;
  org: string;
  locationId: string;
  scheduleId: string;
  staff: TestUser;
  employeeId: string;
}

async function setup(): Promise<Setup> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locationId = (
    await owner.call('POST', '/locations', {
      org,
      body: { name: 'Andheri', ...clinic, radiusM: 120, timezone: 'Asia/Kolkata' },
    })
  ).json<{ id: string }>().id;
  const scheduleId = (
    await owner.call('POST', '/schedules', { org, body: { locationId, weekStart: WEEK } })
  ).json<{ id: string }>().id;
  const staff = await addMember(t.app, owner, org, 'employee');
  const employeeId = (
    await owner.call('POST', '/employees', {
      org,
      body: {
        name: 'Asha Mehta',
        hourlyRateMinor: 25_000,
        userId: staff.id,
        locationIds: [locationId],
      },
    })
  ).json<{ id: string }>().id;

  return { owner, org, locationId, scheduleId, staff, employeeId };
}

/** 09:00–17:00 on 12 Nov in Mumbai is 03:30–11:30 UTC. */
async function addShift(
  owner: TestUser,
  org: string,
  scheduleId: string,
  employeeId: string,
  body: { date?: string; startTime?: string; endTime?: string } = {},
): Promise<string> {
  const res = await owner.call('POST', '/shifts', {
    org,
    body: {
      scheduleId,
      date: '2026-11-12',
      startTime: '09:00',
      endTime: '17:00',
      employeeId,
      ...body,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<{ shift: { id: string } }>().shift.id;
}

const punch = (locationId: string, at?: string) => ({
  locationId,
  latitude: inside.latitude,
  longitude: inside.longitude,
  accuracyM: inside.accuracyM,
  ...(at ? { at } : {}),
});

/** The grace period has no API yet (it belongs with org settings), so tests set it directly. */
async function setGrace(org: string, ownerId: string, minutes: number) {
  await t.queryAs({ userId: ownerId, orgId: org }, (tx) =>
    tx
      .update(schema.organizations)
      .set({ attendanceGraceMinutes: minutes })
      .where(eq(schema.organizations.id, org)),
  );
}

describe('matching a punch to its shift', () => {
  it('matches the shift starting nearest when the app sends no shift id', async () => {
    const s = await setup();
    const shiftId = await addShift(s.owner, s.org, s.scheduleId, s.employeeId);

    // 09:01 local, no shiftId in the body.
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T03:31:00.000Z'),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { entry } = res.json<ClockResult>();
    expect(entry.shiftId).toBe(shiftId);
    expect(entry.shift).toMatchObject({ id: shiftId, startTime: '09:00', endTime: '17:00' });
    expect(entry.state).toBe('on_time');
    expect(entry.lateMinutes).toBe(0);
  });

  it('reports lateness beyond the grace, and only the excess', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, s.employeeId);

    // 09:20 local with the default 5-minute grace: 15 minutes late.
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T03:50:00.000Z'),
    });
    const { entry } = res.json<ClockResult>();
    expect(entry.state).toBe('late');
    expect(entry.lateMinutes).toBe(15);
  });

  it('honours the organisation’s own grace', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, s.employeeId);
    await setGrace(s.org, s.owner.id, 20);

    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T03:48:00.000Z'),
    });
    const { entry } = res.json<ClockResult>();
    expect(entry.state).toBe('on_time');
    expect(entry.lateMinutes).toBe(0);
  });

  it('reports an early arrival as early', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, s.employeeId);

    // 08:30 local, half an hour before the shift: 25 minutes early beyond the grace.
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T03:00:00.000Z'),
    });
    const { entry } = res.json<ClockResult>();
    expect(entry.state).toBe('early');
    expect(entry.earlyMinutes).toBe(25);
  });

  it('records a punch with nobody rostered as unscheduled', async () => {
    const s = await setup();
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T12:00:00.000Z'),
    });
    const { entry } = res.json<ClockResult>();
    expect(entry.shiftId).toBeNull();
    expect(entry.shift).toBeNull();
    expect(entry.state).toBe('unscheduled');
  });

  it('keeps the shift on the employee’s own list too', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, s.employeeId);
    await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T03:30:00.000Z'),
    });

    const mine = await s.staff.call('GET', '/me/time-entries?from=2026-11-09&to=2026-11-15', {
      org: s.org,
    });
    expect(mine.json<MyTimeEntries>().items[0]).toMatchObject({
      state: 'on_time',
      shift: { startTime: '09:00', endTime: '17:00' },
    });
  });
});

describe('GET /attendance', () => {
  it('gives the manager the week with names, shifts and totals', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, s.employeeId);
    await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-12T03:40:00.000Z'),
    });
    await s.staff.call('POST', '/clock-out', {
      org: s.org,
      body: { at: '2026-11-12T08:30:00.000Z' },
    });

    const res = await s.owner.call(
      'GET',
      `/attendance?locationId=${s.locationId}&from=2026-11-09&to=2026-11-15`,
      {
        org: s.org,
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.json<Attendance>();

    expect(body).toMatchObject({
      locationId: s.locationId,
      locationName: 'Andheri',
      from: WEEK,
      to: '2026-11-15',
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      employeeId: s.employeeId,
      employeeName: 'Asha Mehta',
      state: 'late',
      lateMinutes: 5,
      shift: { startTime: '09:00', endTime: '17:00' },
    });
    // 09:10 → 14:00 local: 290 minutes worked, 480 rostered.
    expect(body.totals).toEqual([
      {
        employeeId: s.employeeId,
        employeeName: 'Asha Mehta',
        workedMinutes: 290,
        plannedMinutes: 480,
      },
    ]);
  });

  it('counts an open punch at most its rostered length', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, s.employeeId, { date: '2026-11-10' });

    // Clocked in at 09:00 on Tuesday and never clocked out: two days later the row is still
    // open, and the week must not read as two days of overtime.
    await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, '2026-11-10T03:30:00.000Z'),
    });

    const res = await s.owner.call(
      'GET',
      `/attendance?locationId=${s.locationId}&from=2026-11-09&to=2026-11-15`,
      { org: s.org },
    );
    const body = res.json<Attendance>();
    expect(body.items[0]?.clockOutAt).toBeNull();
    expect(body.items[0]?.minutes).toBeGreaterThan(480);
    expect(body.totals[0]).toMatchObject({ workedMinutes: 480, plannedMinutes: 480 });
  });

  it('leaves out punches outside the range', async () => {
    const s = await setup();
    await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });

    const res = await s.owner.call(
      'GET',
      `/attendance?locationId=${s.locationId}&from=2026-12-01&to=2026-12-07`,
      { org: s.org },
    );
    expect(res.json<Attendance>().items).toEqual([]);
  });

  it('refuses an employee, and a location outside the manager’s scope', async () => {
    const s = await setup();
    const forbidden = await s.staff.call(
      'GET',
      `/attendance?locationId=${s.locationId}&from=2026-11-09&to=2026-11-15`,
      { org: s.org },
    );
    expect(forbidden.status).toBe(403);

    // A manager scoped to another branch cannot read this one.
    const manager = await addMember(t.app, s.owner, s.org, 'manager');
    const other = (
      await s.owner.call('POST', '/locations', {
        org: s.org,
        body: { name: 'Bandra', latitude: 19.06, longitude: 72.84, timezone: 'Asia/Kolkata' },
      })
    ).json<{ id: string }>().id;
    await s.owner.call('PUT', `/members/${manager.id}/locations`, {
      org: s.org,
      body: { locationIds: [other] },
    });

    const outOfScope = await manager.call(
      'GET',
      `/attendance?locationId=${s.locationId}&from=2026-11-09&to=2026-11-15`,
      { org: s.org },
    );
    expect(outOfScope.status).toBe(404);
  });
});
