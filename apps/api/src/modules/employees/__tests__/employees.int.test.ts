import { asc, eq, schema } from '@shiftora/db';
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

interface EmployeeBody {
  id: string;
  name: string;
  userId: string | null;
  locationIds: string[];
  jobRoleIds: string[];
}

async function post<T>(user: TestUser, org: string, path: string, body: object): Promise<T> {
  const res = await user.call('POST', path, { org, body });
  if (res.status !== 201) {
    throw new Error(`POST ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.json<T>();
}

/** Org with locations A and B, a Nurse job role, and a manager restricted to A. */
async function clinic() {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const location = async (name: string) =>
    (
      await post<{ id: string }>(owner, org, '/locations', {
        name,
        latitude: 19.1,
        longitude: 72.8,
        timezone: 'Asia/Kolkata',
      })
    ).id;
  const locA = await location('Andheri');
  const locB = await location('Bandra');
  const nurse = (await post<{ id: string }>(owner, org, '/job-roles', { name: 'Nurse' })).id;
  const manager = await addMember(t.app, owner, org, 'manager');
  await owner.call('PUT', `/members/${manager.id}/locations`, {
    org,
    body: { locationIds: [locA] },
  });
  const employee = (body: object) => post<EmployeeBody>(owner, org, '/employees', body);
  return { owner, org, locA, locB, nurse, manager, employee };
}

describe('creating employees', () => {
  it('creates an employee with job roles and locations', async () => {
    const { owner, org, locA, nurse } = await clinic();
    const res = await owner.call('POST', '/employees', {
      org,
      body: {
        name: 'Nina Shah',
        email: 'nina@example.com',
        phone: '+919812345678',
        hourlyRateMinor: 25_000,
        maxWeeklyMinutes: 48 * 60,
        minRestMinutes: 10 * 60,
        notifyChannel: 'whatsapp',
        jobRoleIds: [nurse, nurse],
        locationIds: [locA],
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Nina Shah',
      hourlyRateMinor: 25_000,
      currency: 'INR',
      notifyChannel: 'whatsapp',
      status: 'active',
      userId: null,
      jobRoleIds: [nurse], // duplicates collapsed
      locationIds: [locA],
    });
    const id = res.json<EmployeeBody>().id;
    expect((await owner.call('GET', `/employees/${id}`, { org })).body).toEqual(res.body);
  });

  it('rejects unknown job roles and locations, and read-only locations', async () => {
    const { owner, org, locB, employee } = await clinic();
    const unknown = '0193a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';

    const role = await owner.call('POST', '/employees', {
      org,
      body: { name: 'X', jobRoleIds: [unknown] },
    });
    expect(role.body).toMatchObject({ status: 404, code: 'job_role.not_found' });

    const location = await owner.call('POST', '/employees', {
      org,
      body: { name: 'X', locationIds: [unknown] },
    });
    expect(location.body).toMatchObject({ status: 404, code: 'location.not_found' });

    await owner.call('PATCH', `/locations/${locB}`, { org, body: { status: 'read_only' } });
    const readOnly = await owner.call('POST', '/employees', {
      org,
      body: { name: 'X', locationIds: [locB] },
    });
    expect(readOnly.body).toMatchObject({ status: 409, code: 'location.read_only' });
    await employee({ name: 'Still fine without locations' });
  });

  it('keeps emails unique per org, ignoring case', async () => {
    const { owner, org, employee } = await clinic();
    await employee({ name: 'Nina', email: 'nina@example.com' });
    const res = await owner.call('POST', '/employees', {
      org,
      body: { name: 'Other Nina', email: 'NINA@example.com' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'conflict.duplicate' });
  });

  it('links an employee to a member login, once', async () => {
    const { owner, org, manager, employee } = await clinic();
    const outsider = await signUp(t.app);

    const notMember = await owner.call('POST', '/employees', {
      org,
      body: { name: 'X', userId: outsider.id },
    });
    expect(notMember.body).toMatchObject({ status: 404, code: 'org.member_not_found' });

    const linked = await employee({ name: 'Meera', userId: manager.id });
    expect(linked.userId).toBe(manager.id);
    const again = await owner.call('POST', '/employees', {
      org,
      body: { name: 'Meera 2', userId: manager.id },
    });
    expect(again.status).toBe(409);
  });

  it('is for owners and managers only', async () => {
    const { owner, org } = await clinic();
    const staff = await addMember(t.app, owner, org, 'employee');
    expect((await staff.call('GET', '/employees', { org })).status).toBe(403);
    const create = await staff.call('POST', '/employees', { org, body: { name: 'X' } });
    expect(create.status).toBe(403);
  });
});

describe('location scopes', () => {
  it('a manager scoped to A only sees and creates employees at A', async () => {
    const { org, locA, locB, manager, employee } = await clinic();
    const atA = await employee({ name: 'At A', locationIds: [locA] });
    const atB = await employee({ name: 'At B', locationIds: [locB] });
    await employee({ name: 'Nowhere' });

    const list = await manager.call('GET', '/employees', { org });
    expect(list.json<{ items: EmployeeBody[] }>().items.map((e) => e.name)).toEqual(['At A']);
    expect((await manager.call('GET', `/employees/${atA.id}`, { org })).status).toBe(200);
    const hidden = await manager.call('GET', `/employees/${atB.id}`, { org });
    expect(hidden.body).toMatchObject({ status: 404, code: 'employee.not_found' });

    const noLocation = await manager.call('POST', '/employees', { org, body: { name: 'X' } });
    expect(noLocation.status).toBe(400);
    const otherLocation = await manager.call('POST', '/employees', {
      org,
      body: { name: 'X', locationIds: [locB] },
    });
    expect(otherLocation.status).toBe(404);
  });

  it("a scoped manager's location edit leaves assignments outside their scope alone", async () => {
    const { owner, org, locA, locB, manager, employee } = await clinic();
    const both = await employee({ name: 'Both', locationIds: [locA, locB] });

    // The manager can only see A; sending [] removes A and keeps B.
    const res = await manager.call('PATCH', `/employees/${both.id}`, {
      org,
      body: { locationIds: [] },
    });
    expect(res.body).toMatchObject({ locationIds: [locB] });

    // …which takes the employee out of the manager's view.
    expect((await manager.call('GET', `/employees/${both.id}`, { org })).status).toBe(404);
    const asOwner = await owner.call('GET', `/employees/${both.id}`, { org });
    expect(asOwner.body).toMatchObject({ locationIds: [locB] });
  });
});

describe('listing', () => {
  it('pages through employees by name with a cursor', async () => {
    const { owner, org, employee } = await clinic();
    for (const name of ['Esha', 'Arjun', 'Dev', 'Chitra', 'Bina']) await employee({ name });

    const names: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${cursor}` : '';
      const res = await owner.call('GET', `/employees?limit=2${query}`, { org });
      const page = res.json<{ items: EmployeeBody[]; nextCursor: string | null }>();
      names.push(...page.items.map((e) => e.name));
      pageSizes.push(page.items.length);
      cursor = page.nextCursor;
    } while (cursor);

    expect(names).toEqual(['Arjun', 'Bina', 'Chitra', 'Dev', 'Esha']);
    expect(pageSizes).toEqual([2, 2, 1]);
  });

  it('rejects a tampered cursor', async () => {
    const { owner, org } = await clinic();
    const res = await owner.call('GET', '/employees?cursor=not-a-cursor', { org });
    expect(res.status).toBe(400);
  });

  it('archived employees leave the default list but can still be listed', async () => {
    const { owner, org, employee } = await clinic();
    const nina = await employee({ name: 'Nina' });
    const archived = await owner.call('PATCH', `/employees/${nina.id}`, {
      org,
      body: { status: 'archived' },
    });
    expect(archived.body).toMatchObject({ status: 'archived' });

    const active = await owner.call('GET', '/employees', { org });
    expect(active.json<{ items: unknown[] }>().items).toEqual([]);
    const list = await owner.call('GET', '/employees?status=archived', { org });
    expect(list.json<{ items: EmployeeBody[] }>().items.map((e) => e.name)).toEqual(['Nina']);
  });

  it('filters by location', async () => {
    const { owner, org, locA, locB, employee } = await clinic();
    await employee({ name: 'At A', locationIds: [locA] });
    await employee({ name: 'At B', locationIds: [locB] });
    const res = await owner.call('GET', `/employees?locationId=${locB}`, { org });
    expect(res.json<{ items: EmployeeBody[] }>().items.map((e) => e.name)).toEqual(['At B']);
  });
});

