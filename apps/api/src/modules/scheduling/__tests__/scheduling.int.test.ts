import { and, eq, schema } from '@shiftora/db';
import type { Schedule, ShiftTemplate } from '@shiftora/shared';
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
const london = { name: 'Soho', latitude: 51.51, longitude: -0.13, timezone: 'Europe/London' };
const morning = { name: 'Morning', startTime: '07:00', endTime: '15:00', breakMinutes: 30 };

async function createLocation(owner: TestUser, org: string, body: object): Promise<string> {
  const res = await owner.call('POST', '/locations', { org, body });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>().id;
}

/** An org with locations A (Mumbai) and B (London), and a manager restricted to A. */
async function clinic() {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locA = await createLocation(owner, org, mumbai);
  const locB = await createLocation(owner, org, london);
  const manager = await addMember(t.app, owner, org, 'manager');
  const scoped = await owner.call('PUT', `/members/${manager.id}/locations`, {
    org,
    body: { locationIds: [locA] },
  });
  expect(scoped.status).toBe(200);
  return { owner, org, locA, locB, manager };
}

describe('shift templates', () => {
  it('creates a template and reports its paid length', async () => {
    const { owner, org, locA } = await clinic();
    const res = await owner.call('POST', '/shift-templates', {
      org,
      body: { ...morning, locationId: locA },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ...morning,
      locationId: locA,
      jobRoleId: null,
      paidMinutes: 450, // 8 h minus a 30 min break
    });
  });

  it('handles an overnight template and writes an audit event', async () => {
    const { owner, org, locA } = await clinic();
    const res = await owner.call('POST', '/shift-templates', {
      org,
      body: { name: 'Night', startTime: '22:00', endTime: '06:00', locationId: locA },
    });
    expect(res.status).toBe(201);
    const template = res.json<ShiftTemplate>();
    expect(template.paidMinutes).toBe(480);

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(
          and(eq(schema.auditEvents.orgId, org), eq(schema.auditEvents.entityId, template.id)),
        ),
    );
    expect(events.map((e) => e.action)).toEqual(['shift_template.created']);
  });

  it('rejects an edit that leaves the break longer than the shift', async () => {
    const { owner, org, locA } = await clinic();
    const created = await owner.call('POST', '/shift-templates', {
      org,
      body: { ...morning, locationId: locA },
    });
    const id = created.json<ShiftTemplate>().id;

    // Only the end changes, but the stored 30 min break no longer fits a 20 min shift.
    const res = await owner.call('PATCH', `/shift-templates/${id}`, {
      org,
      body: { endTime: '07:20' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'breakMinutes' }],
    });

    const ok = await owner.call('PATCH', `/shift-templates/${id}`, {
      org,
      body: { endTime: '13:00', breakMinutes: 0 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ endTime: '13:00', paidMinutes: 360 });
  });

  it('links a job role, and a duplicate name at the same location is a 409', async () => {
    const { owner, org, locA, locB } = await clinic();
    const role = await owner.call('POST', '/job-roles', { org, body: { name: 'Nurse' } });
    const jobRoleId = role.json<{ id: string }>().id;

    const first = await owner.call('POST', '/shift-templates', {
      org,
      body: { ...morning, locationId: locA, jobRoleId },
    });
    expect(first.body).toMatchObject({ jobRoleId });

    const again = await owner.call('POST', '/shift-templates', {
      org,
      body: { ...morning, name: 'MORNING', locationId: locA },
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'conflict.name_taken' });

    // The same name at another location is fine.
    const elsewhere = await owner.call('POST', '/shift-templates', {
      org,
      body: { ...morning, locationId: locB },
    });
    expect(elsewhere.status).toBe(201);
  });

  it('a scoped manager only sees and edits templates at their locations', async () => {
    const { owner, org, locA, locB, manager } = await clinic();
    const atB = await owner.call('POST', '/shift-templates', {
      org,
      body: { ...morning, locationId: locB },
    });
    const idB = atB.json<ShiftTemplate>().id;
    await owner.call('POST', '/shift-templates', { org, body: { ...morning, locationId: locA } });

    const list = await manager.call('GET', '/shift-templates', { org });
    expect(list.json<ShiftTemplate[]>().map((x) => x.locationId)).toEqual([locA]);

    const attempts = [
      ['GET', `/shift-templates?locationId=${locB}`, undefined],
      ['POST', '/shift-templates', { ...morning, name: 'Sneaky', locationId: locB }],
      ['PATCH', `/shift-templates/${idB}`, { name: 'Renamed' }],
      ['DELETE', `/shift-templates/${idB}`, undefined],
    ] as const;
    for (const [method, path, body] of attempts) {
      const res = await manager.call(method, path, { org, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('employees cannot manage templates (403)', async () => {
    const { owner, org, locA } = await clinic();
    const employee = await addMember(t.app, owner, org, 'employee');
    const res = await employee.call('POST', '/shift-templates', {
      org,
      body: { ...morning, locationId: locA },
    });
    expect(res.status).toBe(403);
  });

  it("another org's templates are invisible", async () => {
    const a = await clinic();
    const b = await clinic();
    const created = await a.owner.call('POST', '/shift-templates', {
      org: a.org,
      body: { ...morning, locationId: a.locA },
    });
    const id = created.json<ShiftTemplate>().id;

    const list = await b.owner.call('GET', '/shift-templates', { org: b.org });
    expect(list.json<ShiftTemplate[]>()).toEqual([]);
    const patch = await b.owner.call('PATCH', `/shift-templates/${id}`, {
      org: b.org,
      body: { name: 'Mine now' },
    });
    expect(patch.status).toBe(404);
    // Using org A's location id from org B is also a 404, not a foreign-key error.
    const cross = await b.owner.call('POST', '/shift-templates', {
      org: b.org,
      body: { ...morning, locationId: a.locA },
    });
    expect(cross.status).toBe(404);
  });
});

describe('schedules', () => {
  it("creates a draft for a week and reports the week's real UTC bounds", async () => {
    const { owner, org, locA } = await clinic();
    const res = await owner.call('POST', '/schedules', {
      org,
      body: { locationId: locA, weekStart: '2026-11-09' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      locationId: locA,
      weekStart: '2026-11-09',
      status: 'draft',
      version: 1,
      timezone: 'Asia/Kolkata',
      startsAt: '2026-11-08T18:30:00.000Z', // Monday 00:00 in Mumbai
      endsAt: '2026-11-15T18:30:00.000Z',
      publishedAt: null,
    });
  });

  it('a London week containing the clocks going back is 169 hours', async () => {
    const { owner, org, locB } = await clinic();
    const res = await owner.call('POST', '/schedules', {
      org,
      body: { locationId: locB, weekStart: '2026-10-19' },
    });
    const week = res.json<Schedule>();
    expect(week.startsAt).toBe('2026-10-18T23:00:00.000Z'); // 00:00 BST
    expect(week.endsAt).toBe('2026-10-26T00:00:00.000Z'); // 00:00 GMT
    expect((Date.parse(week.endsAt) - Date.parse(week.startsAt)) / 3_600_000).toBe(169);
  });

  it('rejects a week that does not start on a Monday', async () => {
    const { owner, org, locA } = await clinic();
    const res = await owner.call('POST', '/schedules', {
      org,
      body: { locationId: locA, weekStart: '2026-11-10' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ errors: [{ path: 'weekStart' }] });
  });

  it('allows one schedule per location and week (409), and lists them newest first', async () => {
    const { owner, org, locA } = await clinic();
    for (const weekStart of ['2026-11-09', '2026-11-16']) {
      await owner.call('POST', '/schedules', { org, body: { locationId: locA, weekStart } });
    }
    const again = await owner.call('POST', '/schedules', {
      org,
      body: { locationId: locA, weekStart: '2026-11-09' },
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'conflict.duplicate' });

    const all = await owner.call('GET', `/schedules?locationId=${locA}`, { org });
    expect(all.json<Schedule[]>().map((s) => s.weekStart)).toEqual(['2026-11-16', '2026-11-09']);
    const one = await owner.call('GET', `/schedules?locationId=${locA}&weekStart=2026-11-16`, {
      org,
    });
    expect(one.json<Schedule[]>()).toHaveLength(1);
  });

  it('a read-only location takes no new schedules (409)', async () => {
    const { owner, org, locA } = await clinic();
    await owner.call('PATCH', `/locations/${locA}`, { org, body: { status: 'read_only' } });
    const res = await owner.call('POST', '/schedules', {
      org,
      body: { locationId: locA, weekStart: '2026-11-09' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'location.read_only' });
  });

  it("a scoped manager gets 404 for another location's schedules", async () => {
    const { owner, org, locB, manager } = await clinic();
    const created = await owner.call('POST', '/schedules', {
      org,
      body: { locationId: locB, weekStart: '2026-11-09' },
    });
    const id = created.json<Schedule>().id;

    const responses = [
      await manager.call('GET', `/schedules/${id}`, { org }),
      await manager.call('GET', `/schedules?locationId=${locB}`, { org }),
      await manager.call('POST', '/schedules', {
        org,
        body: { locationId: locB, weekStart: '2026-11-16' },
      }),
    ];
    expect(responses.map((res) => res.status)).toEqual([404, 404, 404]);
  });

  it("another org's schedule is a 404", async () => {
    const a = await clinic();
    const b = await clinic();
    const created = await a.owner.call('POST', '/schedules', {
      org: a.org,
      body: { locationId: a.locA, weekStart: '2026-11-09' },
    });
    const res = await b.owner.call('GET', `/schedules/${created.json<Schedule>().id}`, {
      org: b.org,
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'schedule.not_found' });
  });
});
