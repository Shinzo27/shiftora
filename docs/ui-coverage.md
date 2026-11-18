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

## API-only routes and why

| Route | Why there is no screen |
|---|---|
| `POST /auth/refresh` | Called by the API client, never by a person. |
| `POST /auth/verify-email`, `/auth/password/*` | Reached only from a link in an email; the pages are `/verify-email`, `/reset-password`, `/forgot-password`. |
| `POST /me/push-subscriptions`, `DELETE /me/push-subscriptions` | The browser's PushManager calls them behind the toggle on `/profile`. |
| `/webhooks/*` | Providers call them, not people. |
| `/health/*` | Probes. |
