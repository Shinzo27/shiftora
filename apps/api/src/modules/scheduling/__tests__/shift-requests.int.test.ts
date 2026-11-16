import { and, eq, schema, sql } from '@shiftora/db';
import { addDays, startOfWeek, toLocal } from '@shiftora/domain';
import type { ShiftRequestView } from '@shiftora/shared';
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
 * W5 D2: swap and drop requests through the API. Staff ask and answer, a manager always decides,
 * and approval re-checks everything with both shifts locked.
 */

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const ZONE = 'Asia/Kolkata';
// Two weeks ahead, computed: the shifts must be in the future whenever the suite runs.
const WEEK = addDays(startOfWeek(toLocal(new Date(), ZONE).date), 14);
const day = (n: number) => addDays(WEEK, n);
const andheri = { name: 'Andheri', latitude: 19.11, longitude: 72.84, timezone: ZONE };
const bandra = { name: 'Bandra', latitude: 19.06, longitude: 72.83, timezone: ZONE };

interface Staff {
  user: TestUser;
  employeeId: string;
}

interface Clinic {
  owner: TestUser;
  org: string;
  locationId: string;
  otherLocationId: string;
  scheduleId: string;
  asha: Staff;
  rohan: Staff;
}

/** A staff login: signs up, joins as an employee, gets a staff profile at these locations. */
async function staff(
  owner: TestUser,
  org: string,
  name: string,
  locationIds: string[],
): Promise<Staff> {
  const user = await addMember(t.app, owner, org, 'employee');
  const res = await owner.call('POST', '/employees', {
    org,
    body: { name, hourlyRateMinor: 25_000, userId: user.id, locationIds },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { user, employeeId: res.json<{ id: string }>().id };
}

async function clinic(): Promise<Clinic> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locationId = (await owner.call('POST', '/locations', { org, body: andheri })).json<{
    id: string;
  }>().id;
  const otherLocationId = (await owner.call('POST', '/locations', { org, body: bandra })).json<{
    id: string;
  }>().id;
  const scheduleId = (
    await owner.call('POST', '/schedules', { org, body: { locationId, weekStart: WEEK } })
  ).json<{ id: string }>().id;
  const asha = await staff(owner, org, 'Asha Mehta', [locationId]);
  const rohan = await staff(owner, org, 'Rohan Desai', [locationId]);
  return { owner, org, locationId, otherLocationId, scheduleId, asha, rohan };
}

async function shift(
  c: Clinic,
  employeeId: string | null,
  date: string,
  startTime = '09:00',
  endTime = '17:00',
): Promise<string> {
  const res = await c.owner.call('POST', '/shifts', {
    org: c.org,
    body: { scheduleId: c.scheduleId, employeeId, date, startTime, endTime },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<{ shift: { id: string } }>().shift.id;
}

async function publish(c: Clinic): Promise<void> {
  const res = await c.owner.call('POST', `/schedules/${c.scheduleId}/publish`, { org: c.org });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

function ask(c: Clinic, who: Staff, body: object) {
  return who.user.call('POST', '/me/shift-requests', { org: c.org, body });
}

async function asked(c: Clinic, who: Staff, body: object): Promise<ShiftRequestView> {
  const res = await ask(c, who, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<ShiftRequestView>();
}

const act = (c: Clinic, who: TestUser, path: string, body: object = {}) =>
  who.call('POST', path, { org: c.org, body });

async function shiftRow(c: Clinic, id: string) {
  return t.queryAs({ userId: c.owner.id, orgId: c.org }, async (tx) => {
    const [row] = await tx
      .select({ employeeId: schema.shifts.employeeId, status: schema.shifts.status })
      .from(schema.shifts)
      .where(eq(schema.shifts.id, id));
    return row!;
  });
}

async function topics(c: Clinic): Promise<string[]> {
  const rows = await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
    tx
      .select({ topic: schema.outbox.topic })
      .from(schema.outbox)
      .where(and(eq(schema.outbox.orgId, c.org), sql`topic like 'shift_request.%'`))
      .orderBy(schema.outbox.createdAt),
  );
  return rows.map((row) => row.topic);
}

describe('a swap', () => {
  it('Asha asks, Rohan accepts, a manager approves: the shift is Rohan’s and staff were told', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);

    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
      note: 'Family wedding',
    });
    expect(request).toMatchObject({
      status: 'pending_colleague',
      requester: { name: 'Asha Mehta' },
      colleague: { name: 'Rohan Desai' },
      actions: ['cancel'],
    });

    // Rohan sees it with his own buttons.
    const rohansView = await c.rohan.user.call('GET', '/me/shift-requests', { org: c.org });
    expect(rohansView.json<ShiftRequestView[]>()[0]!.actions).toEqual([
      'colleague_accept',
      'colleague_decline',
    ]);

    const accepted = await act(c, c.rohan.user, `/me/shift-requests/${request.id}/accept`);
    expect(accepted.json<ShiftRequestView>().status).toBe('pending_manager');
    // Still Asha's until a manager decides.
    expect((await shiftRow(c, given)).employeeId).toBe(c.asha.employeeId);

    const approved = await act(c, c.owner, `/shift-requests/${request.id}/approve`, {
      note: 'OK',
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.json<ShiftRequestView>()).toMatchObject({
      status: 'approved',
      decisionNote: 'OK',
    });
    expect(await shiftRow(c, given)).toEqual({
      employeeId: c.rohan.employeeId,
      status: 'assigned',
    });

    // What staff were told now says Rohan, and the board shows nothing unpublished.
    const told = await t.queryAs({ userId: c.owner.id, orgId: c.org }, async (tx) => {
      const [schedule] = await tx
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.id, c.scheduleId));
      const [latest] = await tx
        .select()
        .from(schema.schedulePublications)
        .where(eq(schema.schedulePublications.scheduleId, c.scheduleId))
        .orderBy(sql`published_at desc`)
        .limit(1);
      return { schedule: schedule!, latest: latest! };
    });
    expect(told.schedule.version).toBe(told.schedule.publishedVersion);
    expect(told.latest.shifts.find((s) => s.shiftId === given)?.employeeId).toBe(
      c.rohan.employeeId,
    );

    expect(await topics(c)).toEqual([
      'shift_request.created',
      'shift_request.accepted',
      'shift_request.approved',
    ]);
  });

  it('an exchange: each takes the other’s shift', async () => {
    const c = await clinic();
    const ashas = await shift(c, c.asha.employeeId, day(1));
    const rohans = await shift(c, c.rohan.employeeId, day(2));
    await publish(c);

    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: ashas,
      targetEmployeeId: c.rohan.employeeId,
      targetShiftId: rohans,
    });
    await act(c, c.rohan.user, `/me/shift-requests/${request.id}/accept`);
    const approved = await act(c, c.owner, `/shift-requests/${request.id}/approve`);

    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await shiftRow(c, ashas)).employeeId).toBe(c.rohan.employeeId);
    expect((await shiftRow(c, rohans)).employeeId).toBe(c.asha.employeeId);
  });

  it('an exchange of overlapping shifts works: nobody holds both mid-swap', async () => {
    const c = await clinic();
    const ashas = await shift(c, c.asha.employeeId, day(1), '09:00', '17:00');
    const rohans = await shift(c, c.rohan.employeeId, day(1), '13:00', '21:00');
    await publish(c);

    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: ashas,
      targetEmployeeId: c.rohan.employeeId,
      targetShiftId: rohans,
    });
    await act(c, c.rohan.user, `/me/shift-requests/${request.id}/accept`);
    const approved = await act(c, c.owner, `/shift-requests/${request.id}/approve`);

    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await shiftRow(c, ashas)).employeeId).toBe(c.rohan.employeeId);
    expect((await shiftRow(c, rohans)).employeeId).toBe(c.asha.employeeId);
  });

  it('is never approved before the colleague accepts, and only a manager approves', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
    });

    const early = await act(c, c.owner, `/shift-requests/${request.id}/approve`);
    expect(early.status).toBe(409);
    expect(early.json()).toMatchObject({ code: 'shift_request.invalid_transition' });

    await act(c, c.rohan.user, `/me/shift-requests/${request.id}/accept`);
    // Staff cannot reach the manager routes at all.
    expect((await act(c, c.rohan.user, `/shift-requests/${request.id}/approve`)).status).toBe(403);
    // Asha cannot accept her own request; it is not Rohan's to cancel.
    expect((await act(c, c.asha.user, `/me/shift-requests/${request.id}/accept`)).status).toBe(409);
    expect((await act(c, c.rohan.user, `/me/shift-requests/${request.id}/cancel`)).status).toBe(
      409,
    );
  });

  it('someone outside the request cannot act on it (404)', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
    });
    const meera = await staff(c.owner, c.org, 'Meera Iyer', [c.locationId]);

    expect((await act(c, meera.user, `/me/shift-requests/${request.id}/accept`)).status).toBe(404);
  });

  it('a declined swap is over: nothing changes', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
    });

    const declined = await act(c, c.rohan.user, `/me/shift-requests/${request.id}/decline`);

    expect(declined.json<ShiftRequestView>()).toMatchObject({ status: 'declined', actions: [] });
    expect((await shiftRow(c, given)).employeeId).toBe(c.asha.employeeId);
  });
});

