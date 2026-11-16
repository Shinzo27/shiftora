import { and, eq, schema } from '@shiftora/db';
import { addDays, startOfWeek, toLocal } from '@shiftora/domain';
import type { OfferResult, OpenShift, ShiftCandidates } from '@shiftora/shared';
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
 * W5 D3: open shifts. Who could take one (location, job role, free, within rest and hours),
 * offering it to exactly those people, and the list each of them sees.
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

interface Staff {
  user: TestUser;
  employeeId: string;
}

interface Clinic {
  owner: TestUser;
  org: string;
  andheri: string;
  bandra: string;
  nurse: string;
  scheduleId: string;
}

async function clinic(): Promise<Clinic> {
  const owner = await signUp(t.app, 'Owner');
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
  const nurse = (await owner.call('POST', '/job-roles', { org, body: { name: 'Nurse' } })).json<{
    id: string;
  }>().id;
  const scheduleId = (
    await owner.call('POST', '/schedules', {
      org,
      body: { locationId: andheri, weekStart: WEEK },
    })
  ).json<{ id: string }>().id;
  return { owner, org, andheri, bandra, nurse, scheduleId };
}

async function staff(
  c: Clinic,
  name: string,
  options: { locationIds?: string[]; jobRoleIds?: string[]; minRestMinutes?: number } = {},
): Promise<Staff> {
  const user = await addMember(t.app, c.owner, c.org, 'employee');
  const res = await c.owner.call('POST', '/employees', {
    org: c.org,
    body: {
      name,
      hourlyRateMinor: 25_000,
      userId: user.id,
      locationIds: options.locationIds ?? [c.andheri],
      jobRoleIds: options.jobRoleIds ?? [c.nurse],
      ...(options.minRestMinutes ? { minRestMinutes: options.minRestMinutes } : {}),
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { user, employeeId: res.json<{ id: string }>().id };
}

async function shift(
  c: Clinic,
  body: { employeeId?: string | null; date: string; startTime?: string; endTime?: string },
): Promise<string> {
  const res = await c.owner.call('POST', '/shifts', {
    org: c.org,
    body: {
      scheduleId: c.scheduleId,
      jobRoleId: c.nurse,
      startTime: '09:00',
      endTime: '17:00',
      ...body,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<{ shift: { id: string } }>().shift.id;
}

async function offeredEvents(c: Clinic): Promise<{ shiftId: string; employeeIds: string[] }[]> {
  const rows = await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
    tx
      .select({ payload: schema.outbox.payload })
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, c.org), eq(schema.outbox.topic, 'shift.offered'))),
  );
  return rows.map((row) => row.payload as { shiftId: string; employeeIds: string[] });
}

/**
 * Asha is free; Rohan is busy then; Meera is not a nurse; Dev would rest too little; Kiran works
 * at Bandra. Only Asha could take the open 09:00 nurse shift.
 */
async function openShiftScene(c: Clinic) {
  const asha = await staff(c, 'Asha Mehta');
  const rohan = await staff(c, 'Rohan Desai');
  const meera = await staff(c, 'Meera Iyer', { jobRoleIds: [] });
  const dev = await staff(c, 'Dev Kumar', { minRestMinutes: 11 * 60 });
  const kiran = await staff(c, 'Kiran Rao', { locationIds: [c.bandra] });
  await shift(c, {
    employeeId: rohan.employeeId,
    date: day(2),
    startTime: '12:00',
    endTime: '20:00',
  });
  await shift(c, {
    employeeId: dev.employeeId,
    date: day(1),
    startTime: '18:00',
    endTime: '23:00',
  });
  const open = await shift(c, { employeeId: null, date: day(2) });
  return { asha, rohan, meera, dev, kiran, open };
}

describe('who could take an open shift', () => {
  it('lists everyone at the location, eligible first, with the reasons', async () => {
    const c = await clinic();
    const scene = await openShiftScene(c);

    const res = await c.owner.call('GET', `/shifts/${scene.open}/candidates`, { org: c.org });

    expect(res.status).toBe(200);
    const { candidates } = res.json<ShiftCandidates>();
    expect(candidates[0]).toMatchObject({ name: 'Asha Mehta', eligible: true, reasons: [] });
    const byName = new Map(candidates.map((x) => [x.name, x]));
    expect(byName.get('Rohan Desai')?.eligible).toBe(false);
    expect(byName.get('Meera Iyer')).toMatchObject({
      eligible: false,
      reasons: ['Does not have this shift’s job role'],
    });
    expect(byName.get('Dev Kumar')?.eligible).toBe(false);
    // Bandra staff are not candidates for an Andheri shift at all.
    expect(byName.has('Kiran Rao')).toBe(false);
  });
});

describe('offering an open shift', () => {
  it('tells only the eligible staff, and they — and only they — see it', async () => {
    const c = await clinic();
    const scene = await openShiftScene(c);

    // Not offered yet: nobody sees it.
    const before = await scene.asha.user.call('GET', '/me/open-shifts', { org: c.org });
    expect(before.json()).toEqual([]);

    const res = await c.owner.call('POST', `/shifts/${scene.open}/offer`, { org: c.org });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.json<OfferResult>()).toMatchObject({ shiftId: scene.open, offeredTo: 1 });
    expect(await offeredEvents(c)).toEqual([
      { shiftId: scene.open, employeeIds: [scene.asha.employeeId] },
    ]);

    const ashas = await scene.asha.user.call('GET', '/me/open-shifts', { org: c.org });
    expect(ashas.json<OpenShift[]>()).toEqual([
      expect.objectContaining({
        id: scene.open,
        date: day(2),
        startTime: '09:00',
        locationName: 'Andheri',
        jobRoleName: 'Nurse',
      }),
    ]);
    for (const other of [scene.rohan, scene.meera, scene.dev, scene.kiran]) {
      const theirs = await other.user.call('GET', '/me/open-shifts', { org: c.org });
      expect(theirs.json()).toEqual([]);
    }
  });

  it('only an open shift (409), only by a manager (403), only in scope (404)', async () => {
    const c = await clinic();
    const scene = await openShiftScene(c);
    const assigned = await shift(c, { employeeId: scene.asha.employeeId, date: day(4) });

    const notOpen = await c.owner.call('POST', `/shifts/${assigned}/offer`, { org: c.org });
    expect(notOpen.status).toBe(409);
    expect(notOpen.json()).toMatchObject({ code: 'shift.not_open' });

    const byStaff = await scene.asha.user.call('POST', `/shifts/${scene.open}/offer`, {
      org: c.org,
    });
    expect(byStaff.status).toBe(403);

    const bandraManager = await addMember(t.app, c.owner, c.org, 'manager');
    await c.owner.call('PUT', `/members/${bandraManager.id}/locations`, {
      org: c.org,
      body: { locationIds: [c.bandra] },
    });
    const outOfScope = await bandraManager.call('POST', `/shifts/${scene.open}/offer`, {
      org: c.org,
    });
    expect(outOfScope.status).toBe(404);
    const preview = await bandraManager.call('GET', `/shifts/${scene.open}/candidates`, {
      org: c.org,
    });
    expect(preview.status).toBe(404);
  });

  it("another org's open shift does not exist here", async () => {
    const a = await clinic();
    const b = await clinic();
    const open = await shift(a, { employeeId: null, date: day(2) });

    const res = await b.owner.call('POST', `/shifts/${open}/offer`, { org: b.org });
    expect(res.status).toBe(404);
  });
});

describe('an approved drop', () => {
  it('offers the freed shift to everyone who could take it, except the person who dropped it', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const rohan = await staff(c, 'Rohan Desai');
    const given = await shift(c, { employeeId: asha.employeeId, date: day(3) });
    const published = await c.owner.call('POST', `/schedules/${c.scheduleId}/publish`, {
      org: c.org,
    });
    expect(published.status).toBe(200);
    const request = await asha.user.call('POST', '/me/shift-requests', {
      org: c.org,
      body: { type: 'drop', shiftId: given },
    });
    const requestId = request.json<{ id: string }>().id;

    const approved = await c.owner.call('POST', `/shift-requests/${requestId}/approve`, {
      org: c.org,
      body: {},
    });

    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await offeredEvents(c)).toEqual([{ shiftId: given, employeeIds: [rohan.employeeId] }]);
    const rohans = await rohan.user.call('GET', '/me/open-shifts', { org: c.org });
    expect(rohans.json<OpenShift[]>()).toHaveLength(1);
    const ashas = await asha.user.call('GET', '/me/open-shifts', { org: c.org });
    expect(ashas.json()).toEqual([]);
  });
});
