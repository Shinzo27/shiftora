import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Seeds a clinic through the public API — the same calls a real signup makes, no database
 * shortcuts — and returns what the browser needs to sign in.
 */
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';

interface Clinic {
  email: string;
  password: string;
  orgId: string;
  locationId: string;
  scheduleId: string;
  employeeId: string;
}

async function seedClinic(request: APIRequestContext): Promise<Clinic> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${stamp}@example.com`;
  const password = 'correct-horse-battery';

  const signup = await request.post(`${API}/auth/signup`, {
    data: { email, password, name: 'E2E Owner' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const { accessToken } = (await signup.json()) as { accessToken: string };
  const auth = { authorization: `Bearer ${accessToken}` };

  const org = await request.post(`${API}/orgs`, { headers: auth, data: { name: `E2E ${stamp}` } });
  expect(org.ok(), await org.text()).toBeTruthy();
  const { id: orgId } = (await org.json()) as { id: string };
  const headers = { ...auth, 'x-org-id': orgId };

  const location = await request.post(`${API}/locations`, {
    headers,
    data: { name: 'Main', latitude: 19.1197, longitude: 72.8468, timezone: 'Asia/Kolkata' },
  });
  expect(location.ok(), await location.text()).toBeTruthy();
  const { id: locationId } = (await location.json()) as { id: string };

  const employee = await request.post(`${API}/employees`, {
    headers,
    data: { name: 'Asha Mehta', hourlyRateMinor: 25_000, locationIds: [locationId] },
  });
  expect(employee.ok(), await employee.text()).toBeTruthy();
  const { id: employeeId } = (await employee.json()) as { id: string };

  const schedule = await request.post(`${API}/schedules`, {
    headers,
    data: { locationId, weekStart: '2026-11-09' },
  });
  expect(schedule.ok(), await schedule.text()).toBeTruthy();
  const { id: scheduleId } = (await schedule.json()) as { id: string };

  return { email, password, orgId, locationId, scheduleId, employeeId };
}

async function signIn(page: Page, clinic: Clinic): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(clinic.email);
  await page.getByLabel('Password').fill(clinic.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  // The app picks the organisation and leaves the auth screen; the exact landing page is not
  // the point of these tests, so just wait for the session to exist.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe('a week of shifts', () => {
  test('a manager adds a shift, publishes it, and sees it live', async ({ page, request }) => {
    const clinic = await seedClinic(request);
    await signIn(page, clinic);

    await page.goto(`/o/${clinic.orgId}/schedule`);
    // The seeded week is a draft with one employee on the board.
    await expect(page.getByRole('rowheader', { name: /Asha Mehta/ })).toBeVisible();

    await page.getByRole('button', { name: /add shift/i }).click();
    const sheet = page.getByRole('dialog');
    // Employee is a shadcn combobox (Radix select), not a native <select>.
    await sheet.getByRole('combobox', { name: 'Employee' }).click();
    await page.getByRole('option', { name: 'Asha Mehta' }).click();
    await sheet.getByLabel('Starts').fill('10:00');
    await sheet.getByLabel('Ends').fill('17:00');
    await sheet.getByRole('button', { name: 'Add shift' }).click();

    // The chip is on the board, assigned to Asha, and the week has not been sent yet.
    await expect(page.getByRole('button', { name: /edit shift/i })).toBeVisible();
    await expect(page.getByText('Not published yet')).toBeVisible();

    await page.getByRole('button', { name: /^publish$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/1 new shift/)).toBeVisible();
    await expect(dialog.getByText(/1 person will be told/)).toBeVisible();
    await dialog.getByRole('button', { name: /publish week/i }).click();

    // Published: the badge follows, and the dialog closes.
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Not published yet')).toBeHidden();
  });

  test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
    await page.goto('/o/00000000-0000-7000-8000-000000000000/schedule');
    await expect(page).toHaveURL(/\/login/);
  });
});
