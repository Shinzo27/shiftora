import { and, eq, schema } from '@shiftora/db';
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
 * W7 D1: coverage requirements round-trip through the API, and the awkward cases answer with a
 * sentence rather than a 500.
 */
let t: TestApp;
let owner: TestUser;
let orgId: string;
let locationId: string;
let otherLocationId: string;
let nurseId: string;

const create = (body: object) =>
  owner.call('POST', `/locations/${locationId}/coverage`, { org: orgId, body });

beforeAll(async () => {
  t = await startTestApp();
  owner = await signUp(t.app, 'Priya');
  orgId = await createOrg(owner);

  const location = async (name: string) =>
    (
      await owner.call('POST', '/locations', {
        org: orgId,
        body: { name, latitude: 19.06, longitude: 72.83, timezone: 'Asia/Kolkata' },
      })
    ).json<{ id: string }>().id;

  locationId = await location('Bandra');
  otherLocationId = await location('Andheri');
  nurseId = (
    await owner.call('POST', '/job-roles', { org: orgId, body: { name: 'Nurse' } })
  ).json<{ id: string }>().id;
});

afterAll(async () => {
  await t?.close();
});

describe('coverage requirements', () => {
  it('stores a weekday requirement and returns it with the role name', async () => {
    const res = await create({
      weekday: 1,
      jobRoleId: nurseId,
      startLocal: '09:00',
      endLocal: '17:00',
      headcount: 2,
    });
    expect(res.status).toBe(201);
    const created = res.json<{ id: string; jobRoleName: string; headcount: number }>();
    expect(created.jobRoleName).toBe('Nurse');
    expect(created.headcount).toBe(2);

    const list = await owner.call('GET', `/locations/${locationId}/coverage`, { org: orgId });
    expect(list.status).toBe(200);
    expect(list.json<unknown[]>()).toHaveLength(1);
  });

  it('allows "anyone at the branch"', async () => {
    const res = await create({ weekday: 3, jobRoleId: null, startLocal: '10:00', endLocal: '14:00' });
    expect(res.status).toBe(201);
    expect(res.json<{ jobRoleName: string | null; headcount: number }>()).toMatchObject({
      jobRoleName: null,
      headcount: 1,
    });
  });

  it('refuses a duplicate instead of quietly doubling the headcount', async () => {
    const body = { weekday: 2, jobRoleId: null, startLocal: '08:00', endLocal: '12:00' };
    expect((await create(body)).status).toBe(201);

    const again = await create(body);
    expect(again.status).toBe(409);
    expect(again.json()).toMatchObject({ code: 'coverage.already_exists' });
  });

  it('refuses a window that starts and ends at the same time', async () => {
    const res = await create({ weekday: 4, startLocal: '09:00', endLocal: '09:00' });
    expect(res.status).toBe(400);
  });

  it('edits one requirement in place', async () => {
    const created = (
      await create({ weekday: 5, startLocal: '18:00', endLocal: '22:00' })
    ).json<{ id: string }>();

    const patched = await owner.call('PATCH', `/coverage/${created.id}`, {
      org: orgId,
      body: { headcount: 3 },
    });
    expect(patched.status).toBe(200);
    expect(patched.json<{ headcount: number }>().headcount).toBe(3);
  });

  it('deletes a requirement', async () => {
    const created = (
      await create({ weekday: 6, startLocal: '09:00', endLocal: '13:00' })
    ).json<{ id: string }>();

    expect((await owner.call('DELETE', `/coverage/${created.id}`, { org: orgId })).status).toBe(204);

    const list = await owner.call('GET', `/locations/${locationId}/coverage`, { org: orgId });
    const ids = list.json<{ id: string }[]>().map((row) => row.id);
    expect(ids).not.toContain(created.id);
  });

  it('keeps each branch’s coverage separate', async () => {
    const other = await owner.call('GET', `/locations/${otherLocationId}/coverage`, { org: orgId });
    expect(other.json<unknown[]>()).toHaveLength(0);
  });

  it('refuses a role from another organisation as a missing role, not a 500', async () => {
    // The composite foreign key would catch it eventually, but a 500 reads as a bug in the
    // product rather than a bad request.
    const res = await create({
      weekday: 7,
      jobRoleId: '00000000-0000-4000-8000-000000000000',
      startLocal: '09:00',
      endLocal: '12:00',
    });
    expect(res.status).toBe(404);
    expect(res.json()).toMatchObject({ code: 'job_role.not_found' });
  });

  it('leaves an audit trail for every write', async () => {
    const created = (
      await create({ weekday: 7, startLocal: '14:00', endLocal: '18:00' })
    ).json<{ id: string }>();
    await owner.call('PATCH', `/coverage/${created.id}`, { org: orgId, body: { headcount: 2 } });
    await owner.call('DELETE', `/coverage/${created.id}`, { org: orgId });

    const rows = await t.queryAs({ userId: owner.id, orgId }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.orgId, orgId),
            eq(schema.auditEvents.entity, 'coverage_requirement'),
            eq(schema.auditEvents.entityId, created.id),
          ),
        ),
    );
    expect(rows.map((row) => row.action)).toEqual([
      'coverage.created',
      'coverage.updated',
      'coverage.deleted',
    ]);
    // The edit kept what it was before, so "we asked for two on Sunday" can be answered later.
    expect(rows[1]?.before).toMatchObject({ headcount: 1 });
    expect(rows[1]?.after).toMatchObject({ headcount: 2 });
  });

  it('404s for a branch the caller cannot see', async () => {
    const stranger = await addMember(t.app, owner, orgId, 'employee');
    const res = await stranger.call('GET', `/locations/${locationId}/coverage`, { org: orgId });
    // Employees are not managers: the role guard answers before any data is read.
    expect(res.status).toBe(403);
  });
});
