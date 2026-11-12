import { and, eq, schema } from '@shiftora/db';
import type { PublishPreview, PublishResult, Schedule } from '@shiftora/shared';
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
const WEEK = '2026-11-09';

interface Clinic {
  owner: TestUser;
  org: string;
  locA: string;
  locB: string;
  scheduleA: string;
  scheduleB: string;
  manager: TestUser;
}

async function clinic(): Promise<Clinic> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locA = (await owner.call('POST', '/locations', { org, body: mumbai })).json<{
    id: string;
  }>().id;
  const locB = (await owner.call('POST', '/locations', { org, body: london })).json<{
    id: string;
  }>().id;
  const scheduleA = (
    await owner.call('POST', '/schedules', { org, body: { locationId: locA, weekStart: WEEK } })
  ).json<{ id: string }>().id;
  const scheduleB = (
    await owner.call('POST', '/schedules', { org, body: { locationId: locB, weekStart: WEEK } })
  ).json<{ id: string }>().id;
  const manager = await addMember(t.app, owner, org, 'manager');
  await owner.call('PUT', `/members/${manager.id}/locations`, {
    org,
    body: { locationIds: [locA] },
  });
  return { owner, org, locA, locB, scheduleA, scheduleB, manager };
}

async function addEmployee(owner: TestUser, org: string, locationId: string): Promise<string> {
  const res = await owner.call('POST', '/employees', {
    org,
    body: { name: 'Asha Mehta', hourlyRateMinor: 25_000, locationIds: [locationId] },
  });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>().id;
}

