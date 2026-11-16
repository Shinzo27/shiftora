import { addDays } from '@shiftora/domain';
import { expect, test, type APIRequestContext } from '@playwright/test';

import { API, seedClinic, signIn, token } from './seed.js';

/**
 * W4 D6, the whole road in a browser: a manager publishes the week, and staff hear about it —
 * Meera by email (it lands in Mailpit), Asha on WhatsApp (the fake provider sends it and reports
 * it delivered and read through the signed webhook). The owner then sees both on the Messages
 * page.
 *
 * Needs the worker running with the fake WhatsApp provider and `WHATSAPP_APP_SECRET` set (the
 * local `.env` and CI both do), and Mailpit on :8025.
 */
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSearch {
  messages: { Subject: string }[];
}

async function inboxOf(request: APIRequestContext, address: string): Promise<string[]> {
  const res = await request.get(`${MAILPIT}/api/v1/search`, {
    params: { query: `to:"${address}"` },
  });
  if (!res.ok()) return [];
  return ((await res.json()) as MailpitSearch).messages.map((m) => m.Subject);
}

test.describe('publishing tells staff', () => {
  test('publish in the browser → Meera is emailed, Asha’s WhatsApp is read', async ({
    page,
    request,
  }) => {
    const clinic = await seedClinic(request);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const meeraEmail = `meera-${stamp}@example.com`;
    const headers = {
      authorization: `Bearer ${await token(request, clinic.email, clinic.password)}`,
      'x-org-id': clinic.orgId,
    };

    // The seeded Asha prefers WhatsApp now; Meera, by email.
    const asha = await request.patch(`${API}/employees/${clinic.employeeId}`, {
      headers,
      data: { phone: '+919820000001', notifyChannel: 'whatsapp' },
    });
    expect(asha.ok(), await asha.text()).toBeTruthy();
    const meera = await request.post(`${API}/employees`, {
      headers,
      data: {
        name: 'Meera Iyer',
        email: meeraEmail,
        notifyChannel: 'email',
        hourlyRateMinor: 25_000,
        locationIds: [clinic.locationId],
      },
    });
    expect(meera.ok(), await meera.text()).toBeTruthy();
    const meeraId = ((await meera.json()) as { id: string }).id;

    // One shift each, on the Sunday of the week the board opens on.
    const schedule = (await (
      await request.get(`${API}/schedules/${clinic.scheduleId}`, { headers })
    ).json()) as { weekStart: string };
    const sunday = addDays(schedule.weekStart, 6);
    for (const employeeId of [clinic.employeeId, meeraId]) {
      const shift = await request.post(`${API}/shifts`, {
        headers,
        data: {
          scheduleId: clinic.scheduleId,
          employeeId,
          date: sunday,
          startTime: '10:00',
          endTime: '17:00',
        },
      });
      expect(shift.ok(), await shift.text()).toBeTruthy();
    }

    // The manager publishes in the browser.
    await signIn(page, clinic.email, clinic.password);
    await page.goto(`/o/${clinic.orgId}/schedule`);
    await page.getByRole('button', { name: /^publish$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/2 people will be told/)).toBeVisible();
    await dialog.getByRole('button', { name: /publish week/i }).click();
    await expect(dialog).toBeHidden();

    // Meera's email arrives (relay → fan-out → SMTP → Mailpit).
    await expect
      .poll(() => inboxOf(request, meeraEmail), { timeout: 30_000, intervals: [500] })
      .toEqual([expect.stringMatching(/^Your shifts at Main/)]);

    // The owner sees both on the Messages page; Asha's WhatsApp goes Sent → Delivered → Read as
    // the fake provider's signed reports come back through the webhook.
    await page.goto(`/o/${clinic.orgId}/messages`);
    const recent = page.getByRole('region', { name: 'Recent messages' });
    const ashaRow = recent.getByRole('row').filter({ hasText: 'Asha Mehta' });
    await expect(ashaRow).toContainText('WhatsApp');
    await expect(ashaRow).toContainText('…001');
    await expect(ashaRow).toContainText('Read', { timeout: 30_000 });
    await expect(recent.getByRole('row').filter({ hasText: 'Meera Iyer' })).toContainText('Sent');
  });
});
