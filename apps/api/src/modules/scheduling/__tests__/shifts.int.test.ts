import { and, eq, schema } from '@shiftora/db';
import type { Employee, Shift, ShiftWriteResult } from '@shiftora/shared';
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
const WEEK = '2026-11-09'; // a Monday

interface Clinic {
  owner: TestUser;
  org: string;
  locA: string;
  locB: string;
  scheduleA: string;
  scheduleB: string;
  manager: TestUser;
}

async function createLocation(owner: TestUser, org: string, body: object): Promise<string> {
  const res = await owner.call('POST', '/locations', { org, body });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>().id;
}

async function createSchedule(
  owner: TestUser,
  org: string,
  locationId: string,
  weekStart = WEEK,
): Promise<string> {
  const res = await owner.call('POST', '/schedules', { org, body: { locationId, weekStart } });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>().id;
}

/** An org with a Mumbai branch (schedule A) and a London one, and a manager scoped to A. */
async function clinic(weekStart = WEEK): Promise<Clinic> {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const locA = await createLocation(owner, org, mumbai);
  const locB = await createLocation(owner, org, london);
  const scheduleA = await createSchedule(owner, org, locA, weekStart);
  const scheduleB = await createSchedule(owner, org, locB, weekStart);
  const manager = await addMember(t.app, owner, org, 'manager');
  await owner.call('PUT', `/members/${manager.id}/locations`, {
    org,
    body: { locationIds: [locA] },
  });
  return { owner, org, locA, locB, scheduleA, scheduleB, manager };
}

async function addEmployee(
  owner: TestUser,
  org: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await owner.call('POST', '/employees', {
    org,
    body: { name: 'Asha Mehta', hourlyRateMinor: 25_000, ...body },
  });
  expect(res.status).toBe(201);
  return res.json<Employee>().id;
}

interface ShiftBody {
  scheduleId: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  employeeId?: string | null;
  jobRoleId?: string | null;
}

function shiftBody(body: ShiftBody) {
  return {
    date: '2026-11-09',
    startTime: '09:00',
    endTime: '17:00',
    ...body,
  };
}

/** Creates a shift and returns the whole write result (shift + warnings). */
async function createShift(
  user: TestUser,
  org: string,
  body: ShiftBody,
  expectStatus = 201,
): Promise<ShiftWriteResult> {
  const res = await user.call('POST', '/shifts', { org, body: shiftBody(body) });
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  return res.json<ShiftWriteResult>();
}

function codes(warnings: { code: string }[]): string[] {
  return warnings.map((warning) => warning.code);
}

describe('creating shifts', () => {
  it('creates an assigned shift with local wall-clock times and paid minutes', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });

    const { shift, warnings } = await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      startTime: '09:00',
      endTime: '17:00',
      breakMinutes: 30,
    });

    expect(warnings).toEqual([]);
    expect(shift).toMatchObject({
      scheduleId: scheduleA,
      locationId: locA,
      employeeId,
      date: '2026-11-09',
      startTime: '09:00',
      endTime: '17:00',
      breakMinutes: 30,
      paidMinutes: 450,
      status: 'assigned',
      version: 1,
    });
    // 09:00 IST is 03:30 UTC.
    expect(shift.startsAt).toBe('2026-11-09T03:30:00.000Z');
    expect(shift.endsAt).toBe('2026-11-09T11:30:00.000Z');
  });

  it('creates an open shift when nobody is assigned', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA });
    expect(shift).toMatchObject({ employeeId: null, status: 'open' });
  });

  it('stores an overnight shift as one range and reports 8 h', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, {
      scheduleId: scheduleA,
      date: '2026-11-10',
      startTime: '22:00',
      endTime: '06:00',
    });
    expect(shift).toMatchObject({ date: '2026-11-10', startTime: '22:00', endTime: '06:00' });
    expect(shift.paidMinutes).toBe(480);
    expect(shift.endsAt).toBe('2026-11-11T00:30:00.000Z');
  });

  it('uses real elapsed time across a DST change: 7 h on the London spring-forward night', async () => {
    const { owner, org, scheduleB } = await clinic('2026-03-23');
    const { shift } = await createShift(owner, org, {
      scheduleId: scheduleB,
      date: '2026-03-28',
      startTime: '22:00',
      endTime: '06:00',
    });
    // 22:00 GMT on the 28th to 06:00 BST on the 29th.
    expect(shift.startsAt).toBe('2026-03-28T22:00:00.000Z');
    expect(shift.endsAt).toBe('2026-03-29T05:00:00.000Z');
    expect(shift.paidMinutes).toBe(420);
  });

  it('writes an audit event in the same transaction', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA });
    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.orgId, org), eq(schema.auditEvents.entityId, shift.id))),
    );
    expect(events.map((event) => event.action)).toEqual(['shift.created']);
  });

  it('rejects a date outside the schedule’s week', async () => {
    const { owner, org, scheduleA } = await clinic();
    const res = await owner.call('POST', '/shifts', {
      org,
      body: shiftBody({ scheduleId: scheduleA, date: '2026-11-16' }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', errors: [{ path: 'date' }] });
  });
});

describe('no double-booking', () => {
  it('refuses an overlapping shift for the same employee', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });
    await createShift(owner, org, { scheduleId: scheduleA, employeeId, startTime: '09:00' });

    const res = await owner.call('POST', '/shifts', {
      org,
      body: shiftBody({ scheduleId: scheduleA, employeeId, startTime: '16:00', endTime: '22:00' }),
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'shift.overlap' });
    // The message names the shift that is in the way, in the location's local time.
    expect((res.body as { detail: string }).detail).toContain('Already working Mon 09:00–17:00');
  });

  it('allows back-to-back shifts', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });
    await createShift(owner, org, { scheduleId: scheduleA, employeeId, startTime: '09:00' });
    await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      startTime: '17:00',
      endTime: '23:00',
    });
  });

  it('counts overlap across locations', async () => {
    const { owner, org, locA, locB, scheduleA, scheduleB } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA, locB] });
    await createShift(owner, org, { scheduleId: scheduleA, employeeId, startTime: '09:00' });

    // 09:00–17:00 IST at the London schedule is 14:30–22:30 IST: they cross.
    const res = await owner.call('POST', '/shifts', {
      org,
      body: shiftBody({
        scheduleId: scheduleB,
        employeeId,
        date: '2026-11-09',
        startTime: '09:00',
        endTime: '17:00',
      }),
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'shift.overlap' });
  });
});

