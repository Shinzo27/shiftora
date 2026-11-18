import { schema } from '@shiftora/db';
import type { AuditPage } from '@shiftora/shared';
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
 * W7 D4, "owner filters history by entity": the audit log, newest first, filtered by kind, by one
 * row, by who and by when, paged by cursor — owners only, one organisation's rows only.
 */

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

interface Clinic {
  owner: TestUser;
  org: string;
}

async function clinic(name = 'Priya Nair'): Promise<Clinic> {
  const owner = await signUp(t.app, name);
  return { owner, org: await createOrg(owner) };
}

const log = (c: Clinic, query = '', as: TestUser = c.owner) =>
  as.call('GET', `/audit-events${query ? `?${query}` : ''}`, { org: c.org });

async function jobRole(c: Clinic, name: string): Promise<string> {
  const res = await c.owner.call('POST', '/job-roles', { org: c.org, body: { name } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('the audit log', () => {
  it('lists changes newest first, with who made them and what changed', async () => {
    const c = await clinic();
    const nurse = await jobRole(c, 'Nurse');
    await c.owner.call('PATCH', `/job-roles/${nurse}`, { org: c.org, body: { name: 'Staff nurse' } });

    const page = (await log(c, 'entity=job_role')).json<AuditPage>();

    expect(page.items.map((e) => e.action)).toEqual(['job_role.renamed', 'job_role.created']);
    expect(page.items[0]).toMatchObject({
      entity: 'job_role',
      entityId: nurse,
      actor: { userId: c.owner.id, name: 'Priya Nair' },
      before: { name: 'Nurse' },
      after: { name: 'Staff nurse' },
    });
    expect(page.nextCursor).toBeNull();
  });

  it('filters by kind, by one row, and by who', async () => {
    const c = await clinic();
    const nurse = await jobRole(c, 'Nurse');
    await jobRole(c, 'Doctor');
    const manager = await addMember(t.app, c.owner, c.org, 'manager');
    const byManager = await manager.call('POST', '/job-roles', {
      org: c.org,
      body: { name: 'Receptionist' },
    });
    expect(byManager.status).toBe(201);

    const kinds = (await log(c)).json<AuditPage>().items.map((e) => e.entity);
    expect(kinds).toContain('job_role');
    expect(kinds).toContain('organization');

    const roles = (await log(c, 'entity=job_role')).json<AuditPage>();
    expect(roles.items).toHaveLength(3);
    expect(roles.items.every((e) => e.entity === 'job_role')).toBe(true);

    const one = (await log(c, `entity=job_role&entityId=${nurse}`)).json<AuditPage>();
    expect(one.items.map((e) => [e.action, e.entityId])).toEqual([['job_role.created', nurse]]);

    // Joining (accepting the invite) is theirs too; Nurse and Doctor were the owner's.
    const theirs = (await log(c, `actorUserId=${manager.id}`)).json<AuditPage>();
    expect(theirs.items.every((e) => e.actor?.userId === manager.id)).toBe(true);
    const names = theirs.items.map((e) => e.after?.['name']).filter(Boolean);
    expect(names).toEqual(['Receptionist']);
  });

  it('pages by cursor without skipping or repeating rows, even within one millisecond', async () => {
    const c = await clinic();
    // Ten rows sharing one timestamp, as one transaction writes them (now() is per transaction):
    // only the id tells them apart, and the cursor must keep that order.
    const ids = await t.queryAs({ userId: c.owner.id, orgId: c.org }, async (tx) => {
      const rows = await tx
        .insert(schema.auditEvents)
        .values(
          Array.from({ length: 10 }, (_, i) => ({
            orgId: c.org,
            actorUserId: c.owner.id,
            action: 'job_role.created',
            entity: 'job_role',
            entityId: crypto.randomUUID(),
            after: { name: `Role ${i}` },
          })),
        )
        .returning({ id: schema.auditEvents.id });
      return rows.map((row) => row.id);
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `entity=job_role&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await log(c, query);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const page = res.json<AuditPage>();
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(4); // 3 + 3 + 3 + 1
    expect(seen).toHaveLength(10);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toEqual([...ids].sort().reverse()); // same instant → id order, descending
  });

  it('keeps to the date range', async () => {
    const c = await clinic();
    await t.queryAs({ userId: c.owner.id, orgId: c.org }, (tx) =>
      tx.insert(schema.auditEvents).values(
        ['2026-01-15T10:00:00Z', '2026-02-15T10:00:00Z', '2026-03-15T10:00:00Z'].map((at) => ({
          orgId: c.org,
          actorUserId: null,
          action: 'shift.updated',
          entity: 'shift',
          entityId: crypto.randomUUID(),
          createdAt: new Date(at),
        })),
      ),
    );

    const feb = (
      await log(c, 'entity=shift&from=2026-02-01T00:00:00%2B05:30&to=2026-03-01T00:00:00%2B05:30')
    ).json<AuditPage>();
    expect(feb.items.map((e) => e.at)).toEqual(['2026-02-15T10:00:00.000Z']);
    expect(feb.items[0]!.actor).toBeNull(); // a system change has no person

    const bad = await log(c, 'from=2026-03-01T00:00:00Z&to=2026-02-01T00:00:00Z');
    expect(bad.status).toBe(400);
  });

  it('refuses a cursor it did not make', async () => {
    const c = await clinic();
    for (const cursor of ['nonsense', Buffer.from('["x","y"]').toString('base64url')]) {
      expect((await log(c, `cursor=${cursor}`)).status, cursor).toBe(400);
    }
  });

  it('is for owners only', async () => {
    const c = await clinic();
    const manager = await addMember(t.app, c.owner, c.org, 'manager');
    const employee = await addMember(t.app, c.owner, c.org, 'employee');
    expect((await log(c, '', manager)).status).toBe(403);
    expect((await log(c, '', employee)).status).toBe(403);
  });

  it("never shows another organisation's history, even asked for by id", async () => {
    const a = await clinic();
    const b = await clinic('Ravi Kumar');
    const theirs = await jobRole(a, 'Nurse');

    expect((await log(b, `entityId=${theirs}`)).json<AuditPage>().items).toEqual([]);
    const all = (await log(b)).json<AuditPage>();
    expect(all.items.every((e) => e.actor === null || e.actor.userId === b.owner.id)).toBe(true);
  });
});
