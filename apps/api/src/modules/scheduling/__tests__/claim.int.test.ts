import { and, eq, schema } from '@shiftora/db';
import { addDays, startOfWeek, toLocal } from '@shiftora/domain';
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
 * W5 D4: claiming an open shift.
 *
 * The point of this file is one race — two eligible people, one shift, the same instant — and the
 * retry that must not turn one claim into two.
 */

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const ZONE = 'Asia/Kolkata';
const WEEK = addDays(startOfWeek(toLocal(new Date(), ZONE).date), 21);
const day = (n: number) => addDays(WEEK, n);

interface Clinic {
  owner: TestUser;
  org: string;
  locationId: string;
  nurse: string;
  scheduleId: string;
}

async function clinic(): Promise<Clinic> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locationId = (
    await owner.call('POST', '/locations', {
      org,
      body: { name: 'Bandra', latitude: 19.06, longitude: 72.83, timezone: ZONE },
    })
  ).json<{ id: string }>().id;
  const nurse = (await owner.call('POST', '/job-roles', { org, body: { name: 'Nurse' } })).json<{
    id: string;
  }>().id;
  const scheduleId = (
    await owner.call('POST', '/schedules', { org, body: { locationId, weekStart: WEEK } })
  ).json<{ id: string }>().id;
  return { owner, org, locationId, nurse, scheduleId };
}

async function staff(c: Clinic, name: string): Promise<{ user: TestUser; employeeId: string }> {
  const user = await addMember(t.app, c.owner, c.org, 'employee');
  const res = await c.owner.call('POST', '/employees', {
    org: c.org,
    body: {
      name,
      hourlyRateMinor: 25_000,
      userId: user.id,
      locationIds: [c.locationId],
      jobRoleIds: [c.nurse],
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { user, employeeId: res.json<{ id: string }>().id };
}

/** An open shift, offered to everyone who could take it. */
async function offered(c: Clinic, date = day(2)): Promise<string> {
  const created = await c.owner.call('POST', '/shifts', {
    org: c.org,
    body: {
      scheduleId: c.scheduleId,
      jobRoleId: c.nurse,
      date,
      startTime: '09:00',
      endTime: '17:00',
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.json<{ shift: { id: string } }>().shift.id;

  const offer = await c.owner.call('POST', `/shifts/${id}/offer`, { org: c.org });
  expect(offer.status, JSON.stringify(offer.body)).toBe(200);
  return id;
}

const claim = (c: Clinic, user: TestUser, shiftId: string, key: string | null) =>
  user.call('POST', `/me/open-shifts/${shiftId}/claim`, {
    org: c.org,
    ...(key ? { headers: { 'idempotency-key': key } } : {}),
  });

const newKey = () => `claim-${crypto.randomUUID()}`;

const shiftRow = async (c: Clinic, id: string) => {
  const [row] = await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
    tx.select().from(schema.shifts).where(eq(schema.shifts.id, id)),
  );
  return row;
};

describe('claiming an open shift', () => {
  it('gives it to exactly one of three people who claim at the same moment', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const rohan = await staff(c, 'Rohan Desai');
    const id = await offered(c);

    const results = await Promise.all([
      claim(c, asha.user, id, newKey()),
      claim(c, rohan.user, id, newKey()),
      claim(c, c.owner, id, newKey()),
    ]);
    const statuses = results.map((result) => result.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(2);

    const row = await shiftRow(c, id);
    expect(row?.status).toBe('assigned');
    const winner = results.find((result) => result.status === 200);
    expect(winner?.json<{ shift: { employeeId: string } }>().shift.employeeId).toBe(
      row?.employeeId,
    );
  });

  it('answers a retry with the first answer, and claims once', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const id = await offered(c);
    const key = newKey();

    const first = await claim(c, asha.user, id, key);
    expect(first.status).toBe(200);
    const retry = await claim(c, asha.user, id, key);

    expect(retry.status).toBe(200);
    expect(retry.json()).toEqual(first.json());
    // The retry is an answer, not a second claim: one audit row, one event, one assignment.
    const row = await shiftRow(c, id);
    expect(row?.employeeId).toBe(asha.employeeId);
    expect(row?.version).toBe(first.json<{ shift: { version: number } }>().shift.version);
  });

  it('refuses the same key used for a different shift', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const first = await offered(c, day(2));
    const second = await offered(c, day(3));
    const key = newKey();

    expect((await claim(c, asha.user, first, key)).status).toBe(200);
    const reused = await claim(c, asha.user, second, key);
    expect(reused.status).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'idempotency.key_reuse' });
  });

  it('refuses a claim with no Idempotency-Key', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const id = await offered(c);

    const result = await claim(c, asha.user, id, null);
    expect(result.status).toBe(400);
    expect(result.json()).toMatchObject({ code: 'idempotency.key_required' });
  });

  it('refuses a shift nobody offered', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const created = await c.owner.call('POST', '/shifts', {
      org: c.org,
      body: {
        scheduleId: c.scheduleId,
        jobRoleId: c.nurse,
        date: day(4),
        startTime: '09:00',
        endTime: '17:00',
      },
    });
    const id = created.json<{ shift: { id: string } }>().shift.id;

    const result = await claim(c, asha.user, id, newKey());
    expect(result.status).toBe(409);
    expect(result.json()).toMatchObject({ code: 'shift.not_open' });
  });

  it('tells the loser the shift has gone', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const rohan = await staff(c, 'Rohan Desai');
    const id = await offered(c);

    expect((await claim(c, asha.user, id, newKey())).status).toBe(200);
    const second = await claim(c, rohan.user, id, newKey());
    expect(second.status).toBe(409);
    expect(second.json()).toMatchObject({ code: 'shift.already_taken' });
  });

  it('writes an audit row and one event, so the change is not silent', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const id = await offered(c);
    await claim(c, asha.user, id, newKey());

    const audit = await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(
          and(eq(schema.auditEvents.action, 'shift.claimed'), eq(schema.auditEvents.entityId, id)),
        ),
    );
    expect(audit).toHaveLength(1);
    expect((audit[0]?.after as { employeeId: string }).employeeId).toBe(asha.employeeId);

    const events = await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
      tx.select().from(schema.outbox).where(eq(schema.outbox.topic, 'shift.claimed')),
    );
    expect(
      events.filter((row) => (row.payload as { shiftId: string }).shiftId === id),
    ).toHaveLength(1);
  });

  it('keeps the claimer’s own list honest: the shift is gone from it afterwards', async () => {
    const c = await clinic();
    const asha = await staff(c, 'Asha Mehta');
    const id = await offered(c);

    const before = await asha.user.call('GET', '/me/open-shifts', { org: c.org });
    expect(before.json<{ id: string }[]>().map((shift) => shift.id)).toContain(id);

    await claim(c, asha.user, id, newKey());

    const after = await asha.user.call('GET', '/me/open-shifts', { org: c.org });
    expect(after.json<{ id: string }[]>().map((shift) => shift.id)).not.toContain(id);
  });
});
