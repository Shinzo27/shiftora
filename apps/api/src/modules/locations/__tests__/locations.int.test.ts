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

const andheri = {
  name: 'Andheri',
  address: 'SV Road, Andheri West',
  latitude: 19.1197,
  longitude: 72.8464,
  timezone: 'Asia/Kolkata',
};
const bandra = { name: 'Bandra', latitude: 19.0596, longitude: 72.8295, timezone: 'Asia/Kolkata' };

async function createLocation(owner: TestUser, org: string, body: object): Promise<string> {
  const res = await owner.call('POST', '/locations', { org, body });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>().id;
}

/** An org with two locations (A, B) and a manager restricted to A. */
async function clinicWithScopedManager() {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locA = await createLocation(owner, org, andheri);
  const locB = await createLocation(owner, org, bandra);
  const manager = await addMember(t.app, owner, org, 'manager');
  const scoped = await owner.call('PUT', `/members/${manager.id}/locations`, {
    org,
    body: { locationIds: [locA] },
  });
  expect(scoped.status).toBe(200);
  return { owner, org, locA, locB, manager };
}

describe('creating locations', () => {
  it('creates a location with a default 100 m geofence', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const res = await owner.call('POST', '/locations', { org, body: andheri });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...andheri, radiusM: 100, status: 'active' });
  });

  it('is owner-only', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    for (const role of ['manager', 'employee'] as const) {
      const member = await addMember(t.app, owner, org, role);
      const res = await member.call('POST', '/locations', { org, body: andheri });
      expect(res.status, role).toBe(403);
    }
  });

  it('validates the time zone, coordinates and radius', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const res = await owner.call('POST', '/locations', {
      org,
      body: { ...andheri, timezone: '+05:30', latitude: 120, radiusM: 5 },
    });

    expect(res.status).toBe(400);
    const paths = res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
    expect(paths.sort()).toEqual(['latitude', 'radiusM', 'timezone']);
  });

  it('rejects a duplicate name, ignoring case', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    await createLocation(owner, org, andheri);
    const res = await owner.call('POST', '/locations', {
      org,
      body: { ...bandra, name: 'ANDHERI' },
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'conflict.name_taken' });
  });
});

describe('manager location scopes', () => {
  it('an unrestricted manager sees every location', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    await createLocation(owner, org, andheri);
    await createLocation(owner, org, bandra);
    const manager = await addMember(t.app, owner, org, 'manager');

    const res = await manager.call('GET', '/locations', { org });
    expect(res.json<{ name: string }[]>().map((l) => l.name)).toEqual(['Andheri', 'Bandra']);
  });

  it('a manager restricted to A cannot see or touch B: it looks like it does not exist', async () => {
    const { org, locA, locB, manager } = await clinicWithScopedManager();

    const list = await manager.call('GET', '/locations', { org });
    expect(list.json<{ id: string }[]>().map((l) => l.id)).toEqual([locA]);

    for (const [method, path, body] of [
      ['GET', `/locations/${locB}`, undefined],
      ['PATCH', `/locations/${locB}`, { radiusM: 300 }],
      ['GET', `/locations/${locB}/departments`, undefined],
      ['POST', `/locations/${locB}/departments`, { name: 'OPD' }],
    ] as const) {
      const res = await manager.call(method, path, { org, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body).toMatchObject({ code: 'location.not_found' });
    }

    // Location A works normally.
    const ok = await manager.call('PATCH', `/locations/${locA}`, { org, body: { radiusM: 150 } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ radiusM: 150 });
  });

  it('a scoped manager cannot rename a department at another location', async () => {
    const { owner, org, locB, manager } = await clinicWithScopedManager();
    const dept = await owner.call('POST', `/locations/${locB}/departments`, {
      org,
      body: { name: 'OPD' },
    });

    const res = await manager.call('PATCH', `/departments/${dept.json<{ id: string }>().id}`, {
      org,
      body: { name: 'Renamed' },
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'department.not_found' });
  });

  it('only owners change scopes; owners themselves cannot be restricted', async () => {
    const { owner, org, locA, manager } = await clinicWithScopedManager();

    const byManager = await manager.call('PUT', `/members/${manager.id}/locations`, {
      org,
      body: { locationIds: [] },
    });
    expect(byManager.status).toBe(403);

    const ownerScope = await owner.call('PUT', `/members/${owner.id}/locations`, {
      org,
      body: { locationIds: [locA] },
    });
    expect(ownerScope.status).toBe(400);
    expect(ownerScope.body).toMatchObject({ code: 'location.owner_unrestricted' });
  });

  it("refuses unknown locations and other orgs' locations in a scope", async () => {
    const { owner, org, manager } = await clinicWithScopedManager();
    const other = await signUp(t.app);
    const otherOrg = await createOrg(other);
    const foreignLocation = await createLocation(other, otherOrg, andheri);

    for (const locationId of [foreignLocation, '0193a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b']) {
      const res = await owner.call('PUT', `/members/${manager.id}/locations`, {
        org,
        body: { locationIds: [locationId] },
      });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'location.not_found' });
    }
  });

  it('an empty list lifts the restriction', async () => {
    const { owner, org, manager } = await clinicWithScopedManager();
    const before = await owner.call('GET', `/members/${manager.id}/locations`, { org });
    expect(before.body).toMatchObject({ restricted: true });

    const lifted = await owner.call('PUT', `/members/${manager.id}/locations`, {
      org,
      body: { locationIds: [] },
    });
    expect(lifted.body).toEqual({ userId: manager.id, restricted: false, locationIds: [] });
    expect((await manager.call('GET', '/locations', { org })).json<unknown[]>()).toHaveLength(2);
  });
});