describe('warnings: shown, not blocked', () => {
  it('warns when the shift is outside the employee’s availability', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });
    await owner.call('PUT', `/employees/${employeeId}/availability`, {
      org,
      body: { slots: [{ weekday: 1, start: '09:00', end: '17:00' }] },
    });

    const { shift, warnings } = await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      startTime: '18:00',
      endTime: '22:00',
    });
    expect(shift.status).toBe('assigned');
    expect(codes(warnings)).toEqual(['unavailable']);
    expect(warnings[0]?.message).toBe('Not available Mon 18:00–22:00');
  });

  it('warns when the shift falls in booked time off', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });
    await owner.call('POST', `/employees/${employeeId}/time-off`, {
      org,
      body: { startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-11-11T00:00:00.000Z' },
    });

    const { warnings } = await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      date: '2026-11-10',
    });
    expect(codes(warnings)).toEqual(['time_off']);
  });

  it('warns when the week would go over the employee’s hour cap', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, {
      locationIds: [locA],
      maxWeeklyMinutes: 480,
    });
    const first = await createShift(owner, org, { scheduleId: scheduleA, employeeId });
    expect(codes(first.warnings)).toEqual([]);

    const second = await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      date: '2026-11-10',
    });
    expect(codes(second.warnings)).toEqual(['max_weekly_hours']);
    expect(second.warnings[0]?.message).toBe('This week would be 16 h (limit 8 h)');
  });

  it('warns when the rest between two shifts is too short', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, {
      locationIds: [locA],
      minRestMinutes: 660,
    });
    await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      startTime: '15:00',
      endTime: '23:00',
    });

    const { warnings } = await createShift(owner, org, {
      scheduleId: scheduleA,
      employeeId,
      date: '2026-11-10',
      startTime: '07:00',
      endTime: '15:00',
    });
    expect(codes(warnings)).toEqual(['min_rest']);
    expect(warnings[0]?.message).toContain('Only 8 h rest');
    // The recorded hours still happen: those are the manager's call.
    expect(warnings[0]?.shiftId).toBeDefined();
  });
});

describe('reading shifts', () => {
  it('lists a schedule’s shifts in time order', async () => {
    const { owner, org, scheduleA } = await clinic();
    const late = await createShift(owner, org, {
      scheduleId: scheduleA,
      date: '2026-11-11',
      startTime: '13:00',
      endTime: '18:00',
    });
    const early = await createShift(owner, org, { scheduleId: scheduleA });

    const res = await owner.call('GET', `/shifts?scheduleId=${scheduleA}`, { org });
    expect(res.status).toBe(200);
    const shifts = res.json<Shift[]>();
    expect(shifts.map((shift) => shift.id)).toEqual([early.shift.id, late.shift.id]);
  });

  it('does not list another organisation’s schedule', async () => {
    const first = await clinic();
    const other = await clinic();
    const res = await other.owner.call('GET', `/shifts?scheduleId=${first.scheduleA}`, {
      org: other.org,
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'schedule.not_found' });
  });
});

