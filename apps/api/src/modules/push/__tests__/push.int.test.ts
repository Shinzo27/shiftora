import { eq, schema } from '@shiftora/db';
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
let owner: TestUser;
let orgId: string;

const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
const subscription = {
  endpoint,
  keys: { p256dh: 'p256dh-key-material-for-the-test', auth: 'auth-secret-value' },
};

const subscribe = (user: TestUser, body: object = subscription) =>
  user.call('POST', '/me/push-subscriptions', { org: orgId, body });

const rowsFor = () =>
  t.queryAs({ userId: owner.id, orgId }, (tx) =>
    tx
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, endpoint)),
  );

beforeAll(async () => {
  t = await startTestApp();
  owner = await signUp(t.app, 'Asha');
  orgId = await createOrg(owner);
  // A staff row linked to the owner's login, so "who is calling" resolves to "which employee".
  const created = await owner.call('POST', '/employees', {
    org: orgId,
    body: { name: 'Asha Mehta', email: owner.email, userId: owner.id, hourlyRateMinor: 45_000 },
  });
  if (created.status !== 201)
    throw new Error(`employee failed: ${created.status} ${JSON.stringify(created.body)}`);
});

afterAll(async () => {
  await t?.close();
});

describe('subscribing a browser to push', () => {
  it('serves the public VAPID key, which is identity rather than secret', async () => {
    // Public on purpose: it is the identity a push service verifies signatures against, and the
    // browser needs it before it can subscribe.
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/push/public-key' });
    expect(res.statusCode).toBe(200);
    // Local development sets a key; without one the staff app hides the button.
    expect(res.json()).toHaveProperty('publicKey');
  });

  it('stores the subscription, once, however often the browser asks', async () => {
    expect((await subscribe(owner)).status).toBe(201);
    expect((await subscribe(owner)).status).toBe(201);

    const rows = await rowsFor();
    expect(rows).toHaveLength(1);
    // The row is attached to the employee, not to the user who happened to be signed in.
    expect(rows[0]?.employeeId).toBeTruthy();
  });

  it('moves a device that changes hands instead of duplicating it', async () => {
    const colleague = await addMember(t.app, owner, orgId, 'employee');
    await owner.call('POST', '/employees', {
      org: orgId,
      body: {
        name: 'Rohan Desai',
        email: colleague.email,
        userId: colleague.id,
        hourlyRateMinor: 40_000,
      },
    });

    expect((await subscribe(colleague)).status).toBe(201);

    const rows = await rowsFor();
    // Still one row — the browser now belongs to whoever signed in on it last.
    expect(rows).toHaveLength(1);
  });

  it('deletes only the caller’s own device, and never says whether an endpoint exists', async () => {
    const stranger = await signUp(t.app, 'Neighbour');
    const res = await stranger.call('DELETE', '/me/push-subscriptions', {
      org: orgId,
      body: subscription,
    });
    // No membership in this org, so no employee row: the answer is the same as a no-op.
    expect([204, 403]).toContain(res.status);
    expect(await rowsFor()).toHaveLength(1);
  });

  it('removes the row when the person who owns it unsubscribes', async () => {
    // Take the device back first: the handover test gave it to someone else.
    expect((await subscribe(owner)).status).toBe(201);
    expect(
      (await owner.call('DELETE', '/me/push-subscriptions', { org: orgId, body: subscription }))
        .status,
    ).toBe(204);
    expect(await rowsFor()).toHaveLength(0);
  });

  it('rejects an endpoint that is not a URL', async () => {
    const res = await subscribe(owner, { endpoint: 'not-a-url', keys: subscription.keys });
    expect(res.status).toBe(400);
  });
});