async function addShift(
  owner: TestUser,
  org: string,
  body: { scheduleId: string; employeeId?: string | null; date?: string; startTime?: string },
): Promise<string> {
  const res = await owner.call('POST', '/shifts', {
    org,
    body: {
      date: '2026-11-09',
      startTime: '09:00',
      endTime: '17:00',
      ...body,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<{ shift: { id: string } }>().shift.id;
}

describe('publishing a week', () => {
  it('flips the schedule to published and returns what changed', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, locA);
    await addShift(owner, org, { scheduleId: scheduleA, employeeId });
    await addShift(owner, org, { scheduleId: scheduleA, employeeId: null, date: '2026-11-10' });

    const res = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    expect(res.status).toBe(200);
    const { schedule, publication } = res.json<PublishResult>();

    expect(schedule).toMatchObject({ status: 'published', publishedVersion: schedule.version });
    expect(schedule.publishedAt).not.toBeNull();
    expect(publication.version).toBe(schedule.version);
    expect(publication.diff.added).toHaveLength(2);
    // The open shift concerns nobody yet; the assigned one concerns its employee.
    expect(publication.diff.affectedEmployeeIds).toEqual([employeeId]);
    expect(publication.diff.added[0]).toMatchObject({ date: '2026-11-09', startTime: '09:00' });
  });

  it('writes exactly one outbox event in the same transaction', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, locA);
    await addShift(owner, org, { scheduleId: scheduleA, employeeId });

    await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select()
        .from(schema.outbox)
        .where(and(eq(schema.outbox.orgId, org), eq(schema.outbox.topic, 'schedule.published'))),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      scheduleId: scheduleA,
      locationId: locA,
      weekStart: WEEK,
      affectedEmployeeIds: [employeeId],
      added: 1,
      changed: 0,
      removed: 0,
    });
    expect(events[0]?.publishedAt).toBeNull();
  });

  it('records who published and audits it', async () => {
    const { owner, org, scheduleA } = await clinic();
    await addShift(owner, org, { scheduleId: scheduleA });

    const res = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    const { publication } = res.json<PublishResult>();
    expect(publication.publishedBy).toBe(owner.id);

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.orgId, org),
            eq(schema.auditEvents.entityId, scheduleA),
            eq(schema.auditEvents.action, 'schedule.published'),
          ),
        ),
    );
    expect(events).toHaveLength(1);
  });

  it('publishing again with no edits tells nobody', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, locA);
    await addShift(owner, org, { scheduleId: scheduleA, employeeId });
    await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });

    const again = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    const { schedule, publication } = again.json<PublishResult>();
    expect(publication.diff).toMatchObject({ added: [], changed: [], removed: [] });
    expect(publication.diff.affectedEmployeeIds).toEqual([]);
    // A publication is still recorded: "we told them nothing new" is itself a fact.
    expect(publication.version).toBe(schedule.version);
  });

  it('after an edit only the affected people are in the next diff', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const asha = await addEmployee(owner, org, locA);
    const shifted = await addShift(owner, org, { scheduleId: scheduleA, employeeId: asha });
    const other = await addEmployee(owner, org, locA);
    await addShift(owner, org, { scheduleId: scheduleA, employeeId: other, date: '2026-11-10' });
    const published = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    expect(published.status).toBe(200);

    // Asha's shift changes hands: both people are affected, nobody else is.
    const moved = await owner.call('PATCH', `/shifts/${shifted}`, {
      org,
      body: { employeeId: other },
    });
    expect(moved.status).toBe(200);

    const preview = await owner.call('GET', `/schedules/${scheduleA}/publish-preview`, { org });
    expect(preview.status).toBe(200);
    const body = preview.json<PublishPreview>();
    expect(body.hasChanges).toBe(true);
    expect(body.diff.changed).toHaveLength(1);
    expect(body.diff.affectedEmployeeIds.sort()).toEqual([asha, other].sort());

    const schedule = (await owner.call('GET', `/schedules/${scheduleA}`, { org })).json<Schedule>();
    expect(schedule.version).toBeGreaterThan(schedule.publishedVersion!);

    const second = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    const { schedule: after } = second.json<PublishResult>();
    expect(after.publishedVersion).toBe(after.version);
  });

  it('reports a deleted shift as removed for the person who had it', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, locA);
    const shiftId = await addShift(owner, org, { scheduleId: scheduleA, employeeId });
    await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    await owner.call('DELETE', `/shifts/${shiftId}`, { org });

    const preview = await owner.call('GET', `/schedules/${scheduleA}/publish-preview`, { org });
    expect(preview.json<PublishPreview>().diff).toMatchObject({
      added: [],
      changed: [],
    });
    expect(preview.json<PublishPreview>().diff.removed).toHaveLength(1);
    expect(preview.json<PublishPreview>().diff.affectedEmployeeIds).toEqual([employeeId]);
  });

  it('a preview does not write anything', async () => {
    const { owner, org, scheduleA } = await clinic();
    await addShift(owner, org, { scheduleId: scheduleA });
    await owner.call('GET', `/schedules/${scheduleA}/publish-preview`, { org });

    const schedule = (await owner.call('GET', `/schedules/${scheduleA}`, { org })).json<Schedule>();
    expect(schedule.status).toBe('draft');
    expect(schedule.publishedVersion).toBeNull();
    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx.select().from(schema.outbox).where(eq(schema.outbox.orgId, org)),
    );
    // Setup may have invited people, and an invite writes its own event; what must not exist is a
    // publication event from a preview.
    expect(events.filter((event) => event.topic === 'schedule.published')).toHaveLength(0);
  });

  it('publishes an empty week without inventing an audience', async () => {
    const { owner, org, scheduleA } = await clinic();
    const res = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    expect(res.status).toBe(200);
    expect(res.json<PublishResult>().publication.diff.affectedEmployeeIds).toEqual([]);
  });
});

describe('who may publish', () => {
  it('a manager in scope may; a manager out of scope gets 404', async () => {
    const { manager, org, scheduleA, scheduleB } = await clinic();
    const inScope = await manager.call('POST', `/schedules/${scheduleA}/publish`, { org });
    expect(inScope.status).toBe(200);

    const outOfScope = await manager.call('POST', `/schedules/${scheduleB}/publish`, { org });
    expect(outOfScope.status).toBe(404);
  });

  it('refuses an employee and another organisation', async () => {
    const first = await clinic();
    const other = await clinic();
    const staff = await addMember(t.app, first.owner, first.org, 'employee');

    const forbidden = await staff.call('POST', `/schedules/${first.scheduleA}/publish`, {
      org: first.org,
    });
    expect(forbidden.status).toBe(403);

    const foreign = await other.owner.call('POST', `/schedules/${first.scheduleA}/publish`, {
      org: other.org,
    });
    expect(foreign.status).toBe(404);
  });

  it('refuses a read-only location', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    await owner.call('PATCH', `/locations/${locA}`, { org, body: { status: 'read_only' } });
    const res = await owner.call('POST', `/schedules/${scheduleA}/publish`, { org });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'location.read_only' });
  });
});
