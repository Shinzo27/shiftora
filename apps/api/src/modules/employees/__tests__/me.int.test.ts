import type { Me, MyShifts, TimeOff } from '@shiftora/shared';
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

const mumbai = { name: 'Andheri', latitude: 19.11, longitude: 72.84, timezone: 'Asia/Kolkata' };
const WEEK = '2026-11-09';
const NEXT_WEEK = '2026-11-16';

interface Setup {
  owner: TestUser;
  org: string;
  locationId: string;
  scheduleId: string;
  /** A second week: a shift outside the queried range has to live in its own schedule. */
  nextScheduleId: string;
  /** A member with the `employee` role, linked to a staff profile. */
  staff: TestUser;
  employeeId: string;
  /** The same clinic's "other" employee: no login, used to prove rows are filtered. */
  colleagueId: string;
}

async function setup(): Promise<Setup> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locationId = (await owner.call('POST', '/locations', { org, body: mumbai })).json<{
    id: string;
  }>().id;
  const scheduleId = (
    await owner.call('POST', '/schedules', { org, body: { locationId, weekStart: WEEK } })
  ).json<{ id: string }>().id;

  const staff = await addMember(t.app, owner, org, 'employee');
  const employeeId = (
    await owner.call('POST', '/employees', {
      org,
      body: {
        name: 'Asha Mehta',
        phone: '+919876543210',
        hourlyRateMinor: 25_000,
        userId: staff.id,
        locationIds: [locationId],
      },
    })
  ).json<{ id: string }>().id;
  const colleagueId = (
    await owner.call('POST', '/employees', {
      org,
      body: { name: 'Ravi Kumar', hourlyRateMinor: 20_000, locationIds: [locationId] },
    })
  ).json<{ id: string }>().id;

  const nextScheduleId = (
    await owner.call('POST', '/schedules', { org, body: { locationId, weekStart: NEXT_WEEK } })
  ).json<{ id: string }>().id;

  return { owner, org, locationId, scheduleId, nextScheduleId, staff, employeeId, colleagueId };
}

async function addShift(
  owner: TestUser,
  org: string,
  scheduleId: string,
  body: { employeeId?: string | null; date: string; startTime?: string; endTime?: string },
): Promise<string> {
  const res = await owner.call('POST', '/shifts', {
    org,
    body: { scheduleId, startTime: '09:00', endTime: '17:00', ...body },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<{ shift: { id: string } }>().shift.id;
}

describe('GET /me', () => {
  it('answers a linked employee with their profile, roles and locations', async () => {
    const s = await setup();
    const role = await s.owner.call('POST', '/job-roles', { org: s.org, body: { name: 'Nurse' } });
    await s.owner.call('PATCH', `/employees/${s.employeeId}`, {
      org: s.org,
      body: { jobRoleIds: [role.json<{ id: string }>().id] },
    });

    const res = await s.staff.call('GET', '/me', { org: s.org });
    expect(res.status).toBe(200);
    const me = res.json<Me>();
    expect(me.role).toBe('employee');
    expect(me.profile).toMatchObject({
      employeeId: s.employeeId,
      name: 'Asha Mehta',
      phone: '+919876543210',
      jobRoleNames: ['Nurse'],
    });
    expect(me.profile?.locations).toEqual([
      { id: s.locationId, name: 'Andheri', timezone: 'Asia/Kolkata' },
    ]);
  });

  it('answers an owner with no staff profile with null, not a rejection', async () => {
    const s = await setup();
    const res = await s.owner.call('GET', '/me', { org: s.org });
    expect(res.status).toBe(200);
    expect(res.json<Me>()).toMatchObject({ role: 'owner', profile: null });
  });

  it('only ever answers for the organisation in context', async () => {
    // A second clinic is set up, but the token's `/me` is read with *its own* org header: the
    // first clinic's staff profile is invisible, not merely filtered out by the client.
    await setup();
    const other = await signUp(t.app, 'Other');
    const otherOrg = await createOrg(other);

    const res = await other.call('GET', '/me', { org: otherOrg });
    expect(res.status).toBe(200);
    expect(res.json<Me>().profile).toBeNull();
  });
});

describe('GET /me/shifts', () => {
  it('returns only the caller’s shifts in the requested local dates', async () => {
    const s = await setup();
    const mine = await addShift(s.owner, s.org, s.scheduleId, {
      employeeId: s.employeeId,
      date: '2026-11-10',
    });
    // The week after: in the rota, outside the range the caller asks for.
    await addShift(s.owner, s.org, s.nextScheduleId, {
      employeeId: s.employeeId,
      date: '2026-11-20',
    });
    await addShift(s.owner, s.org, s.scheduleId, { employeeId: s.colleagueId, date: '2026-11-10' });
    await s.owner.call('PATCH', `/shifts/${mine}`, { org: s.org, body: { notes: 'Room 2' } });

    const res = await s.staff.call('GET', '/me/shifts?from=2026-11-09&to=2026-11-15', {
      org: s.org,
    });
    expect(res.status).toBe(200);
    const body = res.json<MyShifts>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: mine,
      date: '2026-11-10',
      startTime: '09:00',
      locationName: 'Andheri',
      locationTimezone: 'Asia/Kolkata',
      notes: 'Room 2',
    });
  });

  it('rejects a range that runs backwards', async () => {
    const s = await setup();
    const res = await s.staff.call('GET', '/me/shifts?from=2026-11-15&to=2026-11-09', {
      org: s.org,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });

  it('is empty for a login with no staff profile', async () => {
    const s = await setup();
    await addShift(s.owner, s.org, s.scheduleId, { employeeId: s.employeeId, date: '2026-11-10' });
    const res = await s.owner.call('GET', '/me/shifts?from=2026-11-09&to=2026-11-15', {
      org: s.org,
    });
    expect(res.status).toBe(200);
    expect(res.json<MyShifts>().items).toEqual([]);
  });

  it('a manager may build the rota and still read their own shifts', async () => {
    const s = await setup();
    const manager = await addMember(t.app, s.owner, s.org, 'manager');
    await s.owner.call('POST', '/employees', {
      org: s.org,
      body: { name: 'Imran Shah', hourlyRateMinor: 30_000, userId: manager.id },
    });
    const res = await manager.call('GET', '/me/shifts?from=2026-11-09&to=2026-11-15', {
      org: s.org,
    });
    expect(res.status).toBe(200);
    expect(res.json<MyShifts>().items).toEqual([]);
  });
});

describe('GET /me/time-off', () => {
  it('lists only the caller’s own time off', async () => {
    const s = await setup();
    await s.owner.call('POST', `/employees/${s.employeeId}/time-off`, {
      org: s.org,
      body: {
        startsAt: '2026-11-18T04:30:00.000Z',
        endsAt: '2026-11-20T13:30:00.000Z',
        reason: 'Wedding',
      },
    });
    await s.owner.call('POST', `/employees/${s.colleagueId}/time-off`, {
      org: s.org,
      body: { startsAt: '2026-11-18T04:30:00.000Z', endsAt: '2026-11-19T13:30:00.000Z' },
    });

    const res = await s.staff.call('GET', '/me/time-off', { org: s.org });
    expect(res.status).toBe(200);
    const items = res.json<TimeOff[]>();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ employeeId: s.employeeId, reason: 'Wedding' });
  });

  it('is empty for a login with no staff profile', async () => {
    const s = await setup();
    const res = await s.owner.call('GET', '/me/time-off', { org: s.org });
    expect(res.status).toBe(200);
    expect(res.json<TimeOff[]>()).toEqual([]);
  });
});