describe('approval re-checks the rota', () => {
  it('refuses a colleague who would be on two shifts at once (409 not_eligible)', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1), '09:00', '17:00');
    await publish(c);
    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
    });
    await act(c, c.rohan.user, `/me/shift-requests/${request.id}/accept`);
    // Meanwhile Rohan was put on an overlapping shift.
    await shift(c, c.rohan.employeeId, day(1), '12:00', '20:00');

    const res = await act(c, c.owner, `/shift-requests/${request.id}/approve`, {
      acknowledgeWarnings: true,
    });

    expect(res.status).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'shift_request.not_eligible',
      errors: [expect.objectContaining({ path: 'colleague' })],
    });
    expect((await shiftRow(c, given)).employeeId).toBe(c.asha.employeeId);
  });

  it('refuses a colleague who does not work at the shift’s location', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const elsewhere = await staff(c.owner, c.org, 'Kiran Rao', [c.otherLocationId]);
    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: elsewhere.employeeId,
    });
    await act(c, elsewhere.user, `/me/shift-requests/${request.id}/accept`);

    const res = await act(c, c.owner, `/shift-requests/${request.id}/approve`);

    expect(res.status).toBe(409);
    expect(res.json()).toMatchObject({
      errors: [{ path: 'colleague', message: 'Does not work at this location' }],
    });
  });

  it('a rule a manager may overrule needs "approve anyway"', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1), '09:00', '17:00');
    await publish(c);
    // Rohan works late the night before: taking Asha's 09:00 leaves him too little rest.
    const patched = await c.owner.call('PATCH', `/employees/${c.rohan.employeeId}`, {
      org: c.org,
      body: { minRestMinutes: 11 * 60 },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    await shift(c, c.rohan.employeeId, day(0), '18:00', '23:00');
    const request = await asked(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
    });
    await act(c, c.rohan.user, `/me/shift-requests/${request.id}/accept`);

    const first = await act(c, c.owner, `/shift-requests/${request.id}/approve`);
    expect(first.status).toBe(409);
    expect(first.json()).toMatchObject({ code: 'shift_request.needs_acknowledgement' });
    expect((await shiftRow(c, given)).employeeId).toBe(c.asha.employeeId);

    const second = await act(c, c.owner, `/shift-requests/${request.id}/approve`, {
      acknowledgeWarnings: true,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await shiftRow(c, given)).employeeId).toBe(c.rohan.employeeId);
  });

  it('a shift the manager moved since the request cannot be approved from the old request', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    const meera = await staff(c.owner, c.org, 'Meera Iyer', [c.locationId]);
    await publish(c);
    const request = await asked(c, c.asha, { type: 'drop', shiftId: given });
    await c.owner.call('PATCH', `/shifts/${given}`, {
      org: c.org,
      body: { employeeId: meera.employeeId },
    });

    const res = await act(c, c.owner, `/shift-requests/${request.id}/approve`);

    expect(res.status).toBe(409);
    expect((await shiftRow(c, given)).employeeId).toBe(meera.employeeId);
  });

  it('two managers approving at once: one wins, the other gets 409, nothing is done twice', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const manager = await addMember(t.app, c.owner, c.org, 'manager');
    const request = await asked(c, c.asha, { type: 'drop', shiftId: given });

    const results = await Promise.all([
      act(c, c.owner, `/shift-requests/${request.id}/approve`),
      act(c, manager, `/shift-requests/${request.id}/approve`),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const audits = await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
      tx
        .select({ action: schema.auditEvents.action })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.orgId, c.org),
            eq(schema.auditEvents.action, 'shift_request.approved'),
          ),
        ),
    );
    expect(audits).toHaveLength(1);
  });
});

