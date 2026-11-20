import { addDays, startOfWeek, toLocal } from '@shiftora/domain';
import { expect, test } from '@playwright/test';

import { API, LOCATION, openOrg, seedClinic, signIn, token } from './seed.js';

/**
 * W7½ UI2: the screens that used to exist only in the API — offering an open shift, a person's
 * availability and time off, and job roles — each driven once through the browser.
 */

test.describe('scheduling and pay gaps', () => {
  test('a manager offers an open shift and the eligible staff member sees it in their app', async ({
    page,
    request,
  }) => {
    const clinic = await seedClinic(request, { withStaff: true });
    const staff = clinic.staff!;
    const headers = {
      authorization: `Bearer ${await token(request, clinic.email, clinic.password)}`,
      'x-org-id': clinic.orgId,
    };
    // Next week, so the shift is always in the future, whatever day the suite runs.
    const nextWeek = addDays(startOfWeek(toLocal(new Date(), LOCATION.timezone).date), 7);
    const schedule = await request.post(`${API}/schedules`, {
      headers,
      data: { locationId: clinic.locationId, weekStart: nextWeek },
    });
    expect(schedule.ok(), await schedule.text()).toBeTruthy();
    const { id: scheduleId } = (await schedule.json()) as { id: string };
    const created = await request.post(`${API}/shifts`, {
      headers,
      data: {
        scheduleId,
        employeeId: null,
        date: addDays(nextWeek, 2),
        startTime: '09:00',
        endTime: '15:00',
        breakMinutes: 30,
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { shift } = (await created.json()) as { shift: { id: string } };

    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'schedule');
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.getByRole('button', { name: /edit shift .*open shift/i }).click();

    const panel = page.getByRole('region', { name: 'Offer to staff' });
    await expect(panel.getByText(/could take it/)).toBeVisible();
    await panel.getByRole('button', { name: /^Offer to \d+ (person|people)$/ }).click();
    await expect(page.getByText(/^Offered to \d+ (person|people)$/)).toBeVisible();

    // The staff member's app lists it now.
    const mine = await request.get(`${API}/me/open-shifts`, {
      headers: {
        authorization: `Bearer ${await token(request, staff.email, staff.password)}`,
        'x-org-id': clinic.orgId,
      },
    });
    expect(mine.ok()).toBeTruthy();
    const offered = (await mine.json()) as { id: string }[];
    expect(offered.map((item) => item.id)).toContain(shift.id);
  });

  test("a manager sets someone's weekly availability and adds whole days off", async ({
    page,
    request,
  }) => {
    const clinic = await seedClinic(request);
    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'employees');

    await page.getByRole('button', { name: 'Actions for Asha Mehta' }).click();
    await page.getByRole('menuitem', { name: 'Availability & time off' }).click();
    const sheet = page.getByRole('dialog', { name: /Asha Mehta: availability/ });

    await sheet.getByRole('button', { name: 'Add a time' }).click();
    await sheet.getByRole('button', { name: 'Save availability' }).click();
    await expect(page.getByText('Availability saved')).toBeVisible();
    await expect(sheet.getByRole('combobox', { name: 'Day, time 1' })).toHaveText('Mon');

    await sheet.getByLabel('First day off').fill('2027-01-04');
    await sheet.getByLabel('Last day off').fill('2027-01-06');
    await sheet.getByLabel('Reason (optional)').fill('Family wedding');
    await sheet.getByRole('button', { name: 'Add time off' }).click();
    await expect(sheet.getByText('4 Jan – 6 Jan')).toBeVisible();
    await expect(sheet.getByText('Family wedding')).toBeVisible();

    // Removing asks first.
    await sheet.getByRole('button', { name: 'Remove time off 4 Jan – 6 Jan' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(sheet.getByText('No time off coming up.')).toBeVisible();
  });

  test('a shift template fills a new shift, overnight included', async ({ page, request }) => {
    const clinic = await seedClinic(request);
    const headers = {
      authorization: `Bearer ${await token(request, clinic.email, clinic.password)}`,
      'x-org-id': clinic.orgId,
    };
    const template = await request.post(`${API}/shift-templates`, {
      headers,
      data: {
        locationId: clinic.locationId,
        name: 'Night',
        startTime: '21:00',
        endTime: '07:00',
        breakMinutes: 45,
      },
    });
    expect(template.ok(), await template.text()).toBeTruthy();

    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'schedule');
    await page
      .getByRole('button', { name: /add shift/i })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: 'Add a shift' });
    await sheet.getByRole('combobox', { name: 'Employee' }).click();
    await page.getByRole('option', { name: 'Asha Mehta' }).click();
    await sheet.getByRole('combobox', { name: 'Start from a template' }).click();
    await page.getByRole('option', { name: 'Night · 21:00–07:00' }).click();

    await expect(sheet.getByLabel('Starts')).toHaveValue('21:00');
    await expect(sheet.getByLabel('Ends')).toHaveValue('07:00');
    await expect(sheet.getByLabel('Break (minutes)')).toHaveValue('45');
    await sheet.getByRole('button', { name: 'Add shift' }).click();

    await expect(page.getByRole('button', { name: /edit shift .*21:00 to 07:00/i })).toBeVisible();
  });

  test("a new clinic's owner adds its first pay rules", async ({ page, request }) => {
    // A new organisation has no rules at all — the case the editor once could not open for.
    const clinic = await seedClinic(request);
    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'payroll');

    await page.getByRole('button', { name: 'New version' }).click();
    const dialog = page.getByRole('dialog', { name: 'First pay rules' });
    await dialog.getByLabel('Applies to work from').fill('2027-01-04');
    await dialog.getByRole('checkbox', { name: 'Weekly overtime' }).click();
    await dialog.getByLabel('Weekly overtime after hours').fill('40');
    await expect(dialog).toContainText('overtime after 40 h a week at 1.5×');
    await dialog.getByRole('button', { name: 'Save version' }).click();

    await expect(page.getByText('overtime after 40 h a week at 1.5×')).toBeVisible();
  });

  test('job roles are added, renamed in place and deleted after a warning', async ({
    page,
    request,
  }) => {
    const clinic = await seedClinic(request);
    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'locations');

    const section = page.getByRole('region', { name: 'Job roles' });
    await section.getByLabel('New job role').fill('Lab technician');
    await section.getByRole('button', { name: 'Add' }).click();
    await expect(section.getByText('Lab technician')).toBeVisible();

    await section.getByRole('button', { name: 'Rename Lab technician' }).click();
    await section.getByLabel('New name for Lab technician').fill('Phlebotomist');
    await section.getByRole('button', { name: 'Save name' }).click();
    await expect(section.getByText('Phlebotomist')).toBeVisible();

    await section.getByRole('button', { name: 'Delete Phlebotomist' }).click();
    const confirm = page.getByRole('dialog', { name: /Delete “Phlebotomist”/ });
    await expect(confirm).toContainText('coverage that asked for it is removed');
    await confirm.getByRole('button', { name: 'Delete role' }).click();
    await expect(section.getByText('Phlebotomist')).toHaveCount(0);
  });
});
