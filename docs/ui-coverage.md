# UI coverage

Every API route should have a screen, or a written reason why it is API-only. This file is both
the allowlist for the CI check (W7½ UI3) and the record of when each page was last swept in a
browser.

Standard for UI work: the [`ui-ux-pro-max`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
guidance (MIT), consulted before building a screen and when reviewing one. The shadcn tokens stay
the design system; a recommendation that changes the look is shown to the owner first.

- **Skill version consulted:** 2.15.0 (`ed766d3`, 2026-11-18)
- **Sweep definition:** happy path, validation and error states, empty and loading states, light and
  dark, 390 px, keyboard only, no console errors, Lighthouse accessibility ≥ 95.

## Pages

| Route | Screen | API calls it covers | Last swept |
|---|---|---|---|
| `/o/:orgId/team` | Team (owners edit, managers read-only) | `GET /members`, `PATCH /members/:id`, `DELETE /members/:id`, `GET`/`PUT /members/:id/locations`, `GET`/`POST /invites`, `DELETE /invites/:id` | 2026-11-18 |
| `/invite/:code` | Accept an invitation (works signed out) | `POST /invites/accept` | 2026-11-18 |
| `/o/:orgId/payroll` | Payroll: pay rules (versions, owners edit), pay periods, approval, files | `GET`/`POST`/`DELETE /pay-rules`, `/pay-periods*` | 2026-11-18 |
| `/o/:orgId/audit` | Audit log (owners) | `GET /audit-events` | 2026-11-18 |
| `/o/:orgId/schedule` → shift sheet | **Offer to staff** on a saved open shift: candidates eligible first with reasons, one Offer button | `GET /shifts/:id/candidates`, `POST /shifts/:id/offer` | 2026-11-20 |
| `/o/:orgId/employees` → row menu | **Availability & time off** sheet: weekly pattern (checked with the API's own schema), whole days off on the branch calendar, remove with confirm | `GET`/`PUT /employees/:id/availability`, `GET`/`POST /employees/:id/time-off`, `DELETE /time-off/:id` | 2026-11-20 |
| `/o/:orgId/locations` | **Job roles** section (add, rename in place, delete with a warning); card menu → **Departments** and **Shift templates** dialogs (owners and managers) | `/job-roles*`, `/locations/:id/departments`, `/departments/:id`, `/shift-templates*` | 2026-11-20 |
| `/o/:orgId/payroll` → View pay | **Pay per person** for an approved period, highest first, with each person's day lines | `GET /pay-periods/:id/payroll` | 2026-11-20 |

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