describe('a drop', () => {
  it('goes straight to a manager; approved, the shift is open', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);

    const request = await asked(c, c.asha, { type: 'drop', shiftId: given, note: 'Exam' });
    expect(request.status).toBe('pending_manager');
    const inbox = await c.owner.call('GET', '/shift-requests', { org: c.org });
    expect(inbox.json<ShiftRequestView[]>().map((r) => r.id)).toEqual([request.id]);
    expect(inbox.json<ShiftRequestView[]>()[0]!.actions).toEqual([
      'manager_approve',
      'manager_reject',
    ]);

    await act(c, c.owner, `/shift-requests/${request.id}/approve`);

    expect(await shiftRow(c, given)).toEqual({ employeeId: null, status: 'open' });
  });

  it('a rejected drop leaves the shift, with the manager’s reason', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const request = await asked(c, c.asha, { type: 'drop', shiftId: given });

    const res = await act(c, c.owner, `/shift-requests/${request.id}/reject`, {
      note: 'Nobody else is free',
    });

    expect(res.json<ShiftRequestView>()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Nobody else is free',
    });
    expect((await shiftRow(c, given)).employeeId).toBe(c.asha.employeeId);
  });
});

describe('what can be asked', () => {
  it('one request at a time per shift; withdrawing frees it', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const first = await asked(c, c.asha, { type: 'drop', shiftId: given });

    const second = await ask(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.rohan.employeeId,
    });
    expect(second.status).toBe(409);
    expect(second.json()).toMatchObject({ code: 'shift_request.already_open' });

    await act(c, c.asha.user, `/me/shift-requests/${first.id}/cancel`);
    expect((await ask(c, c.asha, { type: 'drop', shiftId: given })).status).toBe(201);
  });

  it('only a published shift of one’s own', async () => {
    const c = await clinic();
    const draft = await shift(c, c.asha.employeeId, day(1));
    const notMine = await shift(c, c.rohan.employeeId, day(2));

    const unpublished = await ask(c, c.asha, { type: 'drop', shiftId: draft });
    expect(unpublished.status).toBe(409);
    expect(unpublished.json()).toMatchObject({ code: 'shift_request.not_published' });

    await publish(c);
    expect((await ask(c, c.asha, { type: 'drop', shiftId: notMine })).status).toBe(404);
  });

  it('a swap needs a colleague with a login, not oneself', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const noLogin = (
      await c.owner.call('POST', '/employees', {
        org: c.org,
        body: { name: 'Dev Kumar', hourlyRateMinor: 25_000, locationIds: [c.locationId] },
      })
    ).json<{ id: string }>().id;

    const self = await ask(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: c.asha.employeeId,
    });
    const nobody = await ask(c, c.asha, {
      type: 'swap',
      shiftId: given,
      targetEmployeeId: noLogin,
    });
    const missing = await ask(c, c.asha, { type: 'swap', shiftId: given });

    expect([self.status, nobody.status, missing.status]).toEqual([400, 400, 400]);
  });

  it('an owner with no staff profile has nothing to ask about (403)', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const res = await c.owner.call('POST', '/me/shift-requests', {
      org: c.org,
      body: { type: 'drop', shiftId: given },
    });
    expect(res.status).toBe(403);
    expect(res.json()).toMatchObject({ code: 'employee.profile_required' });
  });
});

