import { asc, eq, schema } from '@shiftora/db';
import type { AssignableRole } from '@shiftora/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signUp, startTestApp, type TestApp, type TestUser } from '../../../testing/test-app.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

async function createOrg(owner: TestUser, name = 'Sunrise Clinic'): Promise<string> {
  const res = await owner.call('POST', '/orgs', { body: { name } });
  expect(res.status).toBe(201);
  return res.json<{ id: string }>().id;
}

async function invite(by: TestUser, org: string, email: string, role: AssignableRole) {
  return by.call('POST', '/invites', { org, body: { email, role } });
}

/** Signs up a new user and brings them into `org` with `role` through a real invite. */
async function addMember(owner: TestUser, org: string, role: AssignableRole): Promise<TestUser> {
  const user = await signUp(t.app, `New ${role}`);
  const created = await invite(owner, org, user.email, role);
  expect(created.status).toBe(201);
  const accepted = await user.call('POST', '/invites/accept', {
    body: { code: created.json<{ code: string }>().code },
  });
  expect(accepted.status).toBe(200);
  return user;
}

async function ownerCount(org: string, asUser: TestUser): Promise<number> {
  const rows = await t.queryAs({ userId: asUser.id, orgId: org }, (tx) =>
    tx.select().from(schema.memberships).where(eq(schema.memberships.orgId, org)),
  );
  return rows.filter((m) => m.role === 'owner').length;
}

describe('organisations', () => {
  it('creates an org with the caller as owner, and lists it', async () => {
    const asha = await signUp(t.app, 'Asha');
    const created = await asha.call('POST', '/orgs', { body: { name: '  Sunrise Clinic ' } });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Sunrise Clinic', role: 'owner' });
    const orgId = created.json<{ id: string }>().id;

    const mine = await asha.call('GET', '/orgs');
    expect(mine.json<{ id: string }[]>().map((o) => o.id)).toEqual([orgId]);

    const current = await asha.call('GET', '/org', { org: orgId });
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ id: orgId, role: 'owner' });
  });

  it('requires X-Org-Id on organisation routes', async () => {
    const asha = await signUp(t.app);
    await createOrg(asha);

    for (const org of [undefined, 'not-a-uuid']) {
      const res = await asha.call('GET', '/org', org ? { org } : {});
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'org.required' });
    }
  });

  it("refuses an org you aren't in, and doesn't reveal whether it exists", async () => {
    const asha = await signUp(t.app);
    const ravi = await signUp(t.app);
    const ashaOrg = await createOrg(asha);

    const foreign = await ravi.call('GET', '/org', { org: ashaOrg });
    const missing = await ravi.call('GET', '/org', {
      org: '0193a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b',
    });

    expect(foreign.status).toBe(403);
    expect(foreign.body).toMatchObject({ code: 'org.not_member' });
    expect(missing.body).toEqual(foreign.body);
  });
});

describe('invites', () => {
  it('invite → sign up → accept makes the invitee a member with the invited role', async () => {
    const owner = await signUp(t.app, 'Owner');
    const org = await createOrg(owner);
    const nurse = await signUp(t.app, 'Nurse');

    const created = await invite(owner, org, nurse.email, 'employee');
    expect(created.status).toBe(201);
    const { code, invite: sent } = created.json<{ code: string; invite: { id: string } }>();
    expect(code.startsWith(`${org}.`)).toBe(true);

    const open = await owner.call('GET', '/invites', { org });
    expect(open.json<{ id: string }[]>().map((i) => i.id)).toEqual([sent.id]);

    const accepted = await nurse.call('POST', '/invites/accept', { body: { code } });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: org, role: 'employee' });

    const nurseOrgs = await nurse.call('GET', '/orgs');
    expect(nurseOrgs.json<{ id: string }[]>().map((o) => o.id)).toEqual([org]);

    const members = await owner.call('GET', '/members', { org });
    expect(members.json<{ userId: string; role: string }[]>()).toEqual([
      expect.objectContaining({ userId: owner.id, role: 'owner' }),
      expect.objectContaining({ userId: nurse.id, role: 'employee' }),
    ]);

    // Used up: the code can't be accepted again, and the invite is no longer open.
    const again = await nurse.call('POST', '/invites/accept', { body: { code } });
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ code: 'invite.invalid' });
    expect((await owner.call('GET', '/invites', { org })).body).toEqual([]);
  });

  it('only the invited email can accept', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const intended = await signUp(t.app);
    const someoneElse = await signUp(t.app);
    const { code } = (await invite(owner, org, intended.email, 'employee')).json<{
      code: string;
    }>();

    const res = await someoneElse.call('POST', '/invites/accept', { body: { code } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'invite.email_mismatch' });

    // The invite survives for the right person.
    expect((await intended.call('POST', '/invites/accept', { body: { code } })).status).toBe(200);
  });

  it('rejects a code whose org part was swapped', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const otherOrg = await createOrg(owner, 'Other Clinic');
    const nurse = await signUp(t.app);
    const { code } = (await invite(owner, org, nurse.email, 'employee')).json<{ code: string }>();

    const tampered = code.replace(org, otherOrg);
    const res = await nurse.call('POST', '/invites/accept', { body: { code: tampered } });
    expect(res.status).toBe(404);
  });

  it('re-inviting the same email cancels the earlier code', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const nurse = await signUp(t.app);
    const first = (await invite(owner, org, nurse.email, 'employee')).json<{ code: string }>();
    const second = (await invite(owner, org, nurse.email, 'manager')).json<{ code: string }>();

    const stale = await nurse.call('POST', '/invites/accept', { body: { code: first.code } });
    expect(stale.status).toBe(404);
    const ok = await nurse.call('POST', '/invites/accept', { body: { code: second.code } });
    expect(ok.body).toMatchObject({ role: 'manager' });
  });

  it('refuses to invite someone who is already a member', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const res = await invite(owner, org, owner.email.toUpperCase(), 'employee');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'invite.already_member' });
  });
});