describe('location status', () => {
  it('only owners change status; a read-only location takes no changes until re-activated', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const loc = await createLocation(owner, org, andheri);
    const manager = await addMember(t.app, owner, org, 'manager');

    const byManager = await manager.call('PATCH', `/locations/${loc}`, {
      org,
      body: { status: 'read_only' },
    });
    expect(byManager.status).toBe(403);

    const readOnly = await owner.call('PATCH', `/locations/${loc}`, {
      org,
      body: { status: 'read_only' },
    });
    expect(readOnly.status).toBe(200);

    for (const [method, path, body] of [
      ['PATCH', `/locations/${loc}`, { name: 'New name' }],
      ['POST', `/locations/${loc}/departments`, { name: 'OPD' }],
    ] as const) {
      const res = await owner.call(method, path, { org, body });
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(res.body).toMatchObject({ code: 'location.read_only' });
    }

    const reactivated = await owner.call('PATCH', `/locations/${loc}`, {
      org,
      body: { status: 'active' },
    });
    expect(reactivated.body).toMatchObject({ status: 'active' });
  });
});

describe('departments', () => {
  it('create, rename, list and remove; names unique per location only', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const locA = await createLocation(owner, org, andheri);
    const locB = await createLocation(owner, org, bandra);

    const opd = await owner.call('POST', `/locations/${locA}/departments`, {
      org,
      body: { name: 'OPD' },
    });
    expect(opd.status).toBe(201);
    const opdId = opd.json<{ id: string }>().id;

    const duplicate = await owner.call('POST', `/locations/${locA}/departments`, {
      org,
      body: { name: 'opd' },
    });
    expect(duplicate.status).toBe(409);
    const otherLocation = await owner.call('POST', `/locations/${locB}/departments`, {
      org,
      body: { name: 'OPD' },
    });
    expect(otherLocation.status).toBe(201);

    const renamed = await owner.call('PATCH', `/departments/${opdId}`, {
      org,
      body: { name: 'Out-patients' },
    });
    expect(renamed.body).toMatchObject({ name: 'Out-patients', locationId: locA });

    expect((await owner.call('DELETE', `/departments/${opdId}`, { org })).status).toBe(204);
    expect((await owner.call('GET', `/locations/${locA}/departments`, { org })).body).toEqual([]);
  });

  it('employees can list departments but not change them', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const loc = await createLocation(owner, org, andheri);
    const employee = await addMember(t.app, owner, org, 'employee');

    const list = await employee.call('GET', `/locations/${loc}/departments`, { org });
    expect(list.status).toBe(200);
    const res = await employee.call('POST', `/locations/${loc}/departments`, {
      org,
      body: { name: 'OPD' },
    });
    expect(res.status).toBe(403);
  });
});