describe('who sees what', () => {
  it('a manager scoped to another location does not see the request (404, empty inbox)', async () => {
    const c = await clinic();
    const given = await shift(c, c.asha.employeeId, day(1));
    await publish(c);
    const request = await asked(c, c.asha, { type: 'drop', shiftId: given });
    const bandraManager = await addMember(t.app, c.owner, c.org, 'manager');
    await c.owner.call('PUT', `/members/${bandraManager.id}/locations`, {
      org: c.org,
      body: { locationIds: [c.otherLocationId] },
    });

    const inbox = await bandraManager.call('GET', '/shift-requests', { org: c.org });
    expect(inbox.json()).toEqual([]);
    expect((await act(c, bandraManager, `/shift-requests/${request.id}/approve`)).status).toBe(404);
  });

  it("another org's request does not exist here", async () => {
    const a = await clinic();
    const b = await clinic();
    const given = await shift(a, a.asha.employeeId, day(1));
    await publish(a);
    const request = await asked(a, a.asha, { type: 'drop', shiftId: given });

    const res = await b.owner.call('GET', `/shift-requests/${request.id}`, { org: b.org });
    expect(res.status).toBe(404);
    expect((await b.owner.call('GET', '/shift-requests', { org: b.org })).json()).toEqual([]);
  });
});
