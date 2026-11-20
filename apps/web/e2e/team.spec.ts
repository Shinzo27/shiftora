import { expect, test, type Page } from '@playwright/test';

import { API, PASSWORD, openOrg, seedClinic, signIn, token } from './seed.js';

/**
 * W7½ UI1, the whole road in two browsers: an owner invites a manager, the manager accepts with
 * an account they just made, is limited to one branch and sees only it, and losing the membership
 * takes effect on their very next request.
 *
 * The invitation link is read out of the dialog the owner gets after sending — the same link the
 * email carries — so nothing here reaches into the database to find a code.
 */

async function inviteFromTeamPage(page: Page, email: string): Promise<string> {
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Role').click();
  await page.getByRole('option', { name: 'Manager' }).click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();

  const linkDialog = page.getByRole('dialog', { name: /Invitation on its way/i });
  await expect(linkDialog).toBeVisible();
  const link = await linkDialog.getByLabel('Link').inputValue();
  await linkDialog.getByRole('button', { name: 'Done' }).click();
  return link;
}

test.describe('team and access', () => {
  test('an owner invites a manager, who accepts and is limited to one branch', async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    const clinic = await seedClinic(request);
    const headers = {
      authorization: `Bearer ${await token(request, clinic.email, clinic.password)}`,
      'x-org-id': clinic.orgId,
    };
    // A second branch, so "limited to one" means something.
    const second = await request.post(`${API}/locations`, {
      headers,
      data: { name: 'Andheri', latitude: 19.1197, longitude: 72.8468, timezone: 'Asia/Kolkata' },
    });
    expect(second.ok(), await second.text()).toBeTruthy();
    const secondId = ((await second.json()) as { id: string }).id;

    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const managerEmail = `manager-${stamp}@example.com`;

    await signIn(page, clinic.email);
    await openOrg(page, clinic.orgId, 'team');

    const link = await inviteFromTeamPage(page, managerEmail);

    // The pending invitation is listed, with the role that was chosen. `exact` because the row's
    // action button names the same address in its aria-label.
    const pendingCell = page.getByRole('cell', { name: managerEmail, exact: true });
    await expect(pendingCell).toBeVisible();

    // The manager's own browser: the link arrives before they have an account.
    const managerContext = await browser.newContext({ baseURL });
    const manager = await managerContext.newPage();
    await manager.goto(link);
    await expect(manager.getByRole('heading', { name: /invited to a team/i })).toBeVisible();
    await manager.getByRole('link', { name: 'Create an account' }).click();
    // The code rides along in `?next=`, so signing up comes back here instead of dumping the new
    // account on a list of organisations.
    await expect(manager).toHaveURL(/\/signup\?next=/);

    await manager.getByLabel('Your name').fill('Nisha Rao');
    await manager.getByLabel('Email').fill(managerEmail);
    await manager.getByLabel('Password').fill(PASSWORD);
    await manager.getByRole('button', { name: 'Create account', exact: true }).click();

    // Signing up returns to the invitation.
    await expect(manager).toHaveURL(/\/invite\//, { timeout: 20_000 });
    await manager.getByRole('button', { name: 'Join the team' }).click();
    await expect(manager).toHaveURL(new RegExp(`/o/${clinic.orgId}`), { timeout: 20_000 });

    // A manager lands on their own screens, not the staff shell.
    await expect(manager.getByRole('link', { name: 'Team' })).toBeVisible();

    // The owner limits them to Andheri.
    await page.reload();
    await page.getByRole('button', { name: 'Actions for Nisha Rao' }).click();
    await page.getByRole('menuitem', { name: 'Branches…' }).click();
    const branches = page.getByRole('dialog', { name: /Branches for Nisha Rao/i });
    await branches.getByRole('checkbox', { name: 'Main' }).uncheck();
    await branches.getByRole('checkbox', { name: 'Andheri' }).check();
    await branches.getByRole('button', { name: 'Save branches' }).click();
    await expect(page.getByRole('cell', { name: 'Andheri', exact: true })).toBeVisible();

    // The restriction is real: their location switcher offers only that branch, and the API
    // refuses the one they cannot see.
    await manager.reload();
    // Radix renders the trigger as a combobox, not a button.
    await manager.getByRole('combobox', { name: 'Location' }).click();
    const options = manager.getByRole('option');
    await expect(options).toHaveCount(2); // "All locations" + the one branch
    await expect(manager.getByRole('option', { name: 'Andheri' })).toBeVisible();
    await expect(manager.getByRole('option', { name: 'Main' })).toHaveCount(0);

    const managerToken = await token(request, managerEmail, PASSWORD);
    const forbidden = await request.get(`${API}/employees?locationId=${clinic.locationId}`, {
      headers: { authorization: `Bearer ${managerToken}`, 'x-org-id': clinic.orgId },
    });
    // 404, not 403: a branch outside their scope is answered as one that does not exist, so the
    // response never confirms which branches the organisation has.
    expect(forbidden.status(), await forbidden.text()).toBe(404);

    // Removing the manager takes effect on their next request. The row has to be gone from the
    // members table before the API is asked — otherwise the assertion races the mutation.
    // The whole row, filtered by the email: the actions button names the person too, so a cell
    // match would resolve to two elements.
    const memberRow = page.getByRole('row').filter({ hasText: managerEmail });
    await expect(memberRow).toBeVisible();
    await page.getByRole('button', { name: 'Actions for Nisha Rao' }).click();
    await page.getByRole('menuitem', { name: 'Remove from team' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(memberRow).toHaveCount(0);

    // Polled rather than asserted once: the row leaves the table when the mutation settles, and
    // "settles" is a moment the browser and the server can disagree about under load. The
    // requirement is that the next request is refused, so that is what is waited for.
    await expect
      .poll(
        async () =>
          (
            await request.get(`${API}/members`, {
              headers: { authorization: `Bearer ${managerToken}`, 'x-org-id': clinic.orgId },
            })
          ).status(),
        { timeout: 10_000 },
      )
      .toBe(403);

    // And the browser shows it rather than a half-broken shell.
    await manager.goto(`/o/${clinic.orgId}/schedule`);
    await expect(manager).toHaveURL(/\/orgs/, { timeout: 20_000 });

    await managerContext.close();
    expect(secondId).toBeTruthy();
  });
});
