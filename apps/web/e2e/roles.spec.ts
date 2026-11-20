import { expect, test, type Page } from '@playwright/test';

import { addMember, openOrg, seedClinic, signIn } from './seed.js';

/**
 * W7½ UI3, role gating: each role's sidebar shows exactly its pages, a page a role may not use
 * answers a typed URL with a clear explanation (never an error state), and staff opening any
 * manager URL land in their own app.
 */

const MANAGER_PAGES = [
  { path: 'schedule', nav: 'Schedule' },
  { path: 'employees', nav: 'Employees' },
  { path: 'team', nav: 'Team' },
  { path: 'locations', nav: 'Locations' },
  { path: 'timesheets', nav: 'Timesheets' },
  { path: 'requests', nav: 'Requests' },
  { path: 'payroll', nav: 'Payroll' },
];
const OWNER_PAGES = [
  { path: 'messages', nav: 'Messages', refusal: 'Owners only' },
  { path: 'audit', nav: 'Audit log', refusal: 'Only owners can see the audit log' },
];

/** The page rendered its own content: a heading, nothing loading, no "Couldn't load this". */
async function expectSettled(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByText("Couldn't load this")).toHaveCount(0);
}

async function sidebarLinks(page: Page): Promise<string[]> {
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await expect(sidebar.getByRole('link').first()).toBeVisible();
  return (await sidebar.getByRole('link').allInnerTexts()).map((text) => text.trim());
}

test.describe('role gating', () => {
  test('an owner sees and can open every page', async ({ page, request }) => {
    const clinic = await seedClinic(request);
    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'schedule');

    expect(await sidebarLinks(page)).toEqual(
      expect.arrayContaining([...MANAGER_PAGES, ...OWNER_PAGES].map((item) => item.nav)),
    );
    for (const item of [...MANAGER_PAGES, ...OWNER_PAGES]) {
      await openOrg(page, clinic.orgId, item.path);
      await expectSettled(page);
      await expect(page.getByText('Owners only')).toHaveCount(0);
    }
  });

  test('a manager does not see owner pages, and a typed URL explains why', async ({
    page,
    request,
  }) => {
    const clinic = await seedClinic(request);
    const manager = await addMember(request, clinic, 'manager');
    await signIn(page, manager.email);
    await openOrg(page, clinic.orgId, 'schedule');

    const links = await sidebarLinks(page);
    expect(links).toEqual(expect.arrayContaining(MANAGER_PAGES.map((item) => item.nav)));
    for (const item of OWNER_PAGES) expect(links).not.toContain(item.nav);

    for (const item of MANAGER_PAGES) {
      await openOrg(page, clinic.orgId, item.path);
      await expectSettled(page);
    }
    for (const item of OWNER_PAGES) {
      await openOrg(page, clinic.orgId, item.path);
      await expect(page.getByText(item.refusal)).toBeVisible();
      await expect(page.getByText("Couldn't load this")).toHaveCount(0);
    }
  });

  test('staff opening a manager URL land in their own app', async ({ page, request }) => {
    const clinic = await seedClinic(request);
    const staff = await addMember(request, clinic, 'employee');
    await signIn(page, staff.email);

    for (const item of [...MANAGER_PAGES, ...OWNER_PAGES]) {
      await page.goto(`/o/${clinic.orgId}/${item.path}`);
      await expect(page).toHaveURL(new RegExp(`/o/${clinic.orgId}/shifts$`));
    }
  });
});
