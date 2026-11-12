import type { ClockResult, TimeEntryWithEdits } from '@shiftora/shared';
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

/** 09:00–17:00 on 12 Nov at Mumbai is 03:30–11:30 UTC; the punch is claimed as 09:02 local. */
async function shiftAndPunch(s: Setup): Promise<string> {
  await s.owner.call('POST', '/shifts', {
    org: s.org,
    body: {
      scheduleId: s.scheduleId,
      date: '2026-11-12',
      startTime: '09:00',
      endTime: '17:00',
      employeeId: s.employeeId,
    },
  });
  const res = await s.staff.call('POST', '/clock-in', {
    org: s.org,
    body: {
      locationId: s.locationId,
      latitude: clinic.latitude,
      longitude: clinic.longitude,
      accuracyM: 8,
      at: '2026-11-12T03:32:00.000Z',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<ClockResult>().entry.id;
}

describe('correcting a punch', () => {
  it('changes the times, marks it edited, and keeps before/after with the reason', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);

    const res = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: {
        clockInTime: '09:00',
        clockOutTime: '17:05',
        reason: 'Phone died at the door; he started at 9 as rostered.',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { entry, edits } = res.json<TimeEntryWithEdits>();
    expect(entry).toMatchObject({
      clockInTime: '09:00',
      clockOutTime: '17:05',
      edited: true,
      state: 'on_time',
      lateMinutes: 0,
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      reason: 'Phone died at the door; he started at 9 as rostered.',
      before: { clockInAt: '2026-11-12T03:32:00.000Z', clockOutAt: null },
      after: { clockInAt: '2026-11-12T03:30:00.000Z', clockOutAt: '2026-11-12T11:35:00.000Z' },
    });
    expect(edits[0]?.by).toBe(s.owner.id);
  });

  it('recomputes lateness from the corrected time, not from a stored flag', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);

    const read = await s.owner.call('GET', `/time-entries/${id}`, { org: s.org });
    expect(read.json<TimeEntryWithEdits>().entry.state).toBe('on_time');

    // Say he actually arrived at 09:45: late by 40 minutes after the grace, with no flag
    // rewritten anywhere — the state is derived from the punch and the shift on every read.
    const late = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockInTime: '09:45', reason: 'He was on a house call first.' },
    });
    const { entry } = late.json<TimeEntryWithEdits>();
    expect(entry.state).toBe('late');
    expect(entry.lateMinutes).toBe(40);
  });

  it('adds to the history rather than replacing it', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);

    for (const [clockInTime, reason] of [
      ['09:00', 'Started at 9'],
      ['09:01', 'Actually 09:01'],
    ] as const) {
      const res = await s.owner.call('PATCH', `/time-entries/${id}`, {
        org: s.org,
        body: { clockInTime, reason },
      });
      expect(res.status).toBe(200);
    }

    const read = await s.owner.call('GET', `/time-entries/${id}`, { org: s.org });
    const { edits } = read.json<TimeEntryWithEdits>();
    expect(edits.map((edit) => edit.reason)).toEqual(['Started at 9', 'Actually 09:01']);
  });

  it('reads a clock-out before the clock-in as the next morning', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);

    const res = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockInTime: '22:00', clockOutTime: '06:00', reason: 'Night shift, 12th into 13th' },
    });
    expect(res.status).toBe(200);
    const { entry } = res.json<TimeEntryWithEdits>();
    expect(entry).toMatchObject({ clockInTime: '22:00', clockOutTime: '06:00', minutes: 480 });
    expect(entry.date).toBe('2026-11-12');
  });

  it('reopens a forgotten clock-out, but not while another punch is open', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);
    await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockOutTime: '17:00', reason: 'Closed for him' },
    });

    // A second punch, left open.
    const second = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: {
        locationId: s.locationId,
        latitude: clinic.latitude,
        longitude: clinic.longitude,
        accuracyM: 8,
        at: '2026-11-13T03:30:00.000Z',
      },
    });
    expect(second.status).toBe(201);

    const conflict = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockOutTime: null, reason: 'Reopen to check' },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: 'attendance.already_clocked_in' });
  });

  it('refuses times that make no sense', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);

    const zero = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockInTime: '09:00', clockOutTime: '09:00', reason: 'Same time' },
    });
    expect(zero.status).toBe(400);

    // 09:00 → 08:00 the next morning would be 23 hours: a typo, not a shift.
    const typo = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockOutTime: '08:00', reason: 'Meant 18:00' },
    });
    expect(typo.status).toBe(400);
    expect(typo.json<{ detail: string }>().detail).toContain('16 hours');
  });

  it('insists on a reason', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);
    const res = await s.owner.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockInTime: '09:00', reason: '' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });

  it('is refused to the employee, and to a manager without this branch', async () => {
    const s = await setup();
    const id = await shiftAndPunch(s);

    const own = await s.staff.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockInTime: '09:00', reason: 'Let me fix it' },
    });
    expect(own.status).toBe(403);

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

    const scoped = await manager.call('PATCH', `/time-entries/${id}`, {
      org: s.org,
      body: { clockInTime: '09:00', reason: 'Not mine to touch' },
    });
    expect(scoped.status).toBe(404);
  });
});