describe('weekly availability', () => {
  it('replaces the weekly pattern, including an overnight slot', async () => {
    const { owner, org, employee } = await clinic();
    const nina = await employee({ name: 'Nina' });
    const slots = [
      { weekday: 5, start: '22:00', end: '06:00' },
      { weekday: 1, start: '09:00', end: '17:00' },
    ];

    const res = await owner.call('PUT', `/employees/${nina.id}/availability`, {
      org,
      body: { slots },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      employeeId: nina.id,
      slots: [
        { weekday: 1, start: '09:00', end: '17:00' },
        { weekday: 5, start: '22:00', end: '06:00' },
      ],
    });
    const cleared = await owner.call('PUT', `/employees/${nina.id}/availability`, {
      org,
      body: { slots: [] },
    });
    expect(cleared.body).toMatchObject({ slots: [] });
  });

  it('rejects overlapping slots and says which one', async () => {
    const { owner, org, employee } = await clinic();
    const nina = await employee({ name: 'Nina' });
    const res = await owner.call('PUT', `/employees/${nina.id}/availability`, {
      org,
      body: {
        slots: [
          { weekday: 5, start: '22:00', end: '06:00' },
          { weekday: 6, start: '05:00', end: '09:00' },
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ errors: [{ path: 'slots.1', message: 'Overlaps slot 1' }] });
  });
});

describe('time off', () => {
  it('stores instants in UTC, lists by window, and removes', async () => {
    const { owner, org, employee } = await clinic();
    const nina = await employee({ name: 'Nina' });

    const created = await owner.call('POST', `/employees/${nina.id}/time-off`, {
      org,
      body: {
        startsAt: '2026-12-24T09:00:00+05:30',
        endsAt: '2026-12-26T09:00:00+05:30',
        reason: 'Family',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      startsAt: '2026-12-24T03:30:00.000Z',
      endsAt: '2026-12-26T03:30:00.000Z',
      reason: 'Family',
    });
    const id = created.json<{ id: string }>().id;

    const base = `/employees/${nina.id}/time-off`;
    const inWindow = await owner.call('GET', `${base}?from=2026-12-25T00:00:00Z`, { org });
    expect(inWindow.json<unknown[]>()).toHaveLength(1);
    const before = await owner.call('GET', `${base}?to=2026-12-01T00:00:00Z`, { org });
    expect(before.json<unknown[]>()).toHaveLength(0);

    expect((await owner.call('DELETE', `/time-off/${id}`, { org })).status).toBe(204);
    expect((await owner.call('GET', base, { org })).body).toEqual([]);
  });

  it('rejects an end before the start', async () => {
    const { owner, org, employee } = await clinic();
    const nina = await employee({ name: 'Nina' });
    const res = await owner.call('POST', `/employees/${nina.id}/time-off`, {
      org,
      body: { startsAt: '2026-12-26T09:00:00Z', endsAt: '2026-12-24T09:00:00Z' },
    });
    expect(res.status).toBe(400);
  });
});

describe('isolation between organisations', () => {
  it("cannot read or change another org's employee, availability or time off", async () => {
    const a = await clinic();
    const b = await clinic();
    const nina = await b.employee({ name: 'Nina' });
    const leave = await post<{ id: string }>(b.owner, b.org, `/employees/${nina.id}/time-off`, {
      startsAt: '2026-12-24T00:00:00Z',
      endsAt: '2026-12-25T00:00:00Z',
    });

    const attempts = await Promise.all([
      a.owner.call('GET', `/employees/${nina.id}`, { org: a.org }),
      a.owner.call('PATCH', `/employees/${nina.id}`, { org: a.org, body: { name: 'Hacked' } }),
      a.owner.call('PUT', `/employees/${nina.id}/availability`, {
        org: a.org,
        body: { slots: [] },
      }),
      a.owner.call('DELETE', `/time-off/${leave.id}`, { org: a.org }),
    ]);
    expect(attempts.map((r) => r.status)).toEqual([404, 404, 404, 404]);

    const still = await b.owner.call('GET', `/employees/${nina.id}/time-off`, { org: b.org });
    expect(still.json<unknown[]>()).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('records employee and availability changes with before/after', async () => {
    const { owner, org, employee } = await clinic();
    const nina = await employee({ name: 'Nina', hourlyRateMinor: 20_000 });
    await owner.call('PATCH', `/employees/${nina.id}`, { org, body: { hourlyRateMinor: 22_000 } });
    await owner.call('PUT', `/employees/${nina.id}/availability`, {
      org,
      body: { slots: [{ weekday: 1, start: '09:00', end: '17:00' }] },
    });

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select({
          action: schema.auditEvents.action,
          before: schema.auditEvents.before,
          after: schema.auditEvents.after,
        })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, nina.id))
        .orderBy(asc(schema.auditEvents.id)),
    );

    expect(events.map((e) => e.action)).toEqual([
      'employee.created',
      'employee.updated',
      'availability.replaced',
    ]);
    expect(events[1]).toMatchObject({
      before: { hourlyRateMinor: 20_000 },
      after: { hourlyRateMinor: 22_000 },
    });
  });
});
