# Shiftora: project plan and full context

> One document with everything needed to understand, set up and continue the project:
> what we're building and why, every decision made so far, the tech stack, how the code is
> organised, what's done, and the day-by-day plan to launch.
>
> Last updated: 2026-11-12 (Week 2, Day 4 done) · Owner: Pratham (GitHub: Shinzo27)
>
> Deeper references: [PRD.md](PRD.md) (product detail), [ARCHITECTURE.md](ARCHITECTURE.md)
> (design detail), [AGENTS.md](AGENTS.md) (rules for coding agents), [docs/adr/](docs/adr/).
> If this file and those disagree, those win for their topic; update this file.

---

## Contents

1. [What Shiftora is](#1-what-shiftora-is)
2. [Status at a glance](#2-status-at-a-glance)
3. [Product](#3-product)
4. [Pricing, billing and quotas](#4-pricing-billing-and-quotas)
5. [Decisions log](#5-decisions-log)
6. [Tech stack](#6-tech-stack)
7. [Repository layout](#7-repository-layout)
8. [Local development](#8-local-development)
9. [Architecture essentials](#9-architecture-essentials)
10. [Data model](#10-data-model)
11. [API](#11-api)
12. [Testing](#12-testing)
13. [Rules and conventions](#13-rules-and-conventions)
14. [Day-by-day plan](#14-day-by-day-plan)
15. [After launch and future enhancements](#15-after-launch-and-future-enhancements)
16. [Go-to-market and career deliverables](#16-go-to-market-and-career-deliverables)
17. [Risks](#17-risks)
18. [Deferred items and known follow-ups](#18-deferred-items-and-known-follow-ups)
19. [How to read the code](#19-how-to-read-the-code)

---

## 1. What Shiftora is

**Shiftora** is a multi-tenant, multi-location SaaS for **shift scheduling and attendance** at
small businesses, **clinics first** (then restaurants, salons, retail, gyms). Managers build and
publish weekly schedules, staff get them on **WhatsApp**, clock in from a phone (**PWA**) with a
geofence or a rotating QR code, swap or pick up shifts, and managers export payroll-ready
timesheets. Priced **flat per location**, not per user.

Two goals, equally important:

| Goal | What success looks like |
|---|---|
| **Product** | Real paying users. 3–5 pilot businesses by end of week 8; 40+ clinics / 1,000+ employees by month 6. "5 paying customers beat 1,000 signups." |
| **Career** | A backend-heavy, production-grade system that lifts a ~1-year JS/TS developer (HRM admin panel with multi-tenant RBAC at a services company) into strong SDE-1 / SDE-2-stretch and founding-engineer conversations. Needs a live demo, real usage numbers, a case-study README and 1–2 engineering blog posts. |

The owner must be able to **explain every line in an interview**. That shapes everything:
boring, explainable technology; small, readable code; tests that document behaviour.

Target resume line (to earn with real numbers):

> Built and launched Shiftora, a multi-tenant workforce scheduling SaaS used by 40+ clinics
> (1,200 employees). Designed a constraint-based auto-scheduler cutting schedule creation from
> ~3 hrs to 5 min. Engineered geofenced and QR-based attendance with offline sync, and a BullMQ
> notification pipeline delivering 50k+ WhatsApp/SMS messages per month at 99.9% success.

---

## 2. Status at a glance

Repository: `git@github-personal:Shinzo27/shiftora.git` (private), branch `main`, CI green.

| Week / Day | Scope | Status | Commit |
|---|---|---|---|
| W1 D1 | Monorepo, tooling, Docker, CI | ✅ Done | `523210c` |
| W1 D2 | NestJS API skeleton, config, health checks, Drizzle, migration `0000_foundation` | ✅ Done | `ec72b13` |
| W1 D3 | Auth: signup/login/refresh/logout/me, argon2id, JWT + rotating refresh tokens, default-deny guard, RFC 7807 errors, rate limits | ✅ Done | `fb0274f` |
| W1 D4 | Tenancy: orgs, memberships, invites, RLS policies, per-request tenant transaction, roles, audit table | ✅ Done | `24bcf1b` |
| W1 D5 | Multi-location: locations, departments, job roles, manager location scopes, same-org foreign keys | ✅ Done | `69fa19c` |
| W1 D6 | Employees, availability, time off; web app shell (React) verified in a browser | ✅ Done | `4161e7b` |
| W1 UI | UI foundation: shadcn/ui design system, theme, dark mode, app shell, restyle existing pages | ✅ Done | `95af937` |
| W2 D1 | Time helpers on native Temporal (local → UTC, DST, weeks), shift templates, schedules | ✅ Done | `a2ca31f` |
| W2 D2 | `shifts` with an exclusion constraint (no double-booking), shift CRUD API, conflict checks as pure functions | ✅ Done | `345176c` |
| W2 D3 | Week board UI: rows by employee, colour per job role, today marker, shift create/edit in a Sheet with react-hook-form + Zod, week navigation with shadcn Calendar | ✅ Done | `0338f3e` |
| W2 D4 | Drag-and-drop with dnd-kit, optimistic moves, conflict badges from a week conflicts endpoint, stale-version toast + refetch | ✅ Done | `700d7fd` |
| W2 D5 | Publish: `schedule_publications` + `outbox` (`0007`), publish-preview and publish endpoints, the diff against the last publication, the Publish dialog, `publishedVersion` and the "Unpublished changes" badge | ✅ Done | `a531452` |
| W2 D6 | Realtime: Socket.IO on the API's HTTP server, one room per org, Redis adapter when `REDIS_URL` is set; other people's writes refresh the open board. Playwright E2E + a CI job | ✅ Done | `a531452` |
| W3 D1 | `/me` API (profile, my shifts, my time off); PWA (manifest, icons, service worker, offline shell); route-level code splitting; the staff app: bottom tabs, shift cards, Vaul drawer | ✅ Done | `9dc1630` |
| W3 D2 | `time_entries` (`0008`) with geofence policy, unique `client_event_id` and one open punch per person; `POST /clock-in`, `POST /clock-out`, `GET /me/time-entries`; haversine fence as pure domain maths; `Idempotency-Key` | ✅ Done | `bcea665` |
| W3 D3 | Clock card on the staff app: geolocation on tap, permission/secure-context/timeout states, a confirm step for a ±100 m fix, check-in notes for a flagged punch, live elapsed time; 3 Playwright tests with a granted permission and a placed device | ✅ Done | `a72e065` |
| W3 D4 | Punch ↔ shift matching as pure domain maths, per-org early/late grace (`0009`), derived state/late/early on every read, and the manager Timesheets page (week per branch, badges, worked-vs-rostered totals) | ✅ Done | `3f92fe4` |
| W3 D5 | Manager corrections in the location’s wall clock with a required reason, audited before/after, `GET`/`PATCH /time-entries/:id`, and the correction sheet with its history on the Timesheets page | ✅ Done | `b37a06a` |
| W3 D6 | Flag review queue (`0010` + partial index), `GET /attendance/flags` + `POST /time-entries/:id/review`, CSV export of the week with totals, and `pnpm db:seed` for a demo clinic with logins, a published week and three punches | ✅ Done | `a869c80` |
| W4 D1 | `apps/worker` + BullMQ, the outbox relay (claim with `FOR UPDATE SKIP LOCKED`, enqueue, then mark published; job id = outbox id), the relay GUC + policies (`0011`, ADR 017), and `pnpm dev` running the worker beside the API and web | ✅ Done | (uncommitted) |
| W2 → W8 | See [§14](#14-day-by-day-plan) | Planned | |

Numbers today: 14 migrations, 512 automated tests (266 unit, 246 integration against real
Postgres) plus 5 Playwright end-to-end tests, 66 API endpoints, a React web app on shadcn/ui
(login, orgs, locations, employees, the draggable week board with conflict badges, the publish
flow, live updates over a socket, and an installable staff app for phones; light and dark; axe
clean on WCAG 2.1 A/AA; Chrome reports no installability errors).

### Handoff note (update at the end of every session)

> Last session: 2026-11-12 (Hermes, second dev machine) — W3 D1 and D2 done.
>
> - **Committed:** W2 D5+D6 as `a531452` (owner), **W3 D1** as `9dc1630`, **W3 D2** as
>   `9b7ac19`.
> - **W3 D1 — the staff app.** `/me`, `/me/shifts`, `/me/time-off` for every member; the PWA
>   (manifest, icons, precached shell, no `/api` caching — installability errors `[]`, offline
>   shell paints); every route `lazy()` (entry chunk 339 → 130 kB gzip); `EmployeeLayout` with
>   bottom tabs, day-grouped cards and a Vaul drawer. `/o/:orgId` redirects by role.
> - **W3 D2 — attendance.** `0008_time_entries` adds the punches and
>   `organizations.geofence_policy` (`flag` default, `reject` optional), plus the
>   `shifts (org_id, id, location_id)` unique the composite FK needs. `POST /clock-in`
>   (idempotent by `Idempotency-Key` → `client_event_id`, unique per org; one open punch per
>   employee as a partial unique index), `POST /clock-out`, `GET /me/time-entries`. The fence is
>   `distance ≤ radius + min(accuracy, 100 m)` computed server-side in
>   `packages/domain/src/attendance/geofence.ts` (13 unit tests: haversine, widening, the
>   100 m ceiling, skew).
> - **Checks:** 219 unit + 204 integration + 2 E2E, lint, typecheck, build green. Verified in
>   Chrome at 390×844 (D1) and over HTTP against the real stack (D2 routes answer 401 unauth).
>   20 attendance integration tests cover: in/out of the fence, flag vs reject, the accuracy
>   edge, device skew, the two-simultaneous-punches race (201 + 409), key retries
>   (`created: false`), closing a punch twice, a punch claiming someone else's shift, and a
>   location from another org.
> - **W3 D3 — the clock card.** On "My shifts": the branch, the shift if there is one, and a
>   single button. A position is requested **on tap**, never on load — a prompt on load gets
>   refused and the browser remembers the refusal. Every failure becomes a sentence with a next
>   step: permission blocked, an insecure page (a phone on plain `http`), a timeout, no fix. A
>   fix worse than ±100 m is confirmed before sending ("Clock in anyway?"), and a punch the
>   server flagged says so on the card. The key for `Idempotency-Key` survives retries, and the
>   elapsed timer is keyed by punch id so a stale tick cannot label a new one.
> - **Checks (D3):** in Chrome at 390×844 with the device placed by CDP — inside the fence gave
>   "On the clock · just now · since 14:45"; 2 km away was recorded with "outside the branch
>   radius"; ±400 m asked first, then recorded "low-accuracy position"; revoked permission gave
>   "Location is blocked for this site…". axe 0 violations in both card states. Three Playwright
>   tests (real Chromium, permission granted, device placed) cover the same paths in CI.
> - **Fixed during D3, worth remembering:** the two-simultaneous-punches test was returning
>   500, not 409. A unique violation aborts the request transaction, so the recovery read failed
>   with 25P02. Punches now take a per-employee advisory lock before the checks, and the catch is
>   a bare 409 that touches nothing. Regression tests cover the concurrent double clock-in and
>   two simultaneous retries of the *same* Idempotency-Key.
> - **W3 D4 — matching, lateness and the manager view.** A punch is matched to the employee’s
>   shift whose start is nearest (within ±2 h of the shift) by a pure function in
>   `packages/domain/src/attendance/match.ts`; the app still sends the shift it is showing, so
>   matching only runs for a widget or a manual punch. Early/late comes from the organisation’s
>   grace (`organizations.attendance_grace_minutes`, default 5, migration `0009`) and is**derived
>   on every read**, never stored — so correcting a punch in D5 cannot leave a stale flag.
>   `GET /attendance?locationId&from&to` (owner/manager, location-scoped) returns the punches
>   with employee names, the rostered shift, and per-person worked-vs-rostered totals; the
>   disabled "Timesheets" nav item is now a real page at `/o/:orgId/timesheets`.
> - **Checks (D4):** 9 new integration tests (match by nearest start, lateness beyond the grace,
>   the org’s own grace, early, unscheduled, the employee’s own list, and the manager feed incl.
>   totals and a manager scoped to another branch). In Chrome: a punch 35 minutes after its
>   shift start reads "rostered 14:51–23:30 / 15:31 – … / 35 min late", totals show
>   worked vs rostered; axe 0 violations at 1440 and 390 px, no horizontal overflow.
> - **W3 D5 — corrections that stand up.** A manager fixes a punch from the Timesheets page.
>   Times are typed in the location’s own wall clock (like a shift) and the server converts them,
>   so nobody does zone arithmetic in a browser: `toInstant(day, time, zone)`. A clock-out
>   earlier than the clock-in is read as **the next morning** (a night shift), not as a negative
>   span, and anything longer than sixteen hours is refused as a typo. The reason is required and
>   lands in the same `audit_events` row as the before/after, so `GET /time-entries/:id` can show
>   a manager exactly what changed, when and by whom. Nothing is deleted: a forgotten clock-out
>   is reopened (`clockOutTime: null`), which is a 409 if that person already has another open
>   punch.
> - **Checks (D5):** 8 integration tests (before/after with the reason, lateness recomputed after
>   a correction, history appended not replaced, overnight, reopen + conflict, zero-length and
>   23-hour refusals, the required reason, employee 403 and out-of-scope manager 404). In Chrome:
>   corrected 15:31 → 14:55–19:30 from the sheet, the row reads "edited" with no late badge, the
>   history shows "15:31–… → 14:55–19:30", and both invalid-input messages appear; axe 0 with
>   the sheet open.
> - **W3 D6 — a demo in one command, and what to do about a flag.** `pnpm db:seed` builds
>   Sunrise Clinic: two branches at real Mumbai coordinates, four logins, three staff with rates
>   and availability, a **published** week and Monday’s punches — one on time, one 22 minutes
>   late, one 334 m outside the fence with a ±380 m fix. It is a fixture, inserted directly
>   inside one transaction with the org context set (the org id is minted first, because RLS
>   only accepts rows for the org the transaction points at — the same dance `OrgsService`
>   does). Re-running it deletes the demo org first, so it is idempotent.
> - **The buffer went to the review queue.** A count is not actionable, so `GET /attendance/flags`
>   returns the punches themselves with the distance and the accuracy as badges (`334 m away`,
>   `±380 m`). `POST /time-entries/:id/review` records `accepted` or `disputed`; a dispute needs a
>   note, because the employee will read it. The punch keeps its times and its flags — the verdict
>   is a separate fact, shown beside them. `reviewed_at IS NULL` is the queue’s only filter,
>   covered by a partial index (`0010`). "Export CSV" writes the week and its totals with
>   RFC-4180 quoting and a BOM, so Excel reads it as UTF-8.
> - **Checks (D6):** 5 integration tests (queue lists only unreviewed flagged punches, a clean
>   punch never appears, a dispute needs a note, a second review is a 409, the verdict shows on
>   the entry but is not an edit, employee 403 and out-of-scope manager 404), 4 unit tests for the
>   CSV writer, and the seed verified end to end through the API and in Chrome. The queue was
>   driven in Chrome: one accepted, one disputed with a note, both badges on their rows, queue
>   then empty; axe 0 at 1440 and 390 px.
> - **A forgotten clock-out cannot inflate the week.** The seed’s first run showed Rohan at
>   77 h worked: an open punch counts elapsed time, and elapsed time on a Monday punch read on a
>   Thursday is three days. The row still shows the live elapsed time (that is the truth of "on
>   the clock"), but `totalsOf` counts an **open** punch at most its rostered length, and an open
>   punch with no rostered shift counts nothing until a manager says what it was. Deciding what a
>   runaway punch means is the manager's job; the timesheet's job is not to invent overtime.
>   Covered by an integration test (two days open, 8-hour shift → 480 minutes in the totals).
> - **W4 D1 — the relay, and the only cross-tenant read in the system.** `apps/worker` is a plain
>   Node process: it ticks every 2 s and, in one transaction, sets a transaction-local flag
>   (`app.outbox_relay`), claims up to 50 pending events with `for update skip locked`, puts each
>   on the `notifications` queue with **the outbox row id as the job id**, and only then marks them
>   published. That order is the design: a failed enqueue rolls back (the event is late, not lost),
>   a crash between insert and commit re-claims the row and BullMQ drops the duplicate, and marking
>   first would trade both for a "published" row with nothing behind it. Widening RLS needed two
>   policies on `outbox` alone (ADR 017); every job after that runs under one org's context.
> - **Checks (D1):** 7 integration tests against real Postgres — claim and publish, nothing left on
>   the next tick, oldest-first with a batch limit, rollback when the queue refuses, the same job id
>   after a rollback, three relays racing over three rows with no duplicates, and tenant isolation
>   without the flag. End to end on the dev database: 20 pending events became 20 jobs with matching
>   ids and 20 published rows, and restarting the worker queued 0 more.
> - **W4 D2 — who gets told, and on which channel.** A notification is one person's message:
>   the body is personal ("Hi Asha, your week at … is published"), so `notifications` carries the
>   employee and `(outbox_id, employee_id)` is unique — replaying an event cannot double-send.
>   Only the **affected** employees are messaged, taken from the publication diff, because telling
>   the whole rota every week is how people learn to ignore notifications. Routing is a pure
>   function: their own preference if it has an address and the tenant allows it, else email (the
>   login, so it always exists), with email and push as the ladder and never a silent WhatsApp —
>   silence is not consent to a channel the clinic pays for per message.
> - **W4 D3 — the first channel that actually sends.** `dispatchDelivery` reads the row, counts
>   the attempt *before* calling the provider (a process that dies mid-send still leaves
>   evidence), records `sent`/`failed`/`skipped` with the reason, and throws only to ask the
>   queue for backoff. It never sends twice: a second job for a sent delivery is a no-op. Email
>   is SMTP, so Mailpit locally and any relay in production run the same code — verified live: a
>   published change produced a delivery `sent` in one attempt and exactly one message in
>   Mailpit.
> - **W4 D3 (continued) — the invite email, and the first message to a person who is not staff.**
>   `POST /invites` writes `invite.created` to the outbox **in the same transaction** as the invite
>   row, so an invite cannot exist without an email on its way. The recipient is an *address*:
>   `notifications.employee_id` had to become nullable and gain `recipient_email`, with a CHECK
>   that one of them is always set — and a plain unique index on `(outbox_id, recipient_email)`
>   for replay protection. Plain, not partial: Postgres treats NULLs as distinct, so staff rows
>   never collide, and `ON CONFLICT` cannot infer a partial index (it failed with `42P10` until
>   this changed). The code still comes back in the API response — a manager standing next to the
>   person may want to read it out — but the email is the normal path.
> - **Verified live:** invited `new.manager@sunriseclinic.test`, and Mailpit holds "You are
>   invited to Sunrise Clinic on Shiftora" with the link `/invite/<orgId>.<code>`; the delivery
>   row went to `sent`. D3's own done-when ("invite arrives in Mailpit with a working link") is
>   now met.
> - **Still open in D3 (deliberately not claimed):** Web Push (VAPID keys, a `push_subscriptions`
>   table, the subscribe endpoint and the staff-app button) and password reset / email
>   verification — both need one-time-token tables and endpoints that do not exist yet.
> - **Next:** finish D3 (push + auth emails), then W4 D4 — WhatsApp and SMS adapters behind the
>   same dispatch contract, with per-provider rate limits, a dead-letter queue and fallback down
>   the routing ladder when a channel fails permanently.
> - **Open question for the owner:** nothing blocks D3. The org-level `geofence_policy` is only
>   settable in SQL today — the UI for it belongs with org settings (W3 D5 or W7), and the
>   `reject` mode will need a manager override path eventually.
> - **CI fix after W3 D2:** the Playwright job failed with `ECONNREFUSED :4000` because the
>   config waited only on Vite while the API was still compiling. It now declares one
>   `webServer` per app (API readiness = `/health/live`) and the e2e job runs `pnpm build`
>   before the tests. Reproduced and fixed locally with `CI=1 pnpm test:e2e` against a stopped
>   stack: 2 passed in 14.7 s.
> - **Watch out for:** `TestUser.call` now takes `headers` (that is how `Idempotency-Key` is
>   tested). `react-hooks/purity` rejects `Date.now()` in render (carry the moment out of the
>   `queryFn`). A `<div>` inside `<dl>` may only wrap `dt`/`dd` (axe). `vite preview` has no
>   `/api` proxy.

## 3. Product

### 3.1 Problem

Small businesses plan shifts in WhatsApp groups, Excel or on paper.

| Pain | Today | Consequence |
|---|---|---|
| Availability and role coverage | Messages + spreadsheet | Hours per week of manager time, coverage gaps |
| Last-minute sick calls | Phone calls | Unfilled shifts |
| Buddy punching | Paper register | Paid hours never worked |
| Overtime and payroll | Manual maths | Errors and disputes |
| Labour-law compliance | Not tracked | Max-hours and rest violations |
| Clinical credentials | Not tracked | Staff working with expired licences |

### 3.2 Positioning

**Clinics first, WhatsApp-first, flat price per location.** Not "Deputy but cheaper".
Competitors: Deputy, When I Work, Homebase, 7shifts, Sling, Connecteam: US/EU-focused,
per-user pricing, expensive for small teams.

### 3.3 Users

| Persona | Jobs |
|---|---|
| **Owner** (clinic owner / practice manager, 1–3 locations) | Set up org and locations, pay rules, see labour cost, export payroll, billing |
| **Manager / scheduler** | Build and publish the rota, approve swaps, fill gaps, fix timesheets |
| **Employee** (nurse, receptionist, doctor; phone + WhatsApp) | See schedule, clock in/out, swap/drop, pick up open shifts |
| **Kiosk** (front-desk tablet) | Show the rotating QR code for clock-in |
| **Platform admin** (Shiftora team) | Coupons, subscription overview |

### 3.4 MVP features (weeks 1–6)

| # | Feature | Key acceptance points |
|---|---|---|
| F1 | Multi-tenant orgs, **multi-location from day one** | RLS isolation; 1..N locations each with lat/lng, radius, IANA zone; managers scoped to locations; hours counted across all locations |
| F2 | Employee profiles | Job roles/skills, hourly rate, max weekly hours, recurring availability + time off, notification channel |
| F3 | Drag-and-drop weekly schedule builder | Draft → publish; conflict warnings (overlap, availability, max hours, min rest); notify only changed employees; live board |
| F4 | Geofenced clock in/out (PWA) | Server-side distance check; tolerance windows; location only at clock events |
| F5 | Shift swap and drop | Colleague accepts, manager approves, re-validated on approval |
| F6 | Timesheets + payroll export | Per pay period; edits need a reason (audited); overtime; CSV/XLSX |
| F7 | Notifications | Email + web push (all plans); WhatsApp (Meta Cloud API) + SMS (Pro) |

### 3.5 Advanced features (weeks 5–8 and after): the resume weight

| # | Feature |
|---|---|
| A1 | **Auto-scheduler**: TypeScript greedy + bounded backtracking first; OR-Tools CP-SAT later behind the same contract |
| A2 | **Open-shift marketplace**: race-safe first-to-accept |
| A3 | **Anti-fraud attendance**: geofence + rotating QR (30 s) + optional selfie; fraud flags |
| A4 | **Pay rules engine**: per-tenant, versioned JSON rules (overtime, night premium, breaks) |
| A5 | **Credential expiry alerts** (60/30/7 days) and blocking expired roles |
| A6 | **Labour-cost forecast vs budget** |
| A7 | **Offline clock-in** with sync and conflict resolution |
| A8 | **Immutable audit log** (table exists since D4; UI and partitioning in week 7) |

### 3.6 Non-goals (for now)

Full payroll/tax processing (export only) · native apps in the MVP · generic HRIS (leave,
appraisals) · SSO/SAML · multi-country labour-law packs · microservices.

### 3.7 Key user flows

1. **Onboarding:** sign up → create org → first location (map pin, radius, zone) → job roles →
   import employees → invite via WhatsApp/email link.
2. **Weekly scheduling:** open next week → templates or auto-scheduler → drag-and-drop →
   resolve warnings → publish → staff get a WhatsApp link.
3. **Attendance:** arrive → open PWA → scan tablet QR or GPS clock-in → clock out → timesheet.
4. **Swap:** request → colleague accepts → manager approves → both notified, audit written.
5. **Open shift:** sick call → manager opens shift → eligible staff notified → first valid accept wins.
6. **Payroll:** end of period → review flags → approve → export.

---

## 4. Pricing, billing and quotas

| Plan | Monthly price (+ 18% GST) | Employees | Includes |
|---|---|---|---|
| Free | ₹0 | Up to 10 | 1 location, email + push, schedule builder, clock-in, timesheets |
| Pro | ₹999 | Unlimited | 1 location, WhatsApp/SMS, auto-scheduler, pay rules, exports, credential alerts |
| Additional location | ₹999 each | Unlimited | Each extra location on Pro |

- **GST on top:** Pro = ₹999 + ₹179.82 = ₹1,178.82/month. 3 locations = ₹2,997 + GST.
- **Billing:** INR via **Razorpay Subscriptions** (cards, UPI AutoPay). Monthly only (no annual plan yet).
- **GST invoices:** generated by Shiftora: gap-free numbering per financial year
  (`SHF/2026-27/000123`), CGST+SGST (same state) or IGST (other state), optional buyer GSTIN.
  Seller GSTIN, SAC code, rate and prefix are **config values**; CA sign-off deferred.
- **Failed payments:** 7-day grace, then extra locations read-only and Free limits (no data deleted).
- **Coupons:** managed by platform admins: custom or random codes (`SHF-7KQ2-M9XD`), single or
  bulk; % or fixed ₹; base / locations / both; once, N months or forever; validity dates,
  max redemptions, one per org; applied before GST; race-safe redemption.
- **Messaging quotas (Pro):** per paid location per month, pooled across the org:
  **1,000 WhatsApp + 200 SMS**, email and push unlimited. Warn at 80%/100%; over quota
  falls back to push + email (no surprise charges). Free plan never sends WhatsApp/SMS.
  Reminders default to push to save quota.

---

## 5. Decisions log

| # | Decision | Date |
|---|---|---|
| — | Idea #14 of 15 chosen: shift scheduling and attendance (fits HRM experience) | 2026-11-02 |
| — | Product name **Shiftora** | 2026-11-03 |
| 001 | Modular monolith, not microservices | 2026-11-02 |
| 002 | **NestJS** (Fastify adapter) | 2026-11-03 |
| 003 | **PWA** for the MVP; React Native app as a future enhancement | 2026-11-03 |
| 004 | **Postgres RLS** for tenant isolation | 2026-11-02 |
| 005 | **Drizzle** + SQL migrations, not Prisma | 2026-11-03 |
| 006 | Transactional outbox for side effects | 2026-11-02 |
| 007 | Auto-scheduler: TypeScript heuristic first, OR-Tools CP-SAT later | 2026-11-03 |
| 008 | WhatsApp via **Meta WhatsApp Cloud API** directly (no BSP) | 2026-11-03 |
| 009 | **Multi-location from day one** (org = tenant, location = operational unit) | 2026-11-03 |
| 010 | Pricing: Free ≤ 10 employees; Pro ₹999; +₹999 per extra location | 2026-11-03 |
| 011 | INR billing via Razorpay; Shiftora issues its own GST invoices | 2026-11-03 |
| 012 | Coupon engine owned by Shiftora, managed by platform admins | 2026-11-03 |
| 013 | Quotas: 1,000 WhatsApp + 200 SMS per paid location/month, fallback to push/email | 2026-11-03 |
| 014 | Org chosen per request with **`X-Org-Id`**; role read from DB each request ([ADR](docs/adr/014-org-selection-header.md)) | 2026-11-05 |
| — | Prices exclusive of GST; Free plan = 1 location | 2026-11-03 |
| — | TypeScript pinned to 6.0.x (typescript-eslint doesn't support TS 7 yet) | 2026-11-03 |
| — | Rate limiting with `@nestjs/throttler` (not `@fastify/rate-limit`) so 429s use our error format | 2026-11-05 |
| — | UUIDv7 primary keys generated in the app (Postgres 16 has no `uuidv7()`) | 2026-11-05 |
| — | Invites moved from Day 3 to Day 4 (they need orgs) | 2026-11-05 |
| — | Location scope rule: owners see every location; anyone else is limited to their `membership_locations` rows, or sees every location if they have none. Hidden locations answer 404 | 2026-11-06 |
| — | Child tables reference `(org_id, location_id)` → `locations (org_id, id)` (same-org foreign keys), because FK checks ignore RLS | 2026-11-06 |
| — | **UI: shadcn/ui + component libraries for an attractive, modern product UI**; dark mode from the start; react-hook-form introduced with the shift editor (W2 D3), plain `FormData` + Zod until then; `is_primary` on employee locations dropped until clock-in | 2026-11-06 |
| — | Employees are separate from users (most staff never log in); optional link to a member; archived, never deleted | 2026-11-06 |
| — | Weekly availability in local wall-clock time (overnight allowed); time off as UTC instants | 2026-11-06 |
| — | Legacy time-zone names (`Asia/Calcutta`) are normalised to current ones (`Asia/Kolkata`) on input | 2026-11-06 |
| — | Web dev server proxies `/api` to the API (same origin, no CORS in development) | 2026-11-06 |
| — | Locations are never deleted, only made `read_only`; plan limits (Free = 1 location) move to W8 D2 with billing | 2026-11-06 |
| — | UI foundation as built: shadcn/ui (`radix-nova` style, Radix base) with components copied into `apps/web/src/components/ui`; TanStack Table **v9** (`useTable` + `tableFeatures`); a small local `ThemeProvider` (`src/lib/theme.tsx`) instead of `next-themes` (which injects a `<script>` React 19 warns about), with a no-flash snippet in `index.html`; shadcn's `cn` package replaces clsx + tailwind-merge; `?new=1` in the URL opens an "add" sheet (used by ⌘K and onboarding) | 2026-11-06 |
| — | Time maths on **native Temporal** instead of date-fns-tz/Luxon (no dependency; IANA/DST rules come from the platform). DST: skipped local times move forward, repeated ones take the first occurrence ("compatible"). Weeks run **Monday–Sunday** in the location's zone (`WEEK_STARTS_ON`); a per-org setting can come later | 2026-11-06 |
| — | One schedule per location and week (`unique (location_id, week_start)`, Monday CHECK); its API reports the week's real UTC bounds (167–169 h around DST). Templates keep local `time`s; deleting a job role clears it from templates via `ON DELETE SET NULL (job_role_id)` | 2026-11-06 |
| — | Table naming: **`job_roles`** for work roles (Nurse, Receptionist), distinct from the `member_role` access enum; **`time_off`** instead of `unavailability`; referencing columns are `job_role_id` | 2026-11-06 |
| — | **Shifts take local date + HH:MM times**, the server converts with the location's zone (clients never do time zone maths); the response carries both the instants and the wall clock | 2026-11-06 |
| — | **Overlap is the only hard shift conflict** (409, and a DB exclusion constraint as the last word); availability, time off, max weekly hours and min rest come back as `warnings` on the write — PRD F3 calls them warnings, and a manager may knowingly overrule one | 2026-11-06 |
| — | A shift belongs to its schedule's **location**, enforced by a 3-column same-org FK `(org_id, schedule_id, location_id) → schedules (org_id, id, location_id)`; another branch means another shift | 2026-11-06 |
| — | A shift counts towards the week it **starts** in (local date), so a Sunday-night shift stays in its own week; weekly hours subtract unpaid breaks and count every location | 2026-11-06 |
| — | `shifts.job_role_id` is nullable (a template may have none) and cleared when the role is deleted; **archived employees cannot be scheduled** (409 `employee.archived`) | 2026-11-06 |
| — | POST/PATCH a shift return **`{ shift, warnings }`**, the one place where a write answers with more than the resource | 2026-11-06 |
| — | The board's rows are the employees of the chosen location; a shift sits under the **local date it starts** (an overnight shift stays on its evening); open shifts get their own last row, and shifts whose employee left the team get a row too, so nothing on the week is invisible | 2026-11-12 |
| — | With "All locations" selected the board asks **which location** (buttons, or the top-bar switcher); a single-location org skips the question | 2026-11-12 |
| — | **react-hook-form + Zod** in the shift editor: the form schema mirrors the shared rules (`localDate`, `localTime`, `shiftTemplateIssue`) while the server still validates the real request; native `<input type=date|time>` for the fields, shadcn Calendar only for jumping weeks | 2026-11-12 |
| — | A saved shift with warnings **keeps the sheet open** (footer becomes "Done") so the manager reads them; a clean save closes with a toast | 2026-11-12 |
| — | The board loads **one page of up to 100 employees** for the location and says so when there is more; server-side search stays a follow-up | 2026-11-12 |
| — | The Schedule nav item is managers-only until "my shifts" ships for employees (W3) | 2026-11-12 |
| — | **`GET /schedules/:id/conflicts`** returns the week's advisories in one request (`shiftId → warnings`), computed from three batched queries; the board badges chips from it instead of asking per shift | 2026-11-12 |
| — | **What was published is a table, not a jsonb snapshot on the schedule** (`schedule_publications`): the audit trail of what staff were told, an audience for the notification worker, and the diff becomes a plain comparison against the latest row | 2026-11-12 |
| — | **`schedules.published_version` is a second counter, not a boolean**: `version > published_version` answers "has the board changed since staff were told?" without diffing, and the CHECK constraint keeps it honest | 2026-11-12 |
| — | **Location is asked for on tap, never on page load**: a prompt that appears the moment the staff app opens gets refused, and the browser remembers the refusal for the origin — which reads as a broken app, not a cautious one | 2026-11-12 |
| — | **A fix worse than ±100 m is confirmed, not silently sent**: the card asks first ("Clock in anyway?") because the manager will see the flag either way; the server still decides, and the same data still lands in the row | 2026-11-12 |
| — | **The clock card lives on "My shifts", not in a tab of its own**: clocking in is the one thing done on arrival, and a fourth tab for one button would cost a tap every shift | 2026-11-12 |
| — | **The geofence policy is the tenant's, and it flags by default** (`organizations.geofence_policy`: `flag` \| `reject`): a clinic would rather have the punch with an `outside_geofence` flag than an employee who cannot start work because their phone drifted | 2026-11-12 |
| — | **The server measures the distance, never the device**: coordinates are stored and `in_distance_m` is computed from the organisation's own copy of the location, so the client's arithmetic is never an input to the decision | 2026-11-12 |
| — | **`Idempotency-Key` *is* the punch's `client_event_id`**, unique per org: a retry after a dead connection returns the row it created (`created: false`) instead of a duplicate or a 409. One open punch per employee is a partial unique index, not a service check | 2026-11-12 |
| — | **`/me` is its own surface, not a filtered `/employees`**: three self-service reads (profile, my shifts, my time off) that any member may call, returning `profile: null` / empty lists when the login is not linked to a staff record. Employees could not read anything about themselves before this | 2026-11-12 |
| — | **The PWA precaches the shell and nothing else** — no runtime caching of `/api`, because a stale rota shown to staff as if it were current is worse than an error; offline clock-in will be an explicit IndexedDB queue (W3 D6), not a cached GET | 2026-11-12 |
| — | **Realtime is a refetch hint, not data** (ADR 016): Socket.IO over the API's own server, one room per organisation, payload names the schedule; clients refetch over HTTP, so a dropped event costs freshness and never correctness. Redis adapter only when `REDIS_URL` is set | 2026-11-12 |
| — | A **drag changes the date and/or the assignee only** — never the times (they live in the sheet). Dropping on the open-shifts row unassigns; dropping on a person assigns | 2026-11-12 |
| — | Moves are **optimistic**: the chip lands at once, the previous list is restored on any error, and a stale `version` shows "Someone else changed this shift" then refetches the week | 2026-11-12 |
| — | Keyboard drag works (Space to pick up, arrows, Space to drop) and a plain click still opens the sheet: PointerSensor activates after 5 px, TouchSensor after a 250 ms hold | 2026-11-12 |
| — | dnd-kit sensor **options are module constants**: an inline options object is recreated every render, which silently cancels a drag in progress | 2026-11-12 |

---

## 6. Tech stack

### 6.1 Runtime and tooling (installed versions)

| Area | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js | 26.x (`.nvmrc`) | Current LTS; native `require(esm)`, `process.loadEnvFile` |
| Package manager | pnpm | 12.16.1 (pinned in `packageManager`) | Workspaces, strict deps, supply-chain settings |
| Monorepo tasks | Turborepo | 2.11.10 | Cached build/lint/test across packages |
| Language | TypeScript | 6.0.3 (pinned `~6.0`) | Strict mode everywhere; TS 7 blocked by typescript-eslint |
| Module format | ESM everywhere | — | NestJS 12 ships as ESM |
| Lint / format | ESLint 10.13 + typescript-eslint 8.72 (type-aware) + Prettier 3.9 | — | No `any`, no floating promises, named exports only |
| Tests | Vitest 4.1.12; `unplugin-swc` 2.0 + `@swc/core` 1.16 for Nest | — | SWC keeps decorator metadata Nest DI needs |
| Integration tests | Testcontainers 12.2 (`postgres:16-alpine`) | — | Real Postgres, same roles + migrations as dev |
| CI | GitHub Actions | checkout v7, setup-node v7, pnpm/action-setup v6 | format → lint → typecheck → test → test:int → build |

Supply-chain settings in `pnpm-workspace.yaml`: `minimumReleaseAge: 10080` (never install a
version younger than 7 days) and `allowBuilds` (install scripts denied for esbuild,
@swc/core, ssh2, cpu-features, protobufjs, which ship prebuilt binaries or don't need them).

### 6.2 Backend (in use)

| Area | Choice | Version |
|---|---|---|
| API framework | NestJS on Fastify | @nestjs/* 12.3.2, fastify 5.12.7 |
| Database | PostgreSQL | 16 (16.15 locally) |
| DB toolkit | Drizzle ORM + drizzle-kit, `pg` driver | 0.45.4 / 0.31.11 / pg 8.23.1 |
| Validation / contracts | Zod (shared schemas in `packages/shared`) | 4.6.7 |
| Password hashing | `@node-rs/argon2` (argon2id, m=19456 KiB, t=2, p=1) | 2.2.2 |
| JWT | `jose` (HS256) | 6.2.13 |
| Cookies | `@fastify/cookie` | 11.1.5 |
| Rate limiting | `@nestjs/throttler` (in-memory now) | 6.7.1 |
| IDs | `uuid` v7 | 14.0.3 |
| Request context | Node `AsyncLocalStorage` | built in |

### 6.3 Planned (not installed yet)

| Area | Choice | Arrives |
|---|---|---|
| Queues / cron | BullMQ on Redis 7.4 (Redis already in docker-compose) | Week 4 |
| Realtime | Socket.IO + Redis adapter | Week 2 D6 |
| Web app (in use) | React 19.3 + Vite 8.3 + React Router 8.5 + TanStack Query 5.105 + Tailwind 4.3 | Week 1 D6 |
| UI components (approved) | **shadcn/ui** (Radix primitives, copied into `apps/web/src/components/ui`), lucide-react icons, sonner (toasts), cmdk (⌘K palette), TanStack Table (data tables), react-day-picker (shadcn Calendar/date picker), Vaul (mobile drawers), Motion (animations), dnd-kit (schedule board), shadcn Charts / Recharts (labour cost, dashboards), Inter Variable via @fontsource; **react-hook-form** + Zod resolver for complex forms | W1 UI day → W2+ |
| PWA | vite-plugin-pwa (Workbox), IndexedDB for offline queue | Week 3 |
| Dates | **Native `Temporal`** (Node 26, TS `esnext.temporal`) inside `packages/domain/time`; its API takes and returns plain values (`YYYY-MM-DD`, `HH:MM`, `Date`). No date library | Week 2 D1 |
| Email | Resend or AWS SES (Mailpit locally) | Week 4 |
| WhatsApp / SMS | Meta WhatsApp Cloud API; Twilio or MSG91 | Week 4 |
| Push | Web Push (VAPID) | Week 4 |
| Exports | exceljs (streamed XLSX), csv-stringify | Week 6 |
| Billing | Razorpay Subscriptions; PDF invoices (pdfkit / react-pdf) | Week 8 |
| Observability | OpenTelemetry → Grafana (Tempo/Loki/Prometheus), pino JSON logs, Sentry | Week 7 |
| E2E tests | Playwright | Week 2+ |
| Property tests | fast-check (pay rules, scheduler) | Week 6–7 |
| Deploy | Docker images on Fly.io/Render/Railway; managed Postgres (Neon/Supabase/RDS) + Redis (Upstash) | Week 8 |
| Solver (later) | Python + OR-Tools CP-SAT worker | After launch |

---

## 7. Repository layout

```
shiftora/
├── apps/
│   ├── api/                         NestJS HTTP API (port 4000, prefix /api/v1)
│   │   ├── src/main.ts              boot: load .env → create app → configureApp → listen
│   │   ├── src/app.module.ts        module list (global guard + interceptor live here)
│   │   ├── src/configure-app.ts     prefix, CORS, error filter, cookies (shared with tests)
│   │   ├── src/config/              Zod-validated env → injectable AppConfig
│   │   ├── src/common/              AppException, RFC 7807 filter, Zod pipe, clock, crypto
│   │   ├── src/database/            DATABASE pool token, RequestContext (AsyncLocalStorage)
│   │   ├── src/health/              /health/live, /health/ready
│   │   ├── src/modules/auth/        users, sessions, JWT guard, signup/login/refresh/logout/me
│   │   ├── src/modules/tenancy/     TenancyInterceptor, @Roles, @WithoutOrg, @CurrentMember
│   │   ├── src/modules/orgs/        organizations, memberships, members API
│   │   ├── src/modules/invites/     invite codes, accept flow
│   │   ├── src/modules/audit/       AuditService
│   │   └── src/testing/test-app.ts  whole app + throwaway Postgres for integration tests
│   ├── worker/                      (week 4) BullMQ processors, outbox relay, cron
│   └── web/                         React app (Vite, port 5173, proxies /api to :4000): login, orgs,
│                                    locations, employees, week board (schedule);
│                                    src/lib/api-client.ts = token + refresh logic
├── packages/
│   ├── config/                      shared tsconfig + ESLint presets
│   ├── db/                          Drizzle schema, SQL migrations (incl. RLS), client, test DB helper
│   ├── domain/                      pure business logic: Clock, addSeconds, role rules (later: scheduling, pay)
│   └── shared/                      Zod request/response schemas + error codes
├── infra/
│   ├── docker-compose.yml           Postgres 16 (:5433), Redis 7.4 (:6379), Mailpit (:1025/:8025)
│   └── postgres/init/01-roles.sql   creates app_owner and app_user (fresh volume only)
├── docs/adr/                        architecture decision records
├── .github/workflows/ci.yml
├── PROJECT_PLAN.md (this file) · PRD.md · ARCHITECTURE.md · AGENTS.md · README.md
```

Dependency direction: `config ← domain ← shared ← db ← api`. Nothing in `packages/`
imports from `apps/`.

---

## 8. Local development

### 8.1 New machine setup

```bash
# Tools: Node 26, pnpm 12, Docker
npm install -g pnpm@12          # corepack 0.32 can't run pnpm 12
docker context use default      # if the CLI points at a Docker Desktop that isn't running

# Clone with the PERSONAL GitHub account. Add this to ~/.ssh/config first (key path is yours):
#   Host github-personal
#     HostName github.com
#     User git
#     IdentityFile ~/.ssh/<personal key>
#     IdentitiesOnly yes
git clone git@github-personal:Shinzo27/shiftora.git && cd shiftora
git config user.name "Shinzo27"
git config user.email "20bmiit031@gmail.com"     # repo-local, never --global

pnpm install
cp .env.example .env
pnpm infra:up                   # Docker must be running
pnpm build                      # packages are used from dist/; dev/test also build them first
pnpm db:migrate
pnpm dev                        # http://localhost:4000/api/v1/health/ready → 200
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int   # all green = machine is ready
```

Ports 5433 (Postgres) and 4000 (API) were chosen because 5432/3000 were busy on the first
machine; change them in `.env` and `infra/docker-compose.yml` if your machine differs.

### 8.2 Commands

| Command | What it does |
|---|---|
| `pnpm infra:up` / `infra:down` | Start / stop Postgres, Redis, Mailpit |
| `pnpm db:migrate` | Build `@shiftora/db` and apply migrations as `app_owner` |
| `pnpm db:generate` | drizzle-kit: write the next migration from `packages/db/src/schema` |
| `pnpm --filter @shiftora/db exec drizzle-kit generate --custom --name=<x>` | Empty migration for hand-written SQL |
| `pnpm dev` | API in watch mode (later also worker and web) |
| `pnpm format` / `format:check` | Prettier |
| `pnpm lint`, `pnpm typecheck` | ESLint (type-aware), tsc |
| `pnpm test` | Unit tests |
| `pnpm test:int` | Integration tests (Docker required) |
| `pnpm build` | Build all packages |

**Definition of done for any change:** `pnpm format:check && pnpm lint && pnpm typecheck &&
pnpm test && pnpm test:int && pnpm build` all pass.

### 8.3 Ports and services

| Service | Port | Notes |
|---|---|---|
| API | 4000 | 3000 is taken by another project on the dev machine |
| Postgres | 5433 | 5432 is taken by a system Postgres |
| Redis | 6379 | |
| Mailpit SMTP / UI | 1025 / 8025 | catches all outgoing email locally |
| Web (Vite, planned) | 5173 | `WEB_ORIGIN` for CORS |

### 8.4 Environment variables (`.env.example`)

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `HOST`, `PORT` | Runtime basics (`PORT` default 4000) |
| `DATABASE_URL` | API connection, as **app_user** |
| `MIGRATION_DATABASE_URL` | Migrations, as **app_owner** |
| `JWT_ACCESS_SECRET` | ≥ 32 chars; a `dev-only…` value is refused in production |
| `ACCESS_TOKEN_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_DAYS` (30) | Token lifetimes |
| `WEB_ORIGIN` | Browser origin allowed by CORS (with credentials) |
| `REDIS_URL`, `SMTP_HOST`, `SMTP_PORT` | Used from week 4 |

The API validates all of this at startup and refuses to start with a clear message naming the
bad variable (never its value).

### 8.5 Database roles

| Role | Used by | Can |
|---|---|---|
| `postgres` | You, locally, for admin | Everything (superuser). Never used by app code |
| `app_owner` | Migrations | Owns schema and tables. RLS still applies (tables use FORCE) |
| `app_user` | API and worker | Read/write rows through RLS; owns nothing; no BYPASSRLS |

`01-roles.sql` runs only when the Postgres volume is first created. To reset local data:
`docker compose -f infra/docker-compose.yml down -v`, then `pnpm infra:up && pnpm db:migrate`.

---

## 9. Architecture essentials

### 9.1 Shape

Modular monolith: one codebase, one Postgres, two process types later (API + worker from
the same code). Modules talk through exported services and domain events. Explainable, cheap
to run, and defendable in interviews ("why not microservices?": team of one, < 10k users,
cross-module transactions like shift + audit + outbox are trivial in one database).

```
Web app / Employee PWA / Kiosk ──HTTPS + WebSocket──▶ API (NestJS/Fastify)
                                                        │  one transaction per request,
                                                        │  RLS context set first
                                                        ▼
                                                   PostgreSQL ◀── outbox relay ── Worker (BullMQ)
                                                        │                            │
                                                     Redis (queues, pub/sub) ◀───────┘
                                                                                     ▼
                                                     Email / WhatsApp / SMS / Push providers
```

### 9.2 Life of an authenticated request (implemented)

```
Fastify
 → JwtAuthGuard (global)        verify Bearer token → request.user (or 401); @Public() skips
 → ThrottlerGuard (some routes) 10/min/IP on signup, login, refresh
 → TenancyInterceptor (global)  read X-Org-Id (unless @WithoutOrg) → BEGIN
                                set_config('app.user_id'/'app.org_id', …, true)
                                load membership → 403 if none; check @Roles → 403
                                run handler inside RequestContext (AsyncLocalStorage)
 → ZodValidationPipe            parse body with a shared schema → 400 with field errors
 → Controller → Service → Repository (uses RequestContext.tx; filters by org_id explicitly)
 ← COMMIT on success / ROLLBACK on any thrown error (audit rows included)
 ← ProblemDetailsFilter         every error → RFC 7807 application/problem+json with a stable code
```

### 9.3 Multi-tenancy (implemented in D2 + D4)

- **RLS enabled and FORCED** on every tenant table; policy `tenant_isolation` compares
  `org_id` with `current_org_id()`. With no context set, every query sees **nothing**.
- Extra read-only policies let a user see **their own** memberships and orgs without an org
  selected (needed for "list my orgs").
- Policies on one table are OR-ed, so **repositories always filter by `org_id` explicitly**;
  RLS is the safety net (a test proves the filter is needed).
- Org chosen per request with `X-Org-Id`; role read from the DB every request, so removing a
  member is immediate (ADR 014).
- `RequestContext.enterOrg()` moves a transaction into an org mid-request (creating an org,
  accepting an invite). Invite codes are `<orgId>.<secret>` so lookups work through RLS.

### 9.4 Authentication (implemented in D3)

- Access token: JWT HS256, 15 min, `sub`/`iss`/`aud`, in the response body; the web app keeps it in memory.
- Refresh token: 32 random bytes; only SHA-256 stored in `sessions`; cookie `shiftora_rt`
  (HttpOnly, SameSite=Strict, Path=/api/v1/auth, Secure in production), 30 days.
- Rotation on every refresh with **reuse detection**: an already-used token revokes the whole
  login family. Conditional `UPDATE … WHERE revoked_at IS NULL` makes concurrent refreshes safe.
- Identical errors (and timing) for unknown email vs wrong password.
- Default deny: every route needs a token unless `@Public()`.

### 9.5 Cross-cutting rules (some planned)

| Topic | Rule |
|---|---|
| Time | Instants in `timestamptz` UTC; templates/availability as local wall-clock + location IANA zone; inject a `Clock`; DST and overnight tests required |
| Money | Integer minor units (paise) + currency; durations in integer minutes |
| Business logic | Pure functions in `packages/domain` (no DB, no Nest, no `Date.now()`) |
| Side effects | Write an `outbox` row in the same transaction; the worker delivers (week 4) |
| Concurrency | Conditional UPDATE / `SELECT … FOR UPDATE` + idempotency keys + a "N parallel → one winner" test |
| Audit | Changes to tenant data call `AuditService.record()` in the same transaction; table is append-only |
| Errors | `AppException(status, code, detail)`; codes in `packages/shared/src/problem.ts` |

---

## 10. Data model

### 10.1 Implemented (migrations 0000–0008)

| Migration | Contents |
|---|---|
| `0000_foundation` | extensions `btree_gist`, `citext`; default grants to `app_user`; `current_org_id()` |
| `0001_auth` | `users`, `sessions` (platform tables, no RLS) |
| `0002_tenancy` | `member_role` enum; `organizations`, `memberships`, `invites`, `audit_events`; `current_user_id()`; RLS policies; audit append-only |
| `0003_locations` | `location_status` enum; `locations`, `departments`, `job_roles`, `membership_locations`; same-org composite FKs; coordinate/radius CHECKs; RLS |
| `0004_employees` | `employee_status`, `notify_channel` enums; `employees`, `employee_job_roles`, `employee_locations`, `availability`, `time_off`; same-org FKs; CHECKs; RLS |
| `0005_scheduling` | `schedule_status` enum; `shift_templates`, `schedules`; same-org FKs (job role FK `ON DELETE SET NULL (job_role_id)`, hand-edited); Monday, break and time CHECKs; RLS |
| `0008_time_entries` | `attendance_method` enum; `time_entries` (both coordinates and the server's `in_distance_m`, `client_event_id` unique per org, one open punch per employee as a partial unique index, flags, `edited`); `geofence_policy` enum + `organizations.geofence_policy`; `shifts (org_id, id, location_id)` unique (FK target, hand-added); RLS |
| `0007_publications` | `outbox` (topic `entity.past_tense`, jsonb payload, `published_at` null = pending, partial index); `schedule_publications` (what each publish sent, affected employee ids); `schedules.published_version` + CHECK `published_version <= version`; RLS on both new tables |
| `0006_shifts` | `shift_status` enum; `shifts`; `schedules (org_id, id, location_id)` unique (FK target, hand-moved above the FK); 3-column FK to the schedule, employee `ON DELETE RESTRICT`, job role `SET NULL (job_role_id)`; **`EXCLUDE USING gist` against double-booking** (hand-written); CHECKs (positive range, break shorter than shift, status matches assignee, version); RLS |

```
users          (id, email citext unique, name, password_hash, email_verified_at, created_at, updated_at)
sessions       (id, user_id, family_id, token_hash unique, expires_at, revoked_at, replaced_by, user_agent, ip, created_at)
organizations  (id, name, geofence_policy flag|reject, created_at, updated_at)      RLS
memberships    (id, org_id, user_id, role owner|manager|employee|kiosk, …)        RLS, unique (org_id, user_id)
invites        (id, org_id, email citext, role, token_hash unique, invited_by,
                expires_at, accepted_at, accepted_by, revoked_at, created_at)    RLS, one open per (org, email)
audit_events   (id, org_id, actor_user_id, action, entity, entity_id, before, after, created_at)   RLS, append-only
locations      (id, org_id, name citext, address, latitude, longitude, radius_m 25–1000, timezone,
                status active|read_only, …)                                      RLS, unique (org_id, name)
departments    (id, org_id, location_id, name citext, …)                         RLS, unique (location_id, name)
job_roles      (id, org_id, name citext, …)                                      RLS, unique (org_id, name)
membership_locations (org_id, user_id, location_id, created_at)                  RLS, PK all three
employees      (id, org_id, user_id?, name, email citext?, phone?, hourly_rate_minor, currency,
                max_weekly_minutes?, min_rest_minutes?, notify_channel, status active|archived, …)
                                                                   RLS, unique (org_id, email), (org_id, user_id)
employee_job_roles (org_id, employee_id, job_role_id)                            RLS, PK all three
employee_locations (org_id, employee_id, location_id)                            RLS, PK all three
availability   (id, org_id, employee_id, weekday 1–7, start_local time, end_local time)   RLS
time_off       (id, org_id, employee_id, starts_at, ends_at, reason?, …)         RLS, ends_at > starts_at
shift_templates (id, org_id, location_id, name citext, start_time time, end_time time,
                break_minutes 0–240, job_role_id?, …)                RLS, unique (location_id, name), start ≠ end
schedules      (id, org_id, location_id, week_start date (Monday), status draft|published,
                version ≥ 1, published_version?, published_at?, published_by?, …)
                                       CHECK published_version IS NULL OR published_version <= version   RLS, unique (location_id, week_start),
                                                          unique (org_id, id, location_id)   ← FK target
time_entries   (id, org_id, employee_id, location_id, shift_id?, clock_in_at, clock_out_at?,
                method gps|qr|manual, in_latitude/longitude/accuracy_m/distance_m,
                out_* nullable, device_time, received_at, flags text[], edited,
                client_event_id)   RLS, unique (org_id, client_event_id),
                                   one open per (org_id, employee_id) ← partial unique index,
                                   FK (org_id, shift_id, location_id) → shifts, SET NULL (shift_id)
outbox         (id, org_id, topic (entity.past_tense, CHECK ^[a-z_]+\.[a-z_]+$), payload jsonb,
                created_at, published_at?)          RLS, partial index on pending rows
schedule_publications (id, org_id, schedule_id, version, shifts jsonb (what was sent),
                affected_employee_ids uuid[], published_by?, published_at)
                                            RLS, unique (schedule_id, version)
shifts         (id, org_id, schedule_id, location_id, job_role_id?, employee_id?,
                starts_at, ends_at timestamptz, break_minutes 0–240, status open|assigned|cancelled,
                version ≥ 1, notes?, …)                         RLS, FK (org_id, schedule_id, location_id),
                FK (org_id, employee_id), FK (org_id, job_role_id),
                CHECK ends_at > starts_at, break < elapsed, status matches assignee,
                EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
                  WHERE status = 'assigned'                     ← no double-booking, in the database
```

IDs are UUIDv7 generated in the app (`newId()` in `packages/db`).

### 10.2 Planned (by week)

| Week | Tables |
|---|---|
| W2 | ~~`shift_templates`, `schedules`~~ (0005), ~~`shifts`~~ (0006), ~~`outbox`, `schedule_publications`~~ (0007) |
| W3 | ~~`time_entries`~~ (0008) |
| W4 | ~~`notifications`, `deliveries`~~ (0012, 0013) — `message_usage` still to come (D4 quota) |
| W5 | `shift_requests` (swap/drop/pickup), `idempotency_keys` |
| W6 | `pay_rules` (versioned JSON), `pay_periods`, `timesheet_lines` |
| W7 | `coverage_requirements`; `audit_events` partitioned by month |
| W8 | `subscriptions`, `billing_profiles`, `invoices`, `invoice_lines`, `invoice_counters`, `coupons`, `coupon_redemptions`, `platform_admins` |
| Later | `credentials` (licence expiry), kiosk QR secrets on locations |

Full column lists: [ARCHITECTURE.md §6](ARCHITECTURE.md).

---

## 11. API

Base URL `http://localhost:4000/api/v1`. JSON; errors are `application/problem+json`.
Org-scoped routes need `Authorization: Bearer <token>` **and** `X-Org-Id: <org uuid>`.

### 11.1 Implemented

| Method + path | Auth | Who |
|---|---|---|
| `GET /health/live`, `GET /health/ready` | public | probes (ready = DB answers; 503 otherwise) |
| `POST /auth/signup` | public, rate-limited | anyone → 201 + access token + refresh cookie |
| `POST /auth/login` | public, rate-limited | anyone |
| `POST /auth/refresh` | refresh cookie, rate-limited | rotates the cookie |
| `POST /auth/logout` | refresh cookie | 204, idempotent |
| `GET /auth/me` | token | the caller |
| `POST /orgs` | token | create org; caller becomes owner |
| `GET /orgs` | token | my orgs with my role |
| `GET /org` | token + org | any member |
| `GET /members` | token + org | owner, manager |
| `PATCH /members/:userId` | token + org | owner (never demotes the last owner) |
| `DELETE /members/:userId` | token + org | owner: anyone · manager: employees · anyone: themselves |
| `POST /invites` | token + org | owner (any role), manager (employees only) |
| `GET /invites` | token + org | owner, manager |
| `DELETE /invites/:id` | token + org | owner, manager |
| `POST /invites/accept` | token | the invited email only |
| `GET /locations`, `GET /locations/:id` | token + org | any member (filtered by their location scope) |
| `POST /locations` | token + org | owner |
| `PATCH /locations/:id` | token + org | owner, manager in scope (`status` owner only; read-only locations accept only a status change) |
| `GET /locations/:locationId/departments` | token + org | any member in scope |
| `POST /locations/:locationId/departments`, `PATCH`/`DELETE /departments/:id` | token + org | owner, manager in scope |
| `GET /job-roles` | token + org | any member |
| `POST /job-roles`, `PATCH`/`DELETE /job-roles/:id` | token + org | owner, manager |
| `GET /members/:userId/locations` | token + org | owner, manager |
| `PUT /members/:userId/locations` | token + org | owner (empty list = all locations) |
| `GET /employees?locationId=&status=&limit=&cursor=` | token + org | owner, manager (in scope); cursor-paginated |
| `POST /employees`, `GET`/`PATCH /employees/:id` | token + org | owner, manager (in scope); archive with `status` |
| `GET`/`PUT /employees/:id/availability` | token + org | owner, manager (in scope); PUT replaces the week |
| `GET`/`POST /employees/:id/time-off`, `DELETE /time-off/:id` | token + org | owner, manager (in scope) |
| `GET /shift-templates?locationId=` | token + org | owner, manager (in scope); returns `paidMinutes` |
| `POST /shift-templates`, `PATCH`/`DELETE /shift-templates/:id` | token + org | owner, manager (in scope; location writable) |
| `GET /schedules?locationId=&weekStart=`, `GET /schedules/:id` | token + org | owner, manager (in scope); includes the week's UTC `startsAt`/`endsAt` |
| `POST /schedules` | token + org | owner, manager (in scope); draft; one per location and week (409) |
| `GET /shifts?scheduleId=` | token + org | owner, manager (in scope); one week's shifts in time order |
| `GET /shifts/:id` | token + org | owner, manager (in scope) |
| `POST /shifts` | token + org | owner, manager (in scope); `{ shift, warnings }`; overlap → 409; date outside the week → 400 |
| `PATCH /shifts/:id` | token + org | owner, manager (in scope); partial, `version` → 409 when stale; `{ shift, warnings }` |
| `DELETE /shifts/:id` | token + org | owner, manager (in scope); audited |
| `GET /schedules/:id/conflicts` | token + org | owner, manager (in scope); every advisory on the week's assigned shifts, keyed by shift id |
| `GET /schedules/:id/publish-preview` | token + org | owner, manager (in scope); the diff against the last publication + `hasChanges`, read-only |
| `GET /me` | token + org | any member; own staff profile + roles + locations, `profile: null` when not linked |
| `GET /me/shifts?from=&to=` | token + org | any member; own shifts in a local-date range, with location and role names |
| `GET /me/time-off` | token + org | any member; own time off, empty when not linked |
| `POST /clock-in` | token + org + `Idempotency-Key` | any member with a staff profile; geofence checked server-side → 201 `{ entry, created }`, 422 when the org rejects out-of-fence punches, 409 if a punch is already open |
| `POST /clock-out` | token + org | any member with a staff profile; closes the open punch → 200, 409 when nothing is open |
| `GET /me/time-entries` | token + org | any member; own punches in a local-date range, with location name and wall clock |
| `POST /schedules/:id/publish` | token + org | owner, manager (in scope), writable location; 200 with `{ schedule, publication }`; one `schedule.published` outbox row + one audit row in the same transaction |

Error codes in use: `validation_failed`, `not_found`, `rate_limited`, `internal_error`,
`auth.unauthenticated`, `auth.email_taken`, `auth.invalid_credentials`,
`auth.invalid_refresh_token`, `auth.forbidden`, `org.required`, `org.not_member`,
`org.member_not_found`, `org.last_owner`, `invite.invalid`, `invite.email_mismatch`,
`invite.already_member`, `conflict.name_taken`, `location.not_found`, `location.read_only`,
`location.owner_unrestricted`, `department.not_found`, `job_role.not_found`, `conflict.duplicate`,
`employee.not_found`, `employee.archived`, `time_off.not_found`, `shift_template.not_found`,
`schedule.not_found`, `shift.not_found`, `shift.overlap`, `shift.version_conflict`.

### 11.2 Conventions

REST under `/api/v1`; Zod schemas from `packages/shared` validate every body; cursor
pagination (`?cursor=&limit=`) for lists that can grow; `Idempotency-Key` header on writes
clients may retry (clock-in, claim, swap; from week 3); OpenAPI generation planned.

---

## 12. Testing

| Kind | Tool | Where | Today |
|---|---|---|---|
| Unit | Vitest | `*.test.ts` next to code | 219 |
| Integration (DB) | Vitest + Testcontainers | `packages/db/src/__tests__/*.int.test.ts` | 53 |
| Integration (API, full HTTP) | Vitest + Testcontainers + Fastify inject | `apps/api/src/**/__tests__/*.int.test.ts`, helper `src/testing/test-app.ts` | 151 |
| E2E | Playwright | `apps/web/e2e/*.spec.ts` (`pnpm test:e2e`) | 2 |
| Property | fast-check | planned for pay rules and scheduler | — |

Required per change: pure logic → unit tests; SQL/migrations → integration incl. cross-tenant
isolation; concurrency paths → "N parallel attempts → exactly one winner"; queues → idempotency
+ retry/DLQ; user flows → Playwright. A meta-test fails if any table with `org_id` lacks
forced RLS and a policy.

---

## 13. Rules and conventions

The complete list is in [AGENTS.md](AGENTS.md). The ones that matter most:

- TypeScript strict, no `any`, named exports only; relative imports end in `.js` (ESM).
- Nest module layout: `<module>.module/controller/service/repository.ts`, `__tests__/`.
- Tenant repositories use `RequestContext.tx` and filter by `this.context.orgId`.
- Every org route makes a role decision (`@Roles(...)` or deliberately any member) and has an
  isolation test. `@Public()` and `@WithoutOrg()` only where genuinely needed.
- Migrations are forward-only `NNNN_name.sql`, with RLS, indexes and grants in the same file;
  never edit a merged migration. drizzle-kit metadata is excluded from Prettier.
- Never log secrets, tokens, cookies, `Authorization` headers, full phone numbers or precise coordinates.
- Conventional Commits; new architectural decisions get an ADR in `docs/adr/`.
- UI: build from shadcn/ui components and the theme tokens; no one-off colours or spacing; every
  screen has loading (skeleton), empty and error states, works in dark mode and at phone width.
- Don't remove `minimumReleaseAge`; deny install scripts deliberately and say why.

---

## 14. Day-by-day plan

Part-time pace: ~6 sessions a week (weekday evenings ~2 h, Saturday ~5 h). **Sunday is buffer
and review**: update the changelog, write a build-in-public post, plan the next week.
If a day spills over, use Sunday; if a week spills over, cut scope (not tests).

Legend: ✅ done · ⏭ next · ☐ planned

### 14.1 UI and design system

Goal: a UI that looks and feels like a polished commercial product (think Linear, Vercel,
Notion), because the live demo is what recruiters and pilot clinics see first.

| Area | Choice |
|---|---|
| Components | **shadcn/ui** on Radix primitives: accessible, keyboard-friendly, copied into `apps/web/src/components/ui` so we own and can restyle them |
| Theme | CSS variables for colour, radius and shadow; teal brand primary on neutral greys; **light + dark mode** (system default, toggle in the user menu) |
| Typography | Inter Variable (self-hosted with @fontsource, no third-party font requests); clear type scale; tabular numbers for money and hours |
| Icons | lucide-react |
| Layout | Collapsible sidebar + top bar (org, location switcher, ⌘K, user menu) on desktop; bottom navigation and drawers (Vaul) on phones |
| Feedback | sonner toasts for success/errors; skeleton loaders instead of "Loading…"; friendly empty states with an icon and a primary action |
| Data | TanStack Table for lists (search, sort, column visibility, row actions) |
| Forms | shadcn Form + **react-hook-form** + the shared Zod schemas (from W2 D3); inline field errors |
| Motion | Motion (Framer Motion) for subtle transitions: page fades, list reorder, drag overlay; respects `prefers-reduced-motion` |
| Schedule board | dnd-kit; colour per job role; conflict badges; sticky day headers; today marker |
| Charts | shadcn Charts (Recharts) for labour cost and dashboards (W6–W7) |
| Quality bar | Lighthouse accessibility ≥ 95; works at 360 px width; visible focus rings; WCAG AA contrast in both themes |


### Week 1: Foundations (auth, tenancy, locations, employees)

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ✅ | pnpm + Turborepo monorepo; TS/ESLint/Prettier presets; Docker Compose (Postgres, Redis, Mailpit); GitHub Actions CI; PRD/ARCHITECTURE/AGENTS | CI green |
| D2 | ✅ | NestJS 12 API on Fastify; Zod-validated config; health checks; Drizzle + `pg`; `app_owner`/`app_user` roles; `0000_foundation` | `/health/ready` 200 against local DB; Testcontainers test green |
| D3 | ✅ | `users`, `sessions`; signup/login/refresh/logout/me; argon2id; JWT + rotating refresh with reuse detection; global auth guard; RFC 7807; Zod pipe; throttler; `packages/shared` | 5 parallel refreshes → exactly one 200 |
| D4 | ✅ | `organizations`, `memberships`, `invites`, `audit_events`; RLS policies; `TenancyInterceptor` + `RequestContext`; `@Roles`, `@WithoutOrg`; invite flow; last-owner protection; ADR 014 | Isolation, role and concurrency tests green |
| D5 | ✅ | `locations` (lat/lng, `radius_m` 25–1000, IANA `timezone`, `active`/`read_only`), `departments`, `job_roles`, `membership_locations`; same-org composite foreign keys; `LocationAccess` (scope rule); CRUD APIs + audit. Plan limit moved to W8 D2 (needs billing) | Scoped manager gets 404 for other locations; cross-org FK attack rejected by the DB |
| D6 | ✅ | `employees` (separate from users; optional link to a member), `employee_job_roles`, `employee_locations`, `availability` (weekly local times, overnight allowed, overlap check in `packages/domain`), `time_off`; employees API with cursor pagination and location scopes. **Web shell** (`apps/web`): Vite + React + React Router + TanStack Query + Tailwind; login/signup, org picker, location switcher, locations and employees pages; API client with `X-Org-Id` and single-flight refresh across tabs | Done in Chrome: signup → org → location → employee |
| **UI** | ✅ | **UI foundation** (see [§14.1](#141-ui-and-design-system)): init shadcn/ui; brand theme tokens (teal primary, neutral greys) in CSS variables with **dark mode**; Inter Variable font (self-hosted); lucide icons; new app shell (collapsible sidebar, top bar with org + location switcher, user menu, mobile drawer); sonner toasts; skeleton loaders; empty states with illustrations/icons; restyle login/signup (split-screen hero), org picker, locations and employees (TanStack Table data table with search, sort, row actions; add/edit in a Sheet); command palette (⌘K) for navigation | The four existing pages look production-grade in light and dark mode, on desktop and phone; Lighthouse accessibility ≥ 95 |

### Week 2: Schedule builder, shifts, publish

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ✅ | Time helpers in `packages/domain/time` (local wall-clock + zone → UTC, week boundaries per location, overnight shifts, DST gaps/overlaps); `shift_templates`, `schedules` (week, draft/published, version) | Tests for Europe/London, America/New_York and Asia/Kolkata incl. both DST transitions |
| D2 | ✅ | `shifts` (timestamptz range, open/assigned/cancelled, version) with **exclusion constraint** (no double-booking, across locations); shift CRUD API (local times in, instants out, `{ shift, warnings }`); conflict checks as pure functions in `packages/domain/src/scheduling`: overlap, availability, time off, max weekly hours, min rest | Double-booking rejected by the DB (integration test) and by the API with a friendly 409; 28 validation unit tests |
| D3 | ✅ | Week board UI with shadcn components (rows by employee; colour per job role; today marker; sticky header and team column; scheduled hours per day), shift create/edit/delete in a Sheet using **react-hook-form + Zod** (first complex form), week navigation (prev/next/today + shadcn Calendar that snaps to Monday) | Manager builds a week by hand; done in Chrome: start a week, add/edit/delete shifts, overlap refused with a clear message, warnings stay on screen, dark mode and 390 px checked, axe clean |
| D4 | ✅ | Drag-and-drop (dnd-kit) with a Motion drag overlay, optimistic moves with rollback, conflict warnings as badges + tooltips from `GET /schedules/:id/conflicts`, optimistic concurrency (`version` → 409 toast + refetch); keyboard drag and touch-hold included | Two managers editing: the stale one gets "Someone else changed this shift" and the week refetches (verified in Chrome, version bumped through the API) |
| D5 | ✅ | Publish flow (draft → published, diff of changed employees); `outbox` table + `schedule.published` event in the same transaction; `0007_publications` | Publishing writes exactly one outbox row; edits after publish produce a diff (11 integration tests; verified in Chrome) |
| D6 | ✅ | Socket.IO + Redis adapter, one room per org (ADR 016); Playwright E2E for the build-and-publish happy path | Second browser sees changes live (verified: an API write appeared on the open board without a reload) |

### Week 3: Attendance (geofenced clock-in, timesheets)

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ✅ | `/me` API for self-service reads; PWA (manifest, generated icons, service worker, offline shell); route-level `lazy()` splitting; staff app with bottom tabs, day-grouped shift cards and a Vaul drawer | Installable (Chrome: no installability errors), shell paints offline, axe 0 violations at 390×844; verified as a linked employee in Chrome |
| D2 | ✅ | `time_entries` (`0008`); clock-in/out API with server-side haversine geofence (`radius + min(accuracy, 100 m)`); `Idempotency-Key`; `organizations.geofence_policy`; `GET /me/time-entries` | Outside the fence → flagged by default, rejected when the org chooses; a retried punch is one row (20 integration tests incl. the two-simultaneous-punches race) |
| D3 | ✅ | Clock-in UI on the staff app (clock card): location requested on tap, permission / insecure-context / timeout / no-fix states each with a next step, a confirm step for a poor fix, flagged-punch notes, live elapsed time | Verified in Chrome at 390×844 with a placed device: inside the fence, 2 km away (flagged), ±400 m (confirm then flag), permission denied; axe 0 violations; 3 Playwright tests cover the same paths |
| D4 | ✅ | Match entries to shifts (nearest start within ±2 h, pure domain function); early/late tolerance as an org setting (`attendance_grace_minutes`, default 5); flags from the punch plus derived lateness on every read; Timesheets page per branch and week with worked-vs-rostered totals | Flags visible to managers: verified in Chrome (a 35-minute-late punch reads "35 min late"), axe 0 violations at 1440 and 390 px; 9 new integration tests (grace, early, unscheduled, out-of-scope manager) |
| D5 | ✅ | Manager corrections in the location’s wall clock (a clock-out before the clock-in reads as the next morning; over 16 h is refused as a typo), a required reason, before/after in the same audit row, `GET /time-entries/:id` returning the punch with its history, and the correction sheet that shows it | Edited entry shows before/after in audit: verified in Chrome (15:31 corrected to 14:55–19:30 reads "15:31–… → 14:55–19:30" with the reason beneath), 8 integration tests; pay-period totals stay with the pay-rules engine in W6 |
| D6 | ✅ | `pnpm db:seed` builds Sunrise Clinic — 2 branches, 4 logins, 3 staff, roles, availability, a published week and Monday's punches (one on time, one 22 minutes late, one 334 m outside the fence with a ±380 m fix) — in one transaction with the org context set, idempotent by deleting the demo org first. The buffer went to the flag review queue (`reviewed_at` + partial index, accept/dispute with a required reason) and a CSV export of the week with its worked-vs-rostered totals | Demo data in one command: `pnpm db:seed` then sign in as `priya@sunriseclinic.test` / `demo-clinic-2026`; verified through the API (org, 2 locations, punches with states, Bandra queue with 334 m) and in Chrome, 5 integration + 4 unit tests |

### Week 4: Notifications and reminders

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ✅ | `apps/worker` (plain Node, not a second Nest app) with BullMQ; the relay claims pending outbox rows in one transaction (`set_config` flag → `FOR UPDATE SKIP LOCKED` → enqueue → mark published), job id = outbox row id; `pnpm dev` runs it beside the API and web | Outbox rows become jobs exactly once: 20 pending rows became 20 jobs with matching ids and all 20 marked published, and a worker restart queued 0 more. 7 integration tests (claim, order/batch, rollback on enqueue failure, same job id after a rollback, three relays racing, tenant isolation) |
| D2 | ✅ | `notifications` + `deliveries` (migration `0012`, RLS, one row per person per notification per channel), the `schedule.published` fan-out in the worker (one personalised message per affected employee, not the whole rota), templates in `packages/domain/notifications` (plain text, WhatsApp- and SMS-safe), and channel routing: their preference, else email, with email/push as the safety net and never a silent WhatsApp | One notification → one delivery per channel: verified live (2 messages → 2 WhatsApp deliveries queued, addresses and statuses correct); 4 integration + 17 domain unit tests |
| D3 | ◑ | **Done:** SMTP email adapter (nodemailer → Mailpit on :1025), a second BullMQ queue for sends, `dispatchDelivery` (attempts counted before the call, status + reason recorded, throws to trigger backoff, never sends twice), and the **invite email**: `invites/${id}` writes `invite.created` to the outbox in the same transaction, the worker renders it and emails the invited address (a notification can now be addressed to an email, not only a staff row). **Remaining:** Web Push (VAPID + subscriptions) and password reset / email verification (one-time-token tables + endpoints) | Invite arrives in Mailpit with a working link — verified live (`You are invited to Sunrise Clinic on Shiftora` → `new.manager@…`, link `/invite/<org>.<code>`); 7 integration tests across send and invite |
| D4 | ☐ | WhatsApp (Meta Cloud API, approved utility templates) + SMS adapters; per-provider rate limits; retries with backoff + jitter; DLQ; quota counter with fallback to push/email | Failure injection → retry → DLQ, test green |
| D5 | ☐ | Delivery-status webhooks (signature-verified); repeatable jobs: shift reminders, missed clock-in detection; move throttler storage to Redis | Reminder sent 2 h before a shift |
| D6 | ☐ | End-to-end: publish → employees get WhatsApp/email; failure-injection tests | Publish in UI → message in Mailpit/WhatsApp sandbox |

### Week 5: Shift swaps and open-shift marketplace (concurrency)

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | `shift_requests` and its state machine (swap/drop/pickup) as a pure function | State machine unit tests |
| D2 | ☐ | Swap/drop APIs; colleague accepts; manager approves; re-validate on approval; lock both shifts in a stable order | Approve re-checks overlap/hours |
| D3 | ☐ | Open shifts: post, eligibility query (job role, location, hours, rest), notify eligible staff | Only eligible staff are notified |
| D4 | ☐ | Race-safe claim (conditional UPDATE + version) + `idempotency_keys` | N parallel claims → exactly one winner; retried request returns the same answer |
| D5 | ☐ | Employee UI for requests and open shifts; manager inbox | Full swap in the browser |
| D6 | ☐ | Buffer + blog draft: "How I stop two nurses taking the same shift" | Draft in `docs/blog/` |

### Week 6: Pay rules, overtime, payroll export

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | `pay_rules` (versioned JSON with effective dates, Zod-validated) | Rules round-trip through the API |
| D2 | ☐ | Pure `computePay(entries, rules, timezone)` → line items | Unit tests |
| D3 | ☐ | Overtime (daily/weekly, no double counting), night premium across midnight, break deduction, rounding; property tests (fast-check) | Paid minutes never exceed worked minutes, etc. |
| D4 | ☐ | Pay-period approval; payroll calculation as a worker job | Approve → lines computed |
| D5 | ☐ | CSV/XLSX export (exceljs, streamed) | 500-employee period exports without memory spikes |
| D6 | ☐ | Labour-cost projection for a schedule (basis for A6) | Draft schedule shows projected cost |

### Week 7: Auto-scheduler v1, audit UI, observability

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | `coverage_requirements` + UI; auto-scheduler input/output contracts in `packages/domain` | Contract types + fixtures |
| D2 | ☐ | Greedy assignment: hardest slots first; score = cost + fairness + preference + weekend/night balance | Fills a simple week |
| D3 | ☐ | Bounded backtracking (time budget ~2 s); explain unfilled slots; runs as a worker job with progress over Socket.IO | "No Nurse available Tue 22:00: 2 over max hours" style explanations |
| D4 | ☐ | Audit log UI for owners; monthly partitioning of `audit_events` | Owner filters history by entity |
| D5 | ☐ | OpenTelemetry (API + worker, trace through the queue), pino JSON logs with traceId/orgId, Grafana dashboards, Sentry | One trace spans publish → outbox → worker → provider |
| D6 | ☐ | Benchmark auto-scheduler (50 employees × 7 days); record numbers for the README | Numbers in README |

### Week 8: Launch

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | Production deploy (Docker; API + worker from one image; managed Postgres + Redis); create `app_owner`/`app_user` by hand; Fastify `trustProxy`; backups/PITR; TLS; nightly demo reset | Live URL, health green |
| D2 | ☐ | Razorpay subscriptions (Pro + location quantity), webhooks (signature + idempotent), `EntitlementService` (plan limits, quotas) | Upgrade/downgrade in sandbox |
| D3 | ☐ | GST invoices (gap-free numbering, CGST/SGST vs IGST, PDF + email); coupons + platform-admin page (2FA) | Invoice PDF matches the rules; coupon cap holds under parallel redemptions |
| D4 | ☐ | Landing page + pricing (₹999 + GST) + "Try as demo clinic" | Public site |
| D5 | ☐ | README as a case study (problem, architecture diagram, trade-offs, metrics); visit clinics; onboard first pilots with pilot coupons | First pilot onboarded |
| D6 | ☐ | Fix pilot feedback; changelog; launch posts (LinkedIn/X) | Launch posted |

---

## 15. After launch and future enhancements

**First weeks after launch:** free SEO tools (overtime calculator, rota template generator);
rotating QR + optional selfie (A3); credential expiry alerts (A5); offline clock-in (A7);
labour-cost forecast vs budget (A6); OR-Tools solver worker (A1 v2, only when the owner says
so); Product Hunt launch; second blog post (DST and overnight shifts).

**Future enhancements:** native React Native app (when pilots need reliable iOS push or
background location); paid WhatsApp top-ups; annual plans; SSO for larger customers.

---

## 16. Go-to-market and career deliverables

**Traffic:** free SEO tools; Free plan up to 10 employees; viral loop (every employee gets
the schedule via a WhatsApp link with a signup CTA); walk into 10 local clinics and convert
3–5 pilots; build in public on X/LinkedIn; Product Hunt and Indie Hackers.

**Career checklist:**
- [ ] Live demo with "Try as demo clinic"
- [ ] README as a case study with an architecture diagram, trade-offs and real metrics
- [ ] Blog: preventing double-booking / race-safe claims
- [ ] Blog: DST and overnight shifts
- [ ] 3 resume bullets with real numbers, high on the page
- [ ] A pilot testimonial
- [ ] Recent commits and a public changelog (keep it alive)

**Interview topics this project must answer:** the clock-in request path end to end; RLS vs a
`tenant_id` filter (and why we use both); two people accepting one shift; refresh-token reuse
detection; DST night shifts; a provider outage (outbox + retries + DLQ); auto-scheduler
complexity; what breaks at 5,000 employees; why not microservices; the worst production bug.

**Avoid:** inflated metrics, code you can't explain, buzzword over-engineering, a stale repo,
a carbon copy of a known product.

---

## 17. Risks

| Risk | Mitigation |
|---|---|
| Crowded market at the generic level | Stay niche: clinics, WhatsApp-first, flat pricing, credential tracking |
| WhatsApp/SMS cost | Pro-only, quotas, push/email fallback, push for reminders |
| Location data is personal data | Collect only at clock events, consent, documented retention |
| Slow small-business sales | In-person outreach and pilots first |
| Scope creep / burnout (part-time) | Weekly goals, Sunday buffer, advanced features only after the MVP piece exists |
| Project goes stale | Weekly commits, changelog, monthly build-in-public post |

---

## 18. Deferred items and known follow-ups

**Deferred by decision:** domain name and trademark check; GST registration, SAC code and
invoice format sign-off with a CA (values are config, not code).

**Known follow-ups (tracked here until done):**

| Item | When |
|---|---|
| ~~Web app must single-flight token refresh across tabs~~ Done in `apps/web/src/lib/api-client.ts` | ✅ W1 D6 |
| ~~Web API client must send `X-Org-Id`~~ Done | ✅ W1 D6 |
| Email verification, password reset, invite emails (codes are returned in the API response until then) | W4 D3 |
| Move rate-limit storage to Redis (multiple API instances) | W4 D5 |
| Enable Fastify `trustProxy` behind the load balancer (or every request shares one IP for rate limits) | W8 D1 |
| Audit log partitioning and owner UI | W7 D4 |
| `auth.int.test.ts` could reuse `src/testing/test-app.ts` | Any time |
| Web bundle is 1,093 kB / 339 kB gzip (one chunk, now including the schedule page, dnd-kit and Motion): split per route with React Router `lazy` | W3 D1 (PWA) |
| Employee search filters only the pages already loaded; add server-side `q` to `GET /employees` when lists get long (the board shows the first 100 of a location) | W3+ |
| ~~Browser E2E tests (Playwright)~~ Done: `pnpm test:e2e` builds a clinic through the API, then drives login → board → add shift → publish; extend to clock-in in W3 | ✅ W2 D6 |
| Domain time helpers use `Temporal`; check browser support (Safari) before the web calls them, else add `temporal-polyfill` (ask first) | W2 D3 |
| ~~Shift warnings are computed on write only~~ Done: `GET /schedules/:id/conflicts` feeds the board's badges | ✅ W2 D4 |

---

## 19. How to read the code

Read bottom-up, then follow requests (~3–4 hours):

1. **Security model in SQL:** `infra/postgres/init/01-roles.sql` → `packages/db/migrations/0000…0002`
   → `packages/db/src/__tests__/tenancy-rls.int.test.ts`.
2. **TypeScript mirror:** `packages/db/src/schema/*` → `client.ts` → `tenant-context.ts`.
3. **Pure layers:** `packages/domain/src/*`, `packages/shared/src/*`.
4. **Boot:** `apps/api/src/main.ts` → `app.module.ts` → `configure-app.ts` → `config/` → `common/`.
5. **Follow five requests:**
   - signup (`modules/auth`)
   - refresh (`sessions.repository.ts` `rotate()`)
   - `GET /members` (`modules/tenancy/tenancy.interceptor.ts` → `database/request-context.ts` → `modules/orgs`)
   - `POST /orgs` and `POST /invites/accept` (`enterOrg`)
   - `PATCH /members/:id` (`lockOwners()` + audit)
6. **Tests as the spec:** `apps/api/src/testing/test-app.ts`, then the `*.int.test.ts` files.
   Run one test alone with
   `pnpm --filter @shiftora/api exec vitest run --config vitest.int.config.ts -t "last owner"`.
