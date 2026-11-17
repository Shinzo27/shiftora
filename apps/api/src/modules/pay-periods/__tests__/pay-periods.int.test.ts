import { and, eq, schema, sql } from '@shiftora/db';
import { toInstant } from '@shiftora/domain';
import type { PayPeriodView } from '@shiftora/shared';
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
 * W6 D4: pay periods. Dates a manager picks, never overlapping; approval refused while punches
 * are open or flagged-and-unreviewed; only an owner approves; approving hands the calculation to
 * the worker (outbox) and locks the period's punches and rules.
 */

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const ZONE = 'Asia/Kolkata';

interface Clinic {
  owner: TestUser;
  org: string;
  locationId: string;
  employeeId: string;
}

async function clinic(): Promise<Clinic> {
  const owner = await signUp(t.app, 'Priya Nair');
  const org = await createOrg(owner);
  const locationId = (
    await owner.call('POST', '/locations', {
      org,
      body: { name: 'Andheri', latitude: 19.1, longitude: 72.8, timezone: ZONE },
    })
  ).json<{ id: string }>().id;
  const employeeId = (
    await owner.call('POST', '/employees', {
      org,
      body: { name: 'Asha Mehta', hourlyRateMinor: 30_000, locationIds: [locationId] },
    })
  ).json<{ id: string }>().id;
  return { owner, org, locationId, employeeId };
}

/** A punch on a local date, straight into the table (clock-in needs a phone and a location). */
async function punch(
  c: Clinic,
  date: string,
  options: { open?: boolean; flagged?: boolean } = {},
): Promise<string> {
  return t.queryAs({ userId: c.owner.id, orgId: c.org }, async (tx) => {
    const [row] = await tx
      .insert(schema.timeEntries)
      .values({
        orgId: c.org,
        employeeId: c.employeeId,
        locationId: c.locationId,
        clockInAt: toInstant(date, '09:00', ZONE),
        clockOutAt: options.open ? null : toInstant(date, '17:00', ZONE),
        inLatitude: 19.1,
        inLongitude: 72.8,
        inAccuracyM: 10,
        inDistanceM: options.flagged ? 900 : 5,
        deviceTime: toInstant(date, '09:00', ZONE),
        flags: options.flagged ? ['outside_geofence'] : [],
      })
      .returning();
    return row!.id;
  });
}

