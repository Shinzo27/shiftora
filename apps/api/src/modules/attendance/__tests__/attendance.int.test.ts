import { eq, schema } from '@shiftora/db';
import type { ClockResult, MyTimeEntries } from '@shiftora/shared';
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

/** The clinic, and three points around it. */
const clinic = { latitude: 19.1197, longitude: 72.8468 };
const inside = { ...clinic, accuracyM: 8 };
const nextStreet = { latitude: 19.1207, longitude: 72.8468, accuracyM: 6 }; // ~111 m
const station = { latitude: 19.1197, longitude: 72.869, accuracyM: 12 }; // ~2.2 km

interface Setup {
  owner: TestUser;
  org: string;
  locationId: string;
  staff: TestUser;
  employeeId: string;
  /** Another employee of the same clinic, to prove rows are scoped to the caller. */
  colleagueId: string;
  colleague: TestUser;
}

async function setup(options: { radiusM?: number } = {}): Promise<Setup> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locationId = (
    await owner.call('POST', '/locations', {
      org,
      body: {
        name: 'Andheri',
        ...clinic,
        radiusM: options.radiusM ?? 120,
        timezone: 'Asia/Kolkata',
      },
    })
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

  const colleague = await addMember(t.app, owner, org, 'employee');
  const colleagueId = (
    await owner.call('POST', '/employees', {
      org,
      body: {
        name: 'Ravi Kumar',
        hourlyRateMinor: 20_000,
        userId: colleague.id,
        locationIds: [locationId],
      },
    })
  ).json<{ id: string }>().id;

  return { owner, org, locationId, staff, employeeId, colleagueId, colleague };
}

/** A punch body for the caller. */
const punch = (locationId: string, position = inside, extra: Record<string, unknown> = {}) => ({
  locationId,
  latitude: position.latitude,
  longitude: position.longitude,
  accuracyM: position.accuracyM,
  ...extra,
});

/** Sets the tenant's policy directly: the API to change it arrives with org settings (W3 D5+). */
async function setPolicy(org: string, ownerId: string, policy: 'flag' | 'reject') {
  await t.queryAs({ userId: ownerId, orgId: org }, (tx) =>
    tx
      .update(schema.organizations)
      .set({ geofencePolicy: policy })
      .where(eq(schema.organizations.id, org)),
  );
}

describe('clocking in', () => {
  it('records a punch inside the fence with no flags', async () => {
    const s = await setup();
    const res = await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { entry, created } = res.json<ClockResult>();
    expect(created).toBe(true);
    expect(entry).toMatchObject({
      employeeId: s.employeeId,
      locationId: s.locationId,
      locationName: 'Andheri',
      method: 'gps',
      distanceM: 0,
      accuracyM: 8,
      flags: [],
      edited: false,
      clockOutAt: null,
    });
    // The punch happened "now": its local date is today at the location, whatever that is.
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.clockInTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });

  it('does not let a hopeless fix widen the fence server-side either', async () => {
    const s = await setup({ radiusM: 50 });
    await setPolicy(s.org, s.owner.id, 'reject');

    // 2.2 km away with ±400 m accuracy: the fence becomes 150 m, not 450 m.
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, station),
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'attendance.outside_geofence' });
  });

  it('flags a punch outside the fence by default instead of refusing it', async () => {
    const s = await setup({ radiusM: 50 });
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, nextStreet),
    });

    expect(res.status).toBe(201);
    const { entry } = res.json<ClockResult>();
    expect(entry.flags).toEqual(['outside_geofence']);
    expect(entry.distanceM).toBeGreaterThan(50);
  });

  it('refuses the same punch when the organisation chooses to reject', async () => {
    const s = await setup({ radiusM: 50 });
    await setPolicy(s.org, s.owner.id, 'reject');

    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, nextStreet),
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'attendance.outside_geofence' });
    expect(String((res.body as { detail?: unknown }).detail)).toContain('m from Andheri');
  });

  it('accepts the fence edge once the phone admits its own accuracy', async () => {
    const s = await setup({ radiusM: 50 });
    await setPolicy(s.org, s.owner.id, 'reject');

    // 111 m out, but ±70 m accuracy brings the allowed radius to 120 m.
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, { ...nextStreet, accuracyM: 70 }),
    });
    expect(res.status).toBe(201);
    expect(res.json<ClockResult>().entry.flags).toEqual([]);
  });

  it('flags a phone whose clock is wrong, and keeps the device time as claimed', async () => {
    const s = await setup();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, inside, { at: tenMinutesAgo }),
    });
    expect(res.status).toBe(201);
    const { entry } = res.json<ClockResult>();
    expect(entry.flags).toEqual(['device_skew']);
    expect(entry.clockInAt).toBe(tenMinutesAgo);
  });

  it('refuses a second clock-in while one is open', async () => {
    const s = await setup();
    await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });

    const second = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId),
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'attendance.already_clocked_in' });
  });

  it('exactly one of two simultaneous punches wins', async () => {
    const s = await setup();
    const results = await Promise.all([
      s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) }),
      s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) }),
    ]);
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409]);
  });
});

