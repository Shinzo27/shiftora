import { eq, schema, sql } from '@shiftora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signUp, startTestApp, type TestApp } from '../../../testing/test-app.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

/**
 * Platform rows (null org) are invisible to a tenant context by design, so a test reads them the
 * way the relay does — with the relay flag on, for one statement.
 */
async function asRelay<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<TestApp['queryAs']>[1]>[0]) => Promise<T>,
): Promise<T> {
  return t.queryAs({ userId, orgId: '' }, async (tx) => {
    await tx.execute(sql`select set_config('app.outbox_relay', 'on', true)`);
    return fn(tx);
  });
}

/** The newest token of a topic, as the email would have carried it. */
async function mailedToken(userId: string, topic: string): Promise<string | null> {
  const events = await asRelay(userId, (tx) =>
    tx.select().from(schema.outbox).where(eq(schema.outbox.topic, topic)),
  );
  const payload = events.at(-1)?.payload as { token?: string } | undefined;
  return payload?.token ?? null;
}

const post = (url: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: `/api/v1${url}`, payload });

describe('confirming an address', () => {
  it('signs up with a verification link waiting outside any tenant', async () => {
    const user = await signUp(t.app, 'Asha');

    const events = await asRelay(user.id, (tx) =>
      tx.select().from(schema.outbox).where(eq(schema.outbox.topic, 'auth.verify_email')),
    );
    const event = events.at(-1);
    expect(event).toBeDefined();
    // Platform mail belongs to a person, not a tenant: no org on the row.
    expect(event?.orgId).toBeNull();
    expect((event?.payload as { email: string }).email).toBe(user.email);

    const tokens = await asRelay(user.id, (tx) =>
      tx.select().from(schema.oneTimeTokens).where(eq(schema.oneTimeTokens.userId, user.id)),
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe('verify_email');
    // Only the hash is stored; the raw token exists in the email.
    expect(tokens[0]?.tokenHash).not.toBe((event?.payload as { token: string }).token);
  });

  it('marks the address confirmed once, and refuses the link afterwards', async () => {
    const user = await signUp(t.app, 'Asha');
    const token = await mailedToken(user.id, 'auth.verify_email');
    expect(token).toBeTruthy();

    expect((await post('/auth/verify-email', { token })).statusCode).toBe(204);

    const again = await post('/auth/verify-email', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ code: 'auth.invalid_token' });

    const rows = await asRelay(user.id, (tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, user.id)),
    );
    expect(rows[0]?.emailVerifiedAt).not.toBeNull();
  });

  it('rejects a token nobody issued', async () => {
    const res = await post('/auth/verify-email', { token: 'not-a-real-token-but-long-enough' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'auth.invalid_token' });
  });
});

describe('resetting a password', () => {
  it('answers identically whether or not the address exists', async () => {
    const user = await signUp(t.app, 'Asha');

    const known = await post('/auth/password/forgot', { email: user.email });
    const unknown = await post('/auth/password/forgot', { email: 'nobody@example.test' });

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    // Nothing to tell the two apart: no body, same status.
    expect(known.body).toBe(unknown.body);
  });

  it('mints a link only for an address that has an account', async () => {
    const before = await asRelay('00000000-0000-7000-8000-000000000000', (tx) =>
      tx.select({ id: schema.oneTimeTokens.id }).from(schema.oneTimeTokens),
    );

    await post('/auth/password/forgot', { email: 'ghost@example.test' });

    const after = await asRelay('00000000-0000-7000-8000-000000000000', (tx) =>
      tx.select({ id: schema.oneTimeTokens.id }).from(schema.oneTimeTokens),
    );
    expect(after.length).toBe(before.length);
  });

  it('changes the password, ends the old sessions, and burns the link', async () => {
    const user = await signUp(t.app, 'Asha');
    await post('/auth/password/forgot', { email: user.email });
    const token = await mailedToken(user.id, 'auth.reset_password');
    expect(token).toBeTruthy();

    expect(
      (await post('/auth/password/reset', { token, password: 'a-brand-new-password' })).statusCode,
    ).toBe(204);

    // The old password is gone; the new one works.
    const oldLogin = await post('/auth/login', { email: user.email, password: 'correct horse' });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await post('/auth/login', {
      email: user.email,
      password: 'a-brand-new-password',
    });
    expect(newLogin.statusCode).toBe(200);

    // Every session that existed before the reset is revoked, not just the one from signup.
    const sessions = await asRelay(user.id, (tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id)),
    );
    const before = sessions.filter((session) => session.revokedAt === null);
    expect(before).toHaveLength(1); // the login just made

    // The link cannot be used twice.
    expect(
      (await post('/auth/password/reset', { token, password: 'x-another-password' })).statusCode,
    ).toBe(400);
  });
});
