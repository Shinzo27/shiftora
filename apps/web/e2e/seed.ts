import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { startOfWeek, toLocal } from '@shiftora/domain';

/**
 * Seeding for the browser tests: a clinic built through the public API — the same calls a real
 * signup makes, no database shortcuts — so the specs never depend on demo data.
 *
 * `withStaff` also creates a teammate whose login is linked to a staff profile, which is what
 * the phone-side tests need: an employee who can clock in, not just a manager who can plan.
 */
export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';

export const PASSWORD = 'correct-horse-battery';
export const LOCATION = {
  name: 'Main',
  latitude: 19.1197,
  longitude: 72.8468,
  radiusM: 120,
  timezone: 'Asia/Kolkata',
};

export interface Clinic {
  email: string;
  password: string;
  orgId: string;
  locationId: string;
  scheduleId: string;
  employeeId: string;
  /** Present when seeded with `withStaff`: a login linked to a staff profile. */
  staff?: { email: string; password: string; employeeId: string; userId: string };
}

async function token(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export async function seedClinic(
  request: APIRequestContext,
  options: { withStaff?: boolean } = {},
): Promise<Clinic> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${stamp}@example.com`;

  const signup = await request.post(`${API}/auth/signup`, {
    data: { email, password: PASSWORD, name: 'E2E Owner' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const { accessToken } = (await signup.json()) as { accessToken: string };
  const auth = { authorization: `Bearer ${accessToken}` };

  const org = await request.post(`${API}/orgs`, { headers: auth, data: { name: `E2E ${stamp}` } });
  expect(org.ok(), await org.text()).toBeTruthy();
  const { id: orgId } = (await org.json()) as { id: string };
  const headers = { ...auth, 'x-org-id': orgId };

  const location = await request.post(`${API}/locations`, { headers, data: LOCATION });
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
    // The board opens on the current week, so seed that one. A fixed date went stale the
    // Monday after it was written and left the board empty.
    data: { locationId, weekStart: startOfWeek(toLocal(new Date(), LOCATION.timezone).date) },
  });
  expect(schedule.ok(), await schedule.text()).toBeTruthy();
  const { id: scheduleId } = (await schedule.json()) as { id: string };

  const clinic: Clinic = { email, password: PASSWORD, orgId, locationId, scheduleId, employeeId };
  if (!options.withStaff) return clinic;

  // A second person: signs up, is invited as an employee, then gets a staff profile linked to
  // that login — the state a phone user is in.
  const staffEmail = `staff-${stamp}@example.com`;
  const staffSignup = await request.post(`${API}/auth/signup`, {
    data: { email: staffEmail, password: PASSWORD, name: 'Ravi Kumar' },
  });
  expect(staffSignup.ok(), await staffSignup.text()).toBeTruthy();
  const staffAuth = {
    authorization: `Bearer ${((await staffSignup.json()) as { accessToken: string }).accessToken}`,
  };
  const staffId = (await request
    .get(`${API}/auth/me`, { headers: staffAuth })
    .then((res) => res.json())) as {
    id: string;
  };

  const invite = await request.post(`${API}/invites`, {
    headers,
    data: { email: staffEmail, role: 'employee' },
  });
  expect(invite.ok(), await invite.text()).toBeTruthy();
  const { code } = (await invite.json()) as { code: string };
  const accepted = await request.post(`${API}/invites/accept`, {
    headers: staffAuth,
    data: { code },
  });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();

  const staffEmployee = await request.post(`${API}/employees`, {
    headers,
    data: {
      name: 'Ravi Kumar',
      hourlyRateMinor: 22_000,
      userId: staffId.id,
      locationIds: [locationId],
    },
  });
  expect(staffEmployee.ok(), await staffEmployee.text()).toBeTruthy();
  const staffEmployeeId = ((await staffEmployee.json()) as { id: string }).id;

  clinic.staff = {
    email: staffEmail,
    password: PASSWORD,
    employeeId: staffEmployeeId,
    userId: staffId.id,
  };
  return clinic;
}

/**
 * Another login in the clinic with `role` — signup, an invitation, acceptance — the way a real
 * manager joins. Used by the role-gating and accessibility sweeps.
 */
export async function addMember(
  request: APIRequestContext,
  clinic: Clinic,
  role: 'manager' | 'employee',
): Promise<{ email: string; password: string }> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `${role}-${stamp}@example.com`;
  const signup = await request.post(`${API}/auth/signup`, {
    data: { email, password: PASSWORD, name: role === 'manager' ? 'Meera Iyer' : 'Rohan Desai' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const auth = {
    authorization: `Bearer ${((await signup.json()) as { accessToken: string }).accessToken}`,
  };
  const ownerHeaders = {
    authorization: `Bearer ${await token(request, clinic.email, clinic.password)}`,
    'x-org-id': clinic.orgId,
  };
  const invite = await request.post(`${API}/invites`, {
    headers: ownerHeaders,
    data: { email, role },
  });
  expect(invite.ok(), await invite.text()).toBeTruthy();
  const { code } = (await invite.json()) as { code: string };
  const accepted = await request.post(`${API}/invites/accept`, { headers: auth, data: { code } });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  return { email, password: PASSWORD };
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  // The app picks the organisation and leaves the auth screen; the exact landing page is not
  // the point of these tests, so just wait for the session to exist.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Lands inside the organisation, whether the app decided on the staff or the manager shell. */
export async function openOrg(page: Page, orgId: string, path: string): Promise<void> {
  await page.goto(`/o/${orgId}/${path}`);
  await expect(
    page.getByRole('navigation', { name: 'Main' }).or(page.locator('main').first()),
  ).toBeVisible({
    timeout: 20_000,
  });
}

export { token };