describe('job roles', () => {
  it('managers create and rename; unique per org ignoring case; employees only read', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const manager = await addMember(t.app, owner, org, 'manager');
    const employee = await addMember(t.app, owner, org, 'employee');

    const nurse = await manager.call('POST', '/job-roles', { org, body: { name: 'Nurse' } });
    expect(nurse.status).toBe(201);
    const nurseId = nurse.json<{ id: string }>().id;

    const duplicate = await owner.call('POST', '/job-roles', { org, body: { name: 'NURSE' } });
    expect(duplicate.status).toBe(409);
    const byEmployee = await employee.call('POST', '/job-roles', {
      org,
      body: { name: 'Doctor' },
    });
    expect(byEmployee.status).toBe(403);

    const renamed = await manager.call('PATCH', `/job-roles/${nurseId}`, {
      org,
      body: { name: 'Staff Nurse' },
    });
    expect(renamed.body).toMatchObject({ name: 'Staff Nurse' });

    const list = await employee.call('GET', '/job-roles', { org });
    expect(list.json<{ name: string }[]>().map((r) => r.name)).toEqual(['Staff Nurse']);

    expect((await manager.call('DELETE', `/job-roles/${nurseId}`, { org })).status).toBe(204);
  });
});

describe('isolation between organisations', () => {
  it("cannot read or change another org's location, department or job role by id", async () => {
    const ownerA = await signUp(t.app);
    const ownerB = await signUp(t.app);
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);
    const locB = await createLocation(ownerB, orgB, andheri);
    const deptB = (
      await ownerB.call('POST', `/locations/${locB}/departments`, {
        org: orgB,
        body: { name: 'OPD' },
      })
    ).json<{ id: string }>().id;
    const roleB = (
      await ownerB.call('POST', '/job-roles', { org: orgB, body: { name: 'Nurse' } })
    ).json<{ id: string }>().id;

    const attempts = await Promise.all([
      ownerA.call('GET', `/locations/${locB}`, { org: orgA }),
      ownerA.call('PATCH', `/locations/${locB}`, { org: orgA, body: { radiusM: 999 } }),
      ownerA.call('PATCH', `/departments/${deptB}`, { org: orgA, body: { name: 'Hacked' } }),
      ownerA.call('DELETE', `/departments/${deptB}`, { org: orgA }),
      ownerA.call('PATCH', `/job-roles/${roleB}`, { org: orgA, body: { name: 'Hacked' } }),
      ownerA.call('DELETE', `/job-roles/${roleB}`, { org: orgA }),
    ]);
    expect(attempts.map((res) => res.status)).toEqual([404, 404, 404, 404, 404, 404]);

    // Org B's data is untouched.
    const location = await ownerB.call('GET', `/locations/${locB}`, { org: orgB });
    expect(location.body).toMatchObject({ radiusM: 100 });
    const departments = await ownerB.call('GET', `/locations/${locB}/departments`, { org: orgB });
    expect(departments.json<{ name: string }[]>().map((d) => d.name)).toEqual(['OPD']);
    const roles = await ownerB.call('GET', '/job-roles', { org: orgB });
    expect(roles.json<{ name: string }[]>().map((r) => r.name)).toEqual(['Nurse']);
  });
});

describe('audit log', () => {
  it('records location, department, job role and scope changes', async () => {
    const { owner, org, locA } = await clinicWithScopedManager();
    await owner.call('PATCH', `/locations/${locA}`, { org, body: { radiusM: 200 } });
    await owner.call('POST', `/locations/${locA}/departments`, { org, body: { name: 'OPD' } });
    await owner.call('POST', '/job-roles', { org, body: { name: 'Nurse' } });

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select({
          action: schema.auditEvents.action,
          before: schema.auditEvents.before,
          after: schema.auditEvents.after,
        })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.orgId, org))
        .orderBy(asc(schema.auditEvents.id)),
    );

    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'location.created',
        'membership.locations_changed',
        'location.updated',
        'department.created',
        'job_role.created',
      ]),
    );
    expect(events.find((e) => e.action === 'location.updated')).toMatchObject({
      before: { radiusM: 100 },
      after: { radiusM: 200 },
    });
    expect(events.find((e) => e.action === 'membership.locations_changed')).toMatchObject({
      before: { locationIds: [] },
      after: { locationIds: [locA] },
    });
  });
});