describe('changing shifts', () => {
  it('moves a shift and bumps the version', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA });

    const res = await owner.call('PATCH', `/shifts/${shift.id}`, {
      org,
      body: { startTime: '10:00', endTime: '18:00', version: shift.version },
    });
    expect(res.status).toBe(200);
    const updated = res.json<ShiftWriteResult>();
    expect(updated.shift).toMatchObject({ startTime: '10:00', endTime: '18:00', version: 2 });
    expect(updated.warnings).toEqual([]);
  });

  it('refuses a stale version', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA });
    const first = await owner.call('PATCH', `/shifts/${shift.id}`, {
      org,
      body: { breakMinutes: 15, version: shift.version },
    });
    expect(first.status).toBe(200);

    const stale = await owner.call('PATCH', `/shifts/${shift.id}`, {
      org,
      body: { breakMinutes: 30, version: shift.version },
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'shift.version_conflict' });
  });

  it('unassigning makes the shift open again', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA, employeeId });

    const res = await owner.call('PATCH', `/shifts/${shift.id}`, {
      org,
      body: { employeeId: null },
    });
    expect(res.status).toBe(200);
    expect(res.json<ShiftWriteResult>().shift).toMatchObject({
      employeeId: null,
      status: 'open',
    });
  });

  it('rejects a change that moves the shift outside its week or makes the break too long', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA, breakMinutes: 30 });

    const outside = await owner.call('PATCH', `/shifts/${shift.id}`, {
      org,
      body: { date: '2026-11-20' },
    });
    expect(outside.status).toBe(400);
    expect(outside.body).toMatchObject({ errors: [{ path: 'date' }] });

    const tooLong = await owner.call('PATCH', `/shifts/${shift.id}`, {
      org,
      body: { endTime: '09:20' },
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({ errors: [{ path: 'breakMinutes' }] });
  });

  it('deletes a shift, removes it from the list and records it', async () => {
    const { owner, org, scheduleA } = await clinic();
    const { shift } = await createShift(owner, org, { scheduleId: scheduleA });

    const removed = await owner.call('DELETE', `/shifts/${shift.id}`, { org });
    expect(removed.status).toBe(204);

    const gone = await owner.call('GET', `/shifts/${shift.id}`, { org });
    expect(gone.status).toBe(404);

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.orgId, org), eq(schema.auditEvents.entityId, shift.id))),
    );
    expect(events.map((event) => event.action)).toEqual(['shift.created', 'shift.removed']);
  });
});

describe('who may schedule', () => {
  it('refuses an employee who is archived', async () => {
    const { owner, org, locA, scheduleA } = await clinic();
    const employeeId = await addEmployee(owner, org, { locationIds: [locA] });
    await owner.call('PATCH', `/employees/${employeeId}`, { org, body: { status: 'archived' } });

    const res = await owner.call('POST', '/shifts', {
      org,
      body: shiftBody({ scheduleId: scheduleA, employeeId }),
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'employee.archived' });
  });

  it('cannot assign an employee from another organisation', async () => {
    const first = await clinic();
    const other = await clinic();
    const outsider = await addEmployee(other.owner, other.org, { locationIds: [other.locA] });

    const res = await first.owner.call('POST', '/shifts', {
      org: first.org,
      body: shiftBody({ scheduleId: first.scheduleA, employeeId: outsider }),
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'employee.not_found' });
  });

  it('a scoped manager cannot schedule at another location', async () => {
    const { manager, org, scheduleB } = await clinic();
    const res = await manager.call('POST', '/shifts', {
      org,
      body: shiftBody({ scheduleId: scheduleB }),
    });
    expect(res.status).toBe(404);
  });

  it('a plain employee cannot read or write shifts', async () => {
    const { owner, org, scheduleA } = await clinic();
    const staff = await addMember(t.app, owner, org, 'employee');
    const list = await staff.call('GET', `/shifts?scheduleId=${scheduleA}`, { org });
    expect(list.status).toBe(403);
    const write = await staff.call('POST', '/shifts', {
      org,
      body: shiftBody({ scheduleId: scheduleA }),
    });
    expect(write.status).toBe(403);
  });

  it('needs an organisation on the request', async () => {
    const { owner, scheduleA } = await clinic();
    const res = await owner.call('POST', '/shifts', {
      body: shiftBody({ scheduleId: scheduleA }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'org.required' });
  });
});