describe('idempotency', () => {
  const key = '0199c3a2-6b1e-7c4a-9f2d-3a5b7c9d1e2f';

  it('a retried punch with the same key returns the row it created', async () => {
    const s = await setup();
    const first = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId),
      headers: { 'idempotency-key': key },
    });
    const retry = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId),
      headers: { 'idempotency-key': key },
    });

    expect(first.status).toBe(201);
    expect(first.json<ClockResult>().created).toBe(true);
    // The retry does not 409: it is the same punch, not a second one.
    expect(retry.status).toBe(201);
    expect(retry.json<ClockResult>().created).toBe(false);
    expect(retry.json<ClockResult>().entry.id).toBe(first.json<ClockResult>().entry.id);
  });

  it('refuses an Idempotency-Key that is not a UUID', async () => {
    const s = await setup();
    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId),
      headers: { 'idempotency-key': 'not-a-uuid' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('clocking out', () => {
  it('closes the open punch and reports the minutes worked', async () => {
    const s = await setup();
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, inside, { at: start }),
    });

    const res = await s.staff.call('POST', '/clock-out', {
      org: s.org,
      body: { latitude: inside.latitude, longitude: inside.longitude, accuracyM: 9 },
    });
    expect(res.status).toBe(200);
    const { entry } = res.json<ClockResult>();
    expect(entry.clockOutAt).not.toBeNull();
    expect(entry.minutes).toBeGreaterThanOrEqual(180);
    expect(entry.clockOutTime).not.toBeNull();
    // A punch dated three hours ago is exactly what a wrong device clock looks like, so the
    // flag from the clock-in survives the clock-out (flags are the union of both ends).
    expect(entry.flags).toEqual(['device_skew']);
  });

  it('accepts a clock-out without coordinates', async () => {
    const s = await setup();
    await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });
    const res = await s.staff.call('POST', '/clock-out', { org: s.org, body: {} });
    expect(res.status).toBe(200);
    expect(res.json<ClockResult>().entry.clockOutAt).not.toBeNull();
  });

  it('refuses to close a punch that is not open', async () => {
    const s = await setup();
    const res = await s.staff.call('POST', '/clock-out', { org: s.org, body: {} });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'attendance.no_open_entry' });
  });

  it('refuses a clock-out before the clock-in', async () => {
    const s = await setup();
    await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });
    const res = await s.staff.call('POST', '/clock-out', {
      org: s.org,
      body: { at: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(res.status).toBe(400);
  });
});

describe('who may punch', () => {
  it('refuses a login with no staff profile', async () => {
    const s = await setup();
    const res = await s.owner.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'attendance.not_linked' });
  });

  it('refuses a punch that claims another employee’s shift', async () => {
    const s = await setup();
    const scheduleId = (
      await s.owner.call('POST', '/schedules', {
        org: s.org,
        body: { locationId: s.locationId, weekStart: '2026-11-09' },
      })
    ).json<{ id: string }>().id;
    const shiftId = (
      await s.owner.call('POST', '/shifts', {
        org: s.org,
        body: {
          scheduleId,
          date: '2026-11-12',
          startTime: '09:00',
          endTime: '17:00',
          employeeId: s.colleagueId,
        },
      })
    ).json<{ shift: { id: string } }>().shift.id;

    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(s.locationId, inside, { shiftId }),
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'shift.not_found' });
  });

  it('refuses a location from another organisation', async () => {
    const s = await setup();
    const other = await signUp(t.app, 'Other');
    const otherOrg = await createOrg(other, 'Other Clinic');
    const otherLocation = (
      await other.call('POST', '/locations', {
        org: otherOrg,
        body: { name: 'Soho', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London' },
      })
    ).json<{ id: string }>().id;

    const res = await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: punch(otherLocation),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /me/time-entries', () => {
  it('lists only the caller’s punches, newest first, with the wall clock', async () => {
    const s = await setup();
    await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });
    await s.staff.call('POST', '/clock-out', { org: s.org, body: {} });
    await s.colleague.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });

    const res = await s.staff.call('GET', '/me/time-entries?from=2026-11-05&to=2026-11-19', {
      org: s.org,
    });
    expect(res.status).toBe(200);
    const { items } = res.json<MyTimeEntries>();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ employeeId: s.employeeId, locationName: 'Andheri' });
    expect(items[0]?.clockOutAt).not.toBeNull();
  });

  it('is empty for a login with no staff profile', async () => {
    const s = await setup();
    const res = await s.owner.call('GET', '/me/time-entries?from=2026-11-05&to=2026-11-19', {
      org: s.org,
    });
    expect(res.status).toBe(200);
    expect(res.json<MyTimeEntries>().items).toEqual([]);
  });

  it('leaves out punches outside the requested local dates', async () => {
    const s = await setup();
    await s.staff.call('POST', '/clock-in', { org: s.org, body: punch(s.locationId) });
    await s.staff.call('POST', '/clock-out', { org: s.org, body: {} });

    const res = await s.staff.call('GET', '/me/time-entries?from=2026-12-01&to=2026-12-07', {
      org: s.org,
    });
    expect(res.json<MyTimeEntries>().items).toEqual([]);
  });
});