async function period(c: Clinic, startsOn = '2026-11-01', endsOn = '2026-11-30') {
  const res = await c.owner.call('POST', '/pay-periods', {
    org: c.org,
    body: { startsOn, endsOn },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<PayPeriodView>();
}

describe('pay periods', () => {
  it('are dates a manager picks, never overlapping, at most 31 days', async () => {
    const c = await clinic();
    const manager = await addMember(t.app, c.owner, c.org, 'manager');

    const november = await manager.call('POST', '/pay-periods', {
      org: c.org,
      body: { startsOn: '2026-11-01', endsOn: '2026-11-30' },
    });
    expect(november.status).toBe(201);
    expect(november.json<PayPeriodView>()).toMatchObject({
      status: 'open',
      readiness: { openPunches: 0, unreviewedFlags: 0, disputed: 0 },
      totals: null,
    });

    const overlapping = await c.owner.call('POST', '/pay-periods', {
      org: c.org,
      body: { startsOn: '2026-11-30', endsOn: '2026-12-15' },
    });
    expect(overlapping.status).toBe(409);
    expect(overlapping.json()).toMatchObject({ code: 'pay_period.overlap' });

    const tooLong = await c.owner.call('POST', '/pay-periods', {
      org: c.org,
      body: { startsOn: '2026-12-01', endsOn: '2027-01-05' },
    });
    expect(tooLong.status).toBe(400);
  });

  it('cannot be approved while a punch is open or flagged and unreviewed', async () => {
    const c = await clinic();
    const p = await period(c);
    await punch(c, '2026-11-10', { open: true });
    const flagged = await punch(c, '2026-11-11', { flagged: true });

    const res = await c.owner.call('POST', `/pay-periods/${p.id}/approve`, { org: c.org });
    expect(res.status).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'pay_period.not_ready',
      errors: [
        { path: 'openPunches', message: '1 punch(es) still open' },
        { path: 'unreviewedFlags', message: '1 flagged punch(es) not reviewed' },
      ],
    });

    // Disputing the flagged one reviews it (and leaves it out of pay); closing the open one…
    const reviewed = await c.owner.call('POST', `/time-entries/${flagged}/review`, {
      org: c.org,
      body: { decision: 'disputed', note: 'Not at the clinic' },
    });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
      tx.execute(
        sql`update time_entries set clock_out_at = clock_in_at + interval '8 hours' where clock_out_at is null`,
      ),
    );
    const view = await c.owner.call('GET', `/pay-periods/${p.id}`, { org: c.org });
    expect(view.json<PayPeriodView>().readiness).toEqual({
      openPunches: 0,
      unreviewedFlags: 0,
      disputed: 1,
    });

    // …and it can be approved.
    const approved = await c.owner.call('POST', `/pay-periods/${p.id}/approve`, { org: c.org });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  });

  it('approval hands the calculation to the worker, once, with an audit row', async () => {
    const c = await clinic();
    const p = await period(c);
    await punch(c, '2026-11-10');

    const res = await c.owner.call('POST', `/pay-periods/${p.id}/approve`, { org: c.org });
    const again = await c.owner.call('POST', `/pay-periods/${p.id}/approve`, { org: c.org });

    expect(res.json<PayPeriodView>()).toMatchObject({ status: 'calculating', readiness: null });
    expect(again.status).toBe(409);
    const state = await t.queryAs({ userId: c.owner.id, orgId: c.org }, async (tx) => ({
      events: await tx
        .select({ payload: schema.outbox.payload })
        .from(schema.outbox)
        .where(and(eq(schema.outbox.orgId, c.org), eq(schema.outbox.topic, 'pay_period.approved'))),
      audit: await tx
        .select({ action: schema.auditEvents.action })
        .from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.orgId, c.org), eq(schema.auditEvents.entityId, p.id))),
    }));
    expect(state.events.map((e) => e.payload)).toEqual([{ payPeriodId: p.id }]);
    expect(state.audit.map((a) => a.action).sort()).toEqual([
      'pay_period.approved',
      'pay_period.created',
    ]);

    // The lines are the worker's: until it has run, payroll says so.
    const payroll = await c.owner.call('GET', `/pay-periods/${p.id}/payroll`, { org: c.org });
    expect(payroll.status).toBe(409);
    expect(payroll.json()).toMatchObject({ code: 'pay_period.not_calculated' });
  });

  it('only an owner approves and sees payroll; managers set periods up; staff see nothing', async () => {
    const c = await clinic();
    const p = await period(c);
    const manager = await addMember(t.app, c.owner, c.org, 'manager');
    const employee = await addMember(t.app, c.owner, c.org, 'employee');

    expect((await manager.call('GET', `/pay-periods/${p.id}`, { org: c.org })).status).toBe(200);
    const approve = await manager.call('POST', `/pay-periods/${p.id}/approve`, { org: c.org });
    expect(approve.status).toBe(403);
    const payroll = await manager.call('GET', `/pay-periods/${p.id}/payroll`, { org: c.org });
    expect(payroll.status).toBe(403);
    expect((await employee.call('GET', '/pay-periods', { org: c.org })).status).toBe(403);
  });
});

describe('an approved period is locked', () => {
  it('its punches cannot be corrected, and pay rules cannot start inside it', async () => {
    const c = await clinic();
    const p = await period(c);
    const entry = await punch(c, '2026-11-10');
    await c.owner.call('POST', `/pay-periods/${p.id}/approve`, { org: c.org });

    const corrected = await c.owner.call('PATCH', `/time-entries/${entry}`, {
      org: c.org,
      body: { clockOutTime: '18:00', reason: 'Forgot to clock out' },
    });
    expect(corrected.status).toBe(409);
    expect(corrected.json()).toMatchObject({ code: 'time_entry.period_locked' });

    const backdated = await c.owner.call('POST', '/pay-rules', {
      org: c.org,
      body: { effectiveFrom: '2026-11-15', rules: {} },
    });
    expect(backdated.status).toBe(409);
    expect(backdated.json()).toMatchObject({ code: 'pay_rules.period_approved' });

    const after = await c.owner.call('POST', '/pay-rules', {
      org: c.org,
      body: { effectiveFrom: '2026-12-01', rules: {} },
    });
    expect(after.status).toBe(201);
  });

  it('an open period can be deleted; an approved one stays', async () => {
    const c = await clinic();
    const open = await period(c, '2026-12-01', '2026-12-31');
    const approved = await period(c);
    await c.owner.call('POST', `/pay-periods/${approved.id}/approve`, { org: c.org });

    const deleteOpen = await c.owner.call('DELETE', `/pay-periods/${open.id}`, { org: c.org });
    expect(deleteOpen.status).toBe(204);
    const deleteApproved = await c.owner.call('DELETE', `/pay-periods/${approved.id}`, {
      org: c.org,
    });
    expect(deleteApproved.status).toBe(409);
  });
});

describe('isolation', () => {
  it("another org's period does not exist here, and its dates do not overlap mine", async () => {
    const a = await clinic();
    const b = await clinic();
    const p = await period(a);

    expect((await b.owner.call('GET', `/pay-periods/${p.id}`, { org: b.org })).status).toBe(404);
    const approve = await b.owner.call('POST', `/pay-periods/${p.id}/approve`, { org: b.org });
    expect(approve.status).toBe(404);
    await period(b); // the same November, in another organisation: fine
  });
});
