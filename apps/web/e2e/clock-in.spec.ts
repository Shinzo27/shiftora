import { expect, test } from '@playwright/test';

import { LOCATION, seedClinic, signIn } from './seed.js';

/**
 * The clock-in path in a real browser with real geolocation.
 *
 * Playwright can grant the permission and place the device itself, which is exactly what makes
 * this test worth having: it exercises the browser API, the position → request → server fence
 * chain and the state the card lands in, none of which the API integration tests can reach.
 */
test.describe('clocking in from a phone', () => {
  test('an employee clocks in at their branch and sees the punch', async ({
    page,
    context,
    request,
  }) => {
    const clinic = await seedClinic(request, { withStaff: true });
    const staff = clinic.staff!;

    // The permission prompt is granted up front and the phone is at the branch.
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:5173' });
    await context.setGeolocation({
      latitude: LOCATION.latitude,
      longitude: LOCATION.longitude,
      accuracy: 8,
    });

    await signIn(page, staff.email);
    await page.goto(`/o/${clinic.orgId}/shifts`);

    const card = page.getByRole('region', { name: 'Clock in' });

    await expect(card.getByRole('button', { name: 'Clock in' })).toBeVisible();
    await page.getByRole('button', { name: 'Clock in', exact: true }).click();

    // The card flips to the running punch, and the location is the branch's name.
    await expect(page.getByRole('region', { name: 'On the clock' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(LOCATION.name)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /clock out/i })).toBeVisible();
  });

  test('a punch far from the branch is recorded and flagged, not hidden', async ({
    page,
    context,
    request,
  }) => {
    const clinic = await seedClinic(request, { withStaff: true });
    const staff = clinic.staff!;

    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:5173' });
    // ~2.2 km away: outside the 120 m radius, and the org's policy is to flag rather than refuse.
    await context.setGeolocation({ latitude: 19.1197, longitude: 72.869, accuracy: 12 });

    await signIn(page, staff.email);
    await page.goto(`/o/${clinic.orgId}/shifts`);
    await page.getByRole('button', { name: 'Clock in', exact: true }).click();

    await expect(page.getByRole('region', { name: 'On the clock' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/outside the branch radius/i)).toBeVisible();
  });

  test('without location permission the card explains what to do', async ({ page, request }) => {
    const clinic = await seedClinic(request, { withStaff: true });
    const staff = clinic.staff!;

    // No permission granted: the browser answers with a refusal for this origin.
    await signIn(page, staff.email);
    await page.goto(`/o/${clinic.orgId}/shifts`);
    await page.getByRole('button', { name: 'Clock in', exact: true }).click();

    await expect(page.getByText(/allow location/i)).toBeVisible({ timeout: 15_000 });
  });
});
