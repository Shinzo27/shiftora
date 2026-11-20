# UI coverage

Every API route should have a screen, or a written reason why it is API-only. This file is both
the allowlist for the CI check (W7½ UI3) and the record of when each page was last swept in a
browser.

Standard for UI work: the [`ui-ux-pro-max`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
guidance (MIT), consulted before building a screen and when reviewing one. The shadcn tokens stay
the design system; a recommendation that changes the look is shown to the owner first.

- **Skill version consulted:** 2.15.0 (`ed766d3` on 2026-11-18, `f2cc365` on 2026-11-20)
- **Sweep definition:** happy path, validation and error states, empty and loading states, light and
  dark, 390 px, keyboard only, no console errors, Lighthouse accessibility ≥ 95.

## What polices this automatically (W7½ UI3)

| Check | Where | Fails when |
|---|---|---|
| Route coverage | `pnpm check:ui-coverage` (`scripts/check-ui-coverage.mjs`, CI) | an API route has no caller in `apps/web/src/lib/api.ts` and no row in "API-only routes and why" below |
| Accessibility | `apps/web/e2e/accessibility.spec.ts` (`@axe-core/playwright`, CI) | any WCAG 2.1 A/AA violation on a signed-out, owner or staff page, in light or dark |
| Phone width | same spec, 390 px | any owner or staff page is wider than the screen (wide content must scroll in its own box) |
| Role gating | `apps/web/e2e/roles.spec.ts` (CI) | a role sees a page it may not use in the sidebar, a typed URL shows an error state instead of an explanation, or staff can open the manager shell |

A new page is added to the lists in both specs; a new route gets a screen or a reason here.

## Pages

Last swept 2026-11-20: every page by the automated checks above (axe light + dark, 390 px, role
gating), plus a visual pass at 390 px. Fixed in that sweep: the user menu and ⌘K button names
(axe *label-content-name-mismatch*), the login illustration's contrast, no `h1` on the account
pages, Timesheets names cut to "Roh…" on phones (and its title said "Attendance"), staff able to
open the manager shell by URL, pay-period dates announced invalid before typing, and five
destructive actions without a confirmation (delete shift, delete pay period, withdraw pay rules,
remove coverage, revoke invitation).

| Route | Screen | API calls it covers | Last swept |
|---|---|---|---|
| `/login`, `/signup` | Sign in, create an account | `POST /auth/login`, `/auth/signup` | 2026-11-20 |
| `/forgot-password`, `/reset-password`, `/verify-email` | Account emails' landing pages | `/auth/password/*`, `/auth/verify-email` | 2026-11-20 |
| `/invite/:code` | Accept an invitation (works signed out) | `POST /invites/accept` | 2026-11-20 |
| `/orgs` | Your organisations, create one | `GET`/`POST /orgs` | 2026-11-20 |
| `/o/:orgId/schedule` | Week board: shifts, drag and drop, conflicts, publish, projected cost, fill from coverage; shift sheet with **templates** and **Offer to staff** | `/schedules*`, `/shifts*`, `/shift-templates`, `/shifts/:id/candidates`, `/shifts/:id/offer`, `/autofill*` | 2026-11-20 |
| `/o/:orgId/employees` | Employees; row menu → edit, **availability & time off** | `/employees*`, `/time-off/:id` | 2026-11-20 |
| `/o/:orgId/team` | Team (owners edit, managers read-only) | `/members*`, `/invites*` | 2026-11-20 |
| `/o/:orgId/locations` | Branches; menu → coverage, **departments**, **shift templates**; **job roles** | `/locations*`, `/departments/:id`, `/shift-templates*`, `/job-roles*`, `/coverage*` | 2026-11-20 |
| `/o/:orgId/timesheets` | Timesheets: punches per day, corrections, flags, totals, CSV | `/attendance*`, `/time-entries*` | 2026-11-20 |
| `/o/:orgId/requests` | Swap and drop requests to decide | `/shift-requests*` | 2026-11-20 |
| `/o/:orgId/messages` | Messages (owners): usage, dead letters, replay, recent | `/messages/*` | 2026-11-20 |
| `/o/:orgId/payroll` | Payroll: pay rules (owners), periods, approval, **pay per person**, files | `/pay-rules*`, `/pay-periods*` | 2026-11-20 |
| `/o/:orgId/audit` | Audit log (owners) | `GET /audit-events` | 2026-11-20 |
| `/o/:orgId/shifts`, `/time-off`, `/profile` | Staff app: my shifts, clock in, open shifts, requests, time off, profile and push | `/me/*`, `/clock-in`, `/clock-out` | 2026-11-20 |

## API-only routes and why

| Route | Why there is no screen |
|---|---|
| `POST /auth/refresh` | Called by the API client, never by a person. |
| `POST /auth/verify-email`, `/auth/password/*` | Reached only from a link in an email; the pages are `/verify-email`, `/reset-password`, `/forgot-password`. |
| `POST /me/push-subscriptions`, `DELETE /me/push-subscriptions` | The browser's PushManager calls them behind the toggle on `/profile`. |
| `/webhooks/*` | Providers call them, not people. |
| `/health/*` | Probes. |
| `GET /pay-rules/in-force` | The Payroll page lists every version with its dates; "the rules on one date" is for integrations and support. |
| `GET /schedules/:id` | The week board loads weeks through `GET /schedules?locationId&weekStart`; one-by-id is for integrations. |
| `GET /shift-requests/:id` | The Requests inbox and "My requests" already carry each request in full; one-by-id is for integrations. |
