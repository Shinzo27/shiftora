import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { addMember, openOrg, seedClinic, signIn } from './seed.js';

/**
 * W7½ UI3, automated accessibility: axe (WCAG 2.1 A and AA) on every page, as the role that uses
 * it, in light and dark. A regression on any page fails CI here rather than in a manual sweep.
 *
 * Each page is checked once its content has settled — nothing `aria-busy` — so skeletons are not
 * what gets audited.
 */

const OWNER_PAGES = [
  'schedule',
  'employees',
  'team',
  'locations',
  'timesheets',
  'requests',
  'payroll',
  'messages',
  'audit',
];
const STAFF_PAGES = ['shifts', 'time-off', 'profile'];

async function audit(page: Page, label: string) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.help} — ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  );
  expect(summary, label).toEqual([]);
}

/** At phone width the page itself never scrolls sideways; wide content scrolls in its own box. */
async function expectNoSidewaysScroll(page: Page, label: string) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${label} is ${overflow}px wider than the screen`).toBeLessThanOrEqual(0);
}

test.describe('phone width (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no owner or staff page scrolls sideways', async ({ page, request }) => {
    const clinic = await seedClinic(request);
    await signIn(page, clinic.email);
    for (const path of OWNER_PAGES) {
      await openOrg(page, clinic.orgId, path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSidewaysScroll(page, path);
    }
    const staff = await addMember(request, clinic, 'employee');
    await page.context().clearCookies();
    await signIn(page, staff.email);
    for (const path of STAFF_PAGES) {
      await page.goto(`/o/${clinic.orgId}/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSidewaysScroll(page, path);
    }
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('signed-out pages', async ({ page }) => {
      for (const path of ['/login', '/signup', '/forgot-password']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await audit(page, path);
      }
    });

    test('every owner page', async ({ page, request }) => {
      const clinic = await seedClinic(request);
      await signIn(page, clinic.email);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'orgs');
      for (const path of OWNER_PAGES) {
        await openOrg(page, clinic.orgId, path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await audit(page, path);
      }
    });

    test('every staff page', async ({ page, request }) => {
      const clinic = await seedClinic(request);
      const staff = await addMember(request, clinic, 'employee');
      await signIn(page, staff.email);
      for (const path of STAFF_PAGES) {
        await page.goto(`/o/${clinic.orgId}/${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await audit(page, path);
      }
    });
  });
}