describe('roles', () => {
  it('employees can see the org but not members or invites', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const employee = await addMember(owner, org, 'employee');

    expect((await employee.call('GET', '/org', { org })).status).toBe(200);
    for (const path of ['/members', '/invites']) {
      const res = await employee.call('GET', path, { org });
      expect(res.status, path).toBe(403);
      expect(res.body).toMatchObject({ code: 'auth.forbidden' });
    }
    const newcomer = await signUp(t.app);
    expect((await invite(employee, org, newcomer.email, 'employee')).status).toBe(403);
  });

  it('managers can invite employees, but not managers, and cannot change roles', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const manager = await addMember(owner, org, 'manager');
    const newcomer = await signUp(t.app);

    expect((await invite(manager, org, newcomer.email, 'employee')).status).toBe(201);
    expect((await invite(manager, org, newcomer.email, 'manager')).status).toBe(403);
    const promote = await manager.call('PATCH', `/members/${manager.id}`, {
      org,
      body: { role: 'owner' },
    });
    expect(promote.status).toBe(403);
  });

  it('removing a member takes effect on their very next request', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const employee = await addMember(owner, org, 'employee');
    expect((await employee.call('GET', '/org', { org })).status).toBe(200);

    expect((await owner.call('DELETE', `/members/${employee.id}`, { org })).status).toBe(204);

    // Same, still-valid access token: the role is read from the database every request.
    const after = await employee.call('GET', '/org', { org });
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({ code: 'org.not_member' });
  });

  it('never lets the last owner be demoted or removed', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);

    const demote = await owner.call('PATCH', `/members/${owner.id}`, {
      org,
      body: { role: 'manager' },
    });
    const leave = await owner.call('DELETE', `/members/${owner.id}`, { org });

    expect(demote.status).toBe(409);
    expect(demote.body).toMatchObject({ code: 'org.last_owner' });
    expect(leave.status).toBe(409);
  });

  it('two owners demoting each other at the same moment still leaves one owner', async () => {
    const first = await signUp(t.app);
    const org = await createOrg(first);
    const second = await addMember(first, org, 'owner');

    const results = await Promise.all([
      first.call('PATCH', `/members/${second.id}`, { org, body: { role: 'employee' } }),
      second.call('PATCH', `/members/${first.id}`, { org, body: { role: 'employee' } }),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]); // the loser was already demoted, or was last owner
    expect(await ownerCount(org, first)).toBe(1);
  });
});

describe('isolation between organisations', () => {
  it("a member of two orgs only sees the selected org's members", async () => {
    const ownerA = await signUp(t.app, 'Owner A');
    const ownerB = await signUp(t.app, 'Owner B');
    const orgA = await createOrg(ownerA, 'Clinic A');
    const orgB = await createOrg(ownerB, 'Clinic B');
    const both = await addMember(ownerA, orgA, 'manager');
    const inviteToB = await invite(ownerB, orgB, both.email, 'employee');
    await both.call('POST', '/invites/accept', {
      body: { code: inviteToB.json<{ code: string }>().code },
    });

    const membersA = (await both.call('GET', '/members', { org: orgA })).json<
      { userId: string; role: string }[]
    >();
    expect(membersA.map((m) => m.userId).sort()).toEqual([ownerA.id, both.id].sort());
    // Their own employee membership in B must not leak into A's list.
    expect(membersA.filter((m) => m.userId === both.id)).toEqual([
      expect.objectContaining({ role: 'manager' }),
    ]);

    // Org B: they're only an employee there, so the members list is forbidden.
    expect((await both.call('GET', '/members', { org: orgB })).status).toBe(403);
  });

  it("cannot revoke another org's invite by id", async () => {
    const ownerA = await signUp(t.app);
    const ownerB = await signUp(t.app);
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);
    const target = await signUp(t.app);
    const inviteB = (await invite(ownerB, orgB, target.email, 'employee')).json<{
      invite: { id: string };
    }>();

    const res = await ownerA.call('DELETE', `/invites/${inviteB.invite.id}`, { org: orgA });
    expect(res.status).toBe(404);
    // Still open in org B.
    const open = await ownerB.call('GET', '/invites', { org: orgB });
    expect(open.json<{ id: string }[]>().map((i) => i.id)).toEqual([inviteB.invite.id]);
  });
});

describe('audit log', () => {
  it('records each change with its actor, in order', async () => {
    const owner = await signUp(t.app);
    const org = await createOrg(owner);
    const member = await addMember(owner, org, 'employee');
    await owner.call('PATCH', `/members/${member.id}`, { org, body: { role: 'manager' } });
    await owner.call('DELETE', `/members/${member.id}`, { org });

    const events = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select({
          action: schema.auditEvents.action,
          actor: schema.auditEvents.actorUserId,
          before: schema.auditEvents.before,
          after: schema.auditEvents.after,
        })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.orgId, org))
        .orderBy(asc(schema.auditEvents.id)),
    );

    expect(events.map((e) => e.action)).toEqual([
      'org.created',
      'invite.created',
      'membership.created',
      'invite.accepted',
      'membership.role_changed',
      'membership.removed',
    ]);
    expect(events[4]).toMatchObject({
      actor: owner.id,
      before: { role: 'employee' },
      after: { role: 'manager' },
    });
    expect(events[2]?.actor).toBe(member.id); // the invitee accepted it themselves
  });
});
