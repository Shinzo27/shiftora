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

/** W7 D3: asking for an auto-fill records a run and an event, and answers immediately. */
let t: TestApp;
let owner: TestUser;
let orgId: string;
let scheduleId: string;

beforeAll(async () => {
  t = await startTestApp();
  owner = await signUp(t.app, 'Priya');
  orgId = await createOrg(owner);

  const location = await owner.call('POST', '/locations', {
    org: orgId,
    body: { name: 'Andheri', latitude: 19.11, longitude: 72.84, timezone: 'Asia/Kolkata' },
  });
  const locationId = location.json<{ id: string }>().id;

  await owner.call('POST', `/locations/${locationId}/coverage`, {
    org: orgId,
    body: { weekday: 1, startLocal: '09:00', endLocal: '17:00', headcount: 1 },
  });

  const schedule = await owner.call('POST', '/schedules', {
    org: orgId,
    body: { locationId, weekStart: '2027-03-01' },
  });
  scheduleId = schedule.json<{ id: string }>().id;
});

afterAll(async () => {
  await t?.close();
});

describe('auto-fill', () => {
  it('records the run and answers 202 without solving anything', async () => {
    const res = await owner.call('POST', `/schedules/${scheduleId}/autofill`, { org: orgId });
    expect(res.status).toBe(202);
    const body = res.json<{ runId: string; status: string }>();
    expect(body.status).toBe('queued');

    const runs = await t.queryAs({ userId: owner.id, orgId }, (tx) =>
      tx.select().from(schema.autofillRuns).where(eq(schema.autofillRuns.id, body.runId)),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('queued');

    const events = await t.queryAs({ userId: owner.id, orgId }, (tx) =>
      tx
        .select()
        .from(schema.outbox)
        .where(
          and(
            eq(schema.outbox.orgId, orgId),
            eq(schema.outbox.topic, 'schedule.autofill_requested'),
          ),
        ),
    );
    // The work happens in the worker: the request only wrote the event that will do it.
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { runId: string }).runId).toBe(body.runId);
  });

  it('returns the latest run for the week', async () => {
    const res = await owner.call('GET', `/schedules/${scheduleId}/autofill`, { org: orgId });
    expect(res.status).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('queued');
  });

  it('refuses a second run while one is still queued', async () => {
    // Two clicks on a slow network would otherwise queue two solvers, and the second would report
    // "nothing to do" over a week the first had just filled.
    const res = await owner.call('POST', `/schedules/${scheduleId}/autofill`, { org: orgId });
    expect(res.status).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('autofill.already_running');

    const runs = await t.queryAs({ userId: owner.id, orgId }, (tx) =>
      tx.select().from(schema.autofillRuns).where(eq(schema.autofillRuns.scheduleId, scheduleId)),
    );
    expect(runs).toHaveLength(1);
  });

  it('refuses an employee', async () => {
    const employee = await addMember(t.app, owner, orgId, 'employee');
    const res = await employee.call('POST', `/schedules/${scheduleId}/autofill`, { org: orgId });
    expect(res.status).toBe(403);
  });

  it('records who asked in the audit trail', async () => {
    const rows = await t.queryAs({ userId: owner.id, orgId }, (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.orgId, orgId),
            eq(schema.auditEvents.action, 'schedule.autofill_requested'),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(scheduleId);
  });
});
