import { schema, sql } from '@shiftora/db';
import { addDays, BILLING_TIME_ZONE, toLocal } from '@shiftora/domain';
import type { PayRulesInForceView, PayRulesVersionView } from '@shiftora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  createOrg,
  signUp,
  startTestApp,
  type TestApp,
} from '../../../testing/test-app.js';

/**
 * W6 D1: pay rules round-trip through the API as immutable, dated versions. Owners write them,
 * managers read them; a new version starts after the latest; only a version that has not started
 * can be withdrawn; no versions means plain hourly pay.
 */

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const today = toLocal(new Date(), BILLING_TIME_ZONE).date;
const rules = {
  overtime: [
    { period: 'day', thresholdMinutes: 540, multiplier: 1.5 },
    { period: 'week', thresholdMinutes: 2880, multiplier: 2 },
  ],
  nightPremium: { startLocal: '22:00', endLocal: '06:00', multiplier: 1.25 },
  breaks: [{ afterMinutes: 360, deductMinutes: 30 }],
  rounding: { toMinutes: 5, mode: 'nearest' },
};

async function clinic() {
  const owner = await signUp(t.app, 'Priya Nair');
  const org = await createOrg(owner);
  return { owner, org };
}

describe('pay rules', () => {
  it('a new organisation has none: plain hourly pay', async () => {
    const { owner, org } = await clinic();

    expect((await owner.call('GET', '/pay-rules', { org })).json()).toEqual([]);
    const inForce = await owner.call('GET', `/pay-rules/in-force?date=${today}`, { org });
    expect(inForce.json<PayRulesInForceView>()).toEqual({
      date: today,
      version: null,
      rules: { overtime: [], nightPremium: null, breaks: [], rounding: null },
    });
  });

  it('round-trips a version exactly, with an audit row', async () => {
    const { owner, org } = await clinic();

    const res = await owner.call('POST', '/pay-rules', {
      org,
      body: { effectiveFrom: '2026-11-01', rules, note: 'From the November contract' },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.json<PayRulesVersionView>()).toMatchObject({
      version: 1,
      effectiveFrom: '2026-11-01',
      rules,
      note: 'From the November contract',
      createdBy: { id: owner.id, name: 'Priya Nair' },
    });
    const list = await owner.call('GET', '/pay-rules', { org });
    expect(list.json<PayRulesVersionView[]>().map((v) => v.rules)).toEqual([rules]);

    const audit = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select({ action: schema.auditEvents.action })
        .from(schema.auditEvents)
        .where(sql`org_id = ${org} and entity = 'pay_rules'`),
    );
    expect(audit.map((a) => a.action)).toEqual(['pay_rules.created']);
  });

  it('versions start in order, and each day gets the rules of its time', async () => {
    const { owner, org } = await clinic();
    await owner.call('POST', '/pay-rules', { org, body: { effectiveFrom: '2026-11-01', rules } });
    const second = await owner.call('POST', '/pay-rules', {
      org,
      body: {
        effectiveFrom: '2026-12-01',
        rules: { overtime: [{ period: 'day', thresholdMinutes: 480, multiplier: 2 }] },
      },
    });
    expect(second.json<PayRulesVersionView>().version).toBe(2);

    const earlier = await owner.call('POST', '/pay-rules', {
      org,
      body: { effectiveFrom: '2026-11-15', rules },
    });
    expect(earlier.status).toBe(409);
    expect(earlier.json()).toMatchObject({ code: 'pay_rules.not_after_latest' });

    const at = async (date: string) =>
      (
        await owner.call('GET', `/pay-rules/in-force?date=${date}`, { org })
      ).json<PayRulesInForceView>();
    expect((await at('2026-11-20')).version).toBe(1);
    expect(await at('2026-12-20')).toMatchObject({
      version: 2,
      rules: { overtime: [{ period: 'day', thresholdMinutes: 480, multiplier: 2 }] },
    });
    expect((await at('2026-10-20')).version).toBeNull();
  });

  it('refuses rules that do not make sense (400)', async () => {
    const { owner, org } = await clinic();
    const res = await owner.call('POST', '/pay-rules', {
      org,
      body: {
        effectiveFrom: '2026-11-01',
        rules: { breaks: [{ afterMinutes: 30, deductMinutes: 45 }] },
      },
    });
    expect(res.status).toBe(400);
  });

  it('only the latest version, before it starts, can be withdrawn', async () => {
    const { owner, org } = await clinic();
    const started = (
      await owner.call('POST', '/pay-rules', { org, body: { effectiveFrom: today, rules } })
    ).json<PayRulesVersionView>();
    const future = (
      await owner.call('POST', '/pay-rules', {
        org,
        body: { effectiveFrom: addDays(today, 30), rules },
      })
    ).json<PayRulesVersionView>();

    const inForce = await owner.call('DELETE', `/pay-rules/${started.id}`, { org });
    expect(inForce.status).toBe(409);
    expect(inForce.json()).toMatchObject({ code: 'pay_rules.locked' });

    expect((await owner.call('DELETE', `/pay-rules/${future.id}`, { org })).status).toBe(204);
    const left = await owner.call('GET', '/pay-rules', { org });
    expect(left.json<PayRulesVersionView[]>()).toHaveLength(1);
  });

  it('a saved version cannot be edited, even directly in the database', async () => {
    const { owner, org } = await clinic();
    const created = (
      await owner.call('POST', '/pay-rules', { org, body: { effectiveFrom: '2026-11-01', rules } })
    ).json<PayRulesVersionView>();

    const error = await t
      .queryAs({ userId: owner.id, orgId: org }, (tx) =>
        tx.execute(sql`update pay_rules set note = 'changed' where id = ${created.id}`),
      )
      .then(
        () => null,
        (caught: unknown) => caught as { cause?: { code?: string }; code?: string },
      );
    expect(error?.cause?.code ?? error?.code).toBe('42501'); // insufficient_privilege
  });

  it('managers read, only owners write; employees get 403', async () => {
    const { owner, org } = await clinic();
    const manager = await addMember(t.app, owner, org, 'manager');
    const employee = await addMember(t.app, owner, org, 'employee');

    expect((await manager.call('GET', '/pay-rules', { org })).status).toBe(200);
    const write = await manager.call('POST', '/pay-rules', {
      org,
      body: { effectiveFrom: '2026-11-01', rules },
    });
    expect(write.status).toBe(403);
    expect((await employee.call('GET', '/pay-rules', { org })).status).toBe(403);
  });

  it("another org's versions are invisible and cannot be withdrawn", async () => {
    const a = await clinic();
    const b = await clinic();
    const created = (
      await a.owner.call('POST', '/pay-rules', {
        org: a.org,
        body: { effectiveFrom: addDays(today, 30), rules },
      })
    ).json<PayRulesVersionView>();

    expect((await b.owner.call('GET', '/pay-rules', { org: b.org })).json()).toEqual([]);
    const withdraw = await b.owner.call('DELETE', `/pay-rules/${created.id}`, { org: b.org });
    expect(withdraw.status).toBe(404);
  });
});
