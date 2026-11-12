import { expect, test } from '@playwright/test';

import { seedClinic, signIn } from './seed.js';

test.describe('a week of shifts', () => {
  test('a manager adds a shift, publishes it, and sees it live', async ({ page, request }) => {
    const clinic = await seedClinic(request);
    await signIn(page, clinic.email, clinic.password);

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
