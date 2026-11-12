import type { Attendance, ClockResult, TimeEntryWithEdits } from '@shiftora/shared';
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
const RANGE = 'from=2026-11-09&to=2026-11-15';

interface Setup {
  owner: TestUser;
  org: string;
  locationId: string;
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
  return { owner, org, locationId, staff, employeeId };
}

/** A punch 340 m away: inside the 120 m fence only if the fence widened, so it is flagged. */
async function farPunch(s: Setup): Promise<string> {
  const res = await s.staff.call('POST', '/clock-in', {
    org: s.org,
    body: {
      locationId: s.locationId,
      latitude: clinic.latitude + 0.003,
      longitude: clinic.longitude,
      accuracyM: 10,
      at: '2026-11-12T03:30:00.000Z',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { entry } = res.json<ClockResult>();
  expect(entry.flags).toContain('outside_geofence');
  return entry.id;
}

const queue = (s: Setup) =>
  s.owner.call('GET', `/attendance/flags?locationId=${s.locationId}&${RANGE}`, { org: s.org });

describe('the flag review queue', () => {
  it('lists flagged punches that nobody has answered, and stops once they are answered', async () => {
    const s = await setup();
    const id = await farPunch(s);

    const before = await queue(s);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const items = before.json<Attendance>().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, employeeName: 'Asha Mehta', review: null });
    expect(items[0]?.flags).toContain('outside_geofence');

    const accepted = await s.owner.call('POST', `/time-entries/${id}/review`, {
      org: s.org,
      body: { decision: 'accepted' },
    });
    expect(accepted.status).toBe(200);
    const { entry } = accepted.json<TimeEntryWithEdits>();
    expect(entry.review).toMatchObject({ decision: 'accepted', note: null, by: s.owner.id });
    // The punch itself is untouched: only the verdict is new.
    expect(entry.flags).toContain('outside_geofence');
    expect(entry.clockInTime).toBe('09:00');

    const after = await queue(s);
    expect(after.json<Attendance>().items).toEqual([]);
  });

  it('keeps a punch nobody was asked about out of the queue', async () => {
    const s = await setup();
    // No `at`: the device's claim is the server's clock, so there is no skew to flag either.
    await s.staff.call('POST', '/clock-in', {
      org: s.org,
      body: {
        locationId: s.locationId,
        latitude: clinic.latitude,
        longitude: clinic.longitude,
        accuracyM: 6,
      },
    });
    const today = new Date().toISOString().slice(0, 10);
    const res = await s.owner.call(
      'GET',
      `/attendance/flags?locationId=${s.locationId}&from=${today}&to=${today}`,
      { org: s.org },
    );
    expect(res.json<Attendance>().items).toEqual([]);
  });

  it('insists on a reason to dispute, and records it', async () => {
    const s = await setup();
    const id = await farPunch(s);

    const bare = await s.owner.call('POST', `/time-entries/${id}/review`, {
      org: s.org,
      body: { decision: 'disputed' },
    });
    expect(bare.status).toBe(400);
    expect(bare.body).toMatchObject({ code: 'validation_failed' });

    const disputed = await s.owner.call('POST', `/time-entries/${id}/review`, {
      org: s.org,
      body: { decision: 'disputed', note: 'He was at the Bandra branch that morning.' },
    });
    expect(disputed.status).toBe(200);
    expect(disputed.json<TimeEntryWithEdits>().entry.review).toMatchObject({
      decision: 'disputed',
      note: 'He was at the Bandra branch that morning.',
    });

    const again = await s.owner.call('POST', `/time-entries/${id}/review`, {
      org: s.org,
      body: { decision: 'accepted' },
    });
    expect(again.status).toBe(409);
  });

  it('shows the verdict on the punch and nowhere else', async () => {
    const s = await setup();
    const id = await farPunch(s);
    await s.owner.call('POST', `/time-entries/${id}/review`, {
      org: s.org,
      body: { decision: 'disputed', note: 'Wrong branch' },
    });

    const read = await s.owner.call('GET', `/time-entries/${id}`, { org: s.org });
    const { entry, edits } = read.json<TimeEntryWithEdits>();
    expect(entry.review?.decision).toBe('disputed');
    // A dispute is not a correction, so it does not appear as an edit.
    expect(edits).toEqual([]);
  });

  it('is closed to employees and to managers without this branch', async () => {
    const s = await setup();
    const id = await farPunch(s);

    const own = await s.staff.call('GET', `/attendance/flags?locationId=${s.locationId}&${RANGE}`, {
      org: s.org,
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

    const scoped = await manager.call('POST', `/time-entries/${id}/review`, {
      org: s.org,
      body: { decision: 'accepted' },
    });
    expect(scoped.status).toBe(404);
  });
});
