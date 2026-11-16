# Shiftora: project plan and full context

> One document with everything needed to understand, set up and continue the project:
> what we're building and why, every decision made so far, the tech stack, how the code is
> organised, what's done, and the day-by-day plan to launch.
>
> Last updated: 2026-11-16 (Week 5, Day 3 done) · Owner: Pratham (GitHub: Shinzo27)
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
| W4 D1 | ✅ `apps/worker` + BullMQ, the outbox relay (claim with `FOR UPDATE SKIP LOCKED`, enqueue, then mark published; job id = outbox id), the relay GUC + policies (`0011`, ADR 017), and `pnpm dev` running the worker beside the API and web | ✅ Done | `4725c4f` |
| W5 D3 | Open shifts: `GET /shifts/:id/candidates` (everyone at the location, eligible first, with reasons), `POST /shifts/:id/offer` (`shifts.offered_at`, `0019`; one `shift.offered` event naming only the eligible), `GET /me/open-shifts`; an approved drop offers the freed shift automatically, never back to the person who dropped it | ✅ Done | see `git log` |
| W5 D2 | Swap/drop API: staff ask (`/me/shift-requests`), the colleague accepts or declines, a manager approves or rejects (`/shift-requests`, scoped); approval locks both shifts in id order, re-checks them and the new assignees (blocking vs acknowledged advisories), reassigns via "open" and records what staff were told; every step messaged through the outbox; the minute scan expires undecided requests whose shift started | ✅ Done | see `git log` |
| W5 D1 | `shift_requests` (`0018`, RLS, one open request per shift on either side, swap ⇔ colleague, open ⇔ undecided) and the swap/drop/pickup state machine as pure functions; `assessAssignment` (blocking vs advisory) shared by approvals and open shifts | ✅ Done | see `git log` |
| W4 D6 | End to end: one `startPipeline` wiring for production and tests; an outbox → relay → fan-out → provider → report → fallback test on real Postgres + Redis with failure injection; a Playwright test that publishes in the browser and finds the email in Mailpit and the WhatsApp "Read"; the owner's Recent messages list (`GET /messages/recent`); a report that beats the send is retried, not lost | ✅ Done | see `git log` |
| W4 D5 | Signed WhatsApp delivery-report webhook (`X-Hub-Signature-256`) → `delivery.reported` → delivered/read/late-failure fallback; shift reminders (2 h before) and missed clock-ins (after the grace; employee + managers) from one BullMQ job scheduler, exactly once per shift (`shift_alerts`, `0017`); rate limits in Redis shared by every API instance | ✅ Done | see `git log` |
| W4 D4 | Fake WhatsApp/SMS provider with failure injection, provider errors classified (permanent / transient / 429), jittered backoff, dead letters + fallback down the ladder, `message_usage` quota (`0016`) with a race-safe reservation, owner Messages page with Replay (via the outbox) | ✅ Done | see `git log` |
| W2 → W8 | See [§14](#14-day-by-day-plan) | Planned | |

Numbers today: 21 migrations, 704 automated tests (334 unit, 370 integration against real
Postgres and Redis) plus 6 Playwright end-to-end tests, 90 API endpoints, a React web app on shadcn/ui
(login, orgs, locations, employees, the draggable week board with conflict badges, the publish
flow, live updates over a socket, forgot-password and email-confirmation pages, an installable
staff app for phones with per-device Web Push; light and dark; axe
clean on WCAG 2.1 A/AA; Chrome reports no installability errors).

### Handoff note (update at the end of every session)

> **2026-11-16 (second dev machine, Hermes) — W5 D4–D6 done: week 5 is finished.**
>
> - **D4 — the claim.** `POST /me/open-shifts/:id/claim` is a conditional UPDATE
>   (`status = 'open' AND employee_id IS NULL AND version = <read>`): three simultaneous claims →
>   exactly one 200 and two 409s, with the winner's id on the row. `idempotency_keys` (`0020`, RLS,
>   unique per org + route + key, request hash, stored response) reserves the key **before** the
>   work, so a retry returns the first answer byte for byte and never claims twice; the same key on
>   a different shift is `idempotency.key_reuse`. The claim audits before/after, writes one
>   `shift.claimed` event (managers only — the claimer pressed the button), and patches the
>   publication so reminders follow the new person. ADR 019 records the reasoning.
> - **D5 — the screens.** Staff: "Open shifts you can take" (claim with a key minted per tap, and a
>   plain "someone else took it" when the race is lost), "Your requests" (waiting on you / yours,
>   with withdraw and the manager's note), and the two asks in the shift drawer ("Ask a colleague",
>   "I cannot work this shift"). Manager: a **Requests** inbox at `/o/:orgId/requests` with
>   approve/reject, in the sidebar. Buttons come from the server's `actions`, so the UI cannot offer
>   a transition the state machine refuses.
> - **D6 — the writing.** ADR 019 and `docs/blog/how-i-stop-two-nurses-taking-the-same-shift.md`:
>   the naive read-then-write, why a lock and a queue are both wrong here, the actual statement, the
>   retry problem and where the idempotency row has to be written, and the parallel test.
> - **Verified in the browser end to end:** Asha claimed an offered shift (it left the open list and
>   appeared in her week), asked to give it up (request showed "Waiting on a manager"), Priya
>   approved it from the inbox (inbox emptied, shift left Asha's week). Also hit and confirmed the
>   rule that requests need a published week — the app shows the server's sentence rather than
>   hiding the button.
> - **Checks:** 334 unit + 370 integration (db 61, api 241, worker 68) + 6 E2E; lint, typecheck,
>   build green; 21 migrations; 90 endpoints.
> - **Next — W6:** pay rules, overtime and the payroll export (rates, premiums, overtime after N
>   hours, a CSV the accountant actually accepts). The API for requests is complete; W6 should not
>   need to revisit it.
> - **Watch out for:** a claim needs `Idempotency-Key` and must go through `IdempotencyService` —
>   calling `OpenShiftsService.claim` directly would work once and lie on every retry. `psql` as
>   `app_user` sees no tenant rows without `app.org_id`. The service worker only exists in a build,
>   so test push with `vite preview`.

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
| — | **WhatsApp/SMS: a fake provider first, Meta next** (owner's choice). The whole delivery pipeline (quota, retries, dead letters, fallback, replay) is built and tested against `FakeMessageSender`, which can fail permanently, transiently or with a 429 on demand; the Meta Cloud API adapter replaces it behind `MessageSender`. Provider errors are classified by the adapter (`SendError.kind`): permanent → fall back now, transient → retry with jittered exponential backoff (5 s → 30 min cap), 429 → pause the queue without spending an attempt. After the last attempt the delivery is **dead-lettered in the database** (`dead_lettered_at`) and falls back to the next free rung; paid channels are never a fallback. The quota (1,000 WhatsApp + 200 SMS per active location per Indian calendar month, until billing) is reserved with one conditional upsert before sending and released if the provider refuses. The dead-letter page and Replay are owner-only; Replay goes through the outbox like every other side effect | 2026-11-16 |
| — | **Open shifts are offered, not broadcast**: a manager (or an approved drop) offers an open shift; the API computes who could take it at that moment and names them in the `shift.offered` event, and the worker messages exactly those people. Availability does not exclude anyone (a preference); rest, weekly hours, time off, role, location and overlap do. The person who dropped a shift is never offered it back | 2026-11-16 |
| — | **An approved swap or drop is published on its own** (`recordToldChange` + a patched publication): the people involved were told by the request messages, so the schedule's published version moves with the change when there were no other drafts, and the latest publication carries the new assignee — reminders follow the new person and the next publish does not re-announce it | 2026-11-16 |
| — | **Only published shifts can be swapped or dropped** (in the latest publication, with the requester on it); a draft is the manager's to change directly. A swap needs a colleague with a login (they must accept); an owner with no staff profile cannot ask (403) | 2026-11-16 |
| — | **The UI offers only the moves the server allows**: `ShiftRequestView.actions` decides which buttons render, so a screen can never ask for a transition the state machine refuses | 2026-11-16 |
| — | **A claim's `Idempotency-Key` is generated per tap** (`crypto.randomUUID()` at click time), so a retry of that tap reuses it while a second tap is honestly a new request | 2026-11-16 |
| — | **Requests are for published weeks only**: an unpublished shift is still a draft a manager can edit directly, and the app shows the server's sentence (`shift_request.not_published`) rather than pre-hiding the button — the rule lives in one place | 2026-11-16 |
| — | **The manager inbox is a queue, not a history**: `scope=open` by default, because a decided request is answered elsewhere (the rota, the staff member's own list) and a growing table of old decisions is not a task | 2026-11-16 |
| — | **The claim is decided by the database, not by a lock** (W5 D4): `UPDATE shifts … WHERE id = … AND status = 'open' AND employee_id IS NULL AND version = <the version we read>`. Two claims both pass eligibility, both run it, and the second updates zero rows — it gets `shift.already_taken` rather than a queue or a lock | 2026-11-16 |
| — | **`idempotency_keys` is per organisation, per route, per key, with a hash of the request**: the row is reserved *before* the work, so a retry blocks on the unique index until the first answer exists and then returns it verbatim. The same key on a different shift is `idempotency.key_reuse` — a mistake worth naming, not a retry | 2026-11-16 |
| — | **A claim is not a request**: pickups are recorded already approved (the race is the approval), so a claim writes an audit row and a `shift.claimed` event rather than entering the request state machine | 2026-11-16 |
| — | **Only managers are told about a claim**: the person who took the shift is the person who pressed the button and is looking at the app; a notification to them would be noise dressed as service | 2026-11-16 |
| — | **A manager always approves a swap** (owner's decision): the colleague accepting moves it to `pending_manager`, never to `approved`. A drop goes straight to a manager; a pickup (open shift) is decided by the race-safe claim (D4), so it is recorded already approved. Any open request can be withdrawn by its requester, rejected by a manager or expire when the shift starts | 2026-11-16 |
| — | **Eligibility has two tiers** (`assessAssignment`): archived, not at the location, missing the job role or overlapping are **blocking**; time off, availability, weekly hours and rest are **advisories** a manager may overrule when approving (with an explicit acknowledgement). Open shifts are offered only to people with nothing but availability advisories | 2026-11-16 |
| — | **The worker's wiring is one function** (`startPipeline`): production and the end-to-end test start the same relay, consumers and scheduler, so a test of the pipeline is a test of what runs. A delivery report for a message id not stored yet fails its job and is retried (BullMQ backoff), because a fast provider can beat our own write | 2026-11-16 |
| — | **Delivery reports are verified in the API, applied in the worker** (ADR 019): the webhook checks Meta's HMAC over the raw bytes, keeps no phone number, writes one platform `delivery.reported` event and answers 200; the worker finds the delivery by provider message id (`app.provider_report`, `SELECT` on `deliveries`, one query) and applies a monotonic, idempotent rule. A failure reported after acceptance is a permanent failure: quota released (not billed), fallback down the ladder | 2026-11-16 |
| — | **Reminders and missed clock-ins are raised by a scan, sent by the normal pipeline**: a BullMQ job scheduler runs `scanShiftAlerts` every minute; `shift_alerts` (one row per shift and kind) makes each alert exactly once; only shifts in the latest publication *with the same person* count (staff are never reminded of a draft). Assumptions, owner may revise: reminder 2 h before; missed = after the org's grace, within 4 h of the start, no punch from 2 h before the start; employee via their ladder + owners and the location's managers by email | 2026-11-16 |
| — | **Rate limits counted in Redis when it is configured** (own `ThrottlerStorage`, no new dependency): one limit across API instances; while Redis is down, each instance falls back to its own memory instead of refusing logins | 2026-11-16 |
| — | **`/auth/refresh` is rate-limited per login, not per IP** (`RefreshThrottlerGuard`: tracker = the refresh token's session family; a missing or unknown cookie falls back to the IP). The web app refreshes on every page load, so a per-IP limit logged out staff sharing one office connection; per login, each person has their own 10/min and one login (even a stolen token used from many IPs) is still capped. Costs one indexed lookup per refresh | 2026-11-16 |
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
| — | **Account mail is platform mail** (ADR 018): `outbox.org_id` is nullable and the worker sends verify/reset emails straight through the mailer instead of creating `notifications`/`deliveries` rows — a person who cannot log in belongs to no tenant, and inventing a "system org" would special-case every tenant table | 2026-11-15 |
| — | One-time tokens are **hashed and single-use**, redeemed by a conditional `UPDATE … WHERE used_at IS NULL`, so two clicks on one link cannot both succeed; issuing a new link retires the previous one | 2026-11-15 |
| — | `POST /auth/password/forgot` answers **202 with an empty body** whether or not the address exists — the alternative is an endpoint that answers "who works here?" | 2026-11-15 |
| — | Push subscriptions are **per device, upserted on the endpoint**: a browser that changes hands moves its row rather than leaving messages going to the last person | 2026-11-15 |
| — | Push is one **delivery row per channel** and many devices: sent if at least one device took it, "no device has notifications on" is a *skip* (a retry would spin forever), and a 404/410 from the push service deletes the subscription | 2026-11-15 |
| — | The push toggle says **why** it cannot work (no service worker in dev, no VAPID keys, permission blocked) instead of failing at the click | 2026-11-15 |
| — | **A channel with no sender is a routing decision, not a failed delivery** (`sendableChannels(adapters)` → the policy `routeChannels` gets): a person who chose WhatsApp on a deployment without that provider falls to email, then push, instead of queueing a message that can only fail. Silence was never the fallback plan | 2026-11-15 |
| — | **"No provider" is permanent, so the row is `skipped`, not `retried`**: a missing WhatsApp/SMS sender or missing VAPID keys cannot be fixed by a second attempt, and five failed attempts hide "nobody was told" behind a queue that looks like it is trying. `retry` is reserved for provider failures the adapter says a retry could fix | 2026-11-15 |
| — | **Push is offered only to someone with a subscribed device**: the device count comes from `push_subscriptions` on every fan-out (one grouped query), because a preference is not a subscription — assuming `0` made the push rung unreachable even after W4 D3 shipped it | 2026-11-15 |
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

E2E needs Playwright's Chromium once: `pnpm --filter @shiftora/web exec playwright install chromium`.

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
| `REDIS_URL`, `SMTP_HOST`, `SMTP_PORT` | Queues, realtime, shared rate limits; email (Mailpit locally) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push; empty = push off |
| `WHATSAPP_PROVIDER`, `SMS_PROVIDER`, `FAKE_PROVIDER_FAILURE` | `none` \| `fake`; failure injection (`transient`, `permanent`, `rate_limited`, `undeliverable`) |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Verify Meta's webhook signature / registration; empty = webhook 404 |
| `FAKE_PROVIDER_REPORT_URL` | Where the fake WhatsApp provider posts signed delivery reports |
| `ALERT_SCAN_INTERVAL_MS` (60000) | Shift reminder / missed clock-in scan interval |

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
 → ThrottlerGuard (some routes) 10/min/IP on signup, login, password routes;
   RefreshThrottlerGuard 10/min per login (session family) on refresh, per IP if no known cookie
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

### 10.1 Implemented (migrations 0000–0019)

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
| `0009_attendance_grace` | `organizations.attendance_grace_minutes` (integer, default 5, CHECK 0–60); hand-written — drizzle-kit wanted to re-create two shift constraints |
| `0010_punch_flags` | partial index on unreviewed flagged punches, so the review queue stays a range scan |
| `0011_outbox_relay` | two `outbox`-only policies keyed on `current_setting('app.outbox_relay')` (SELECT + UPDATE), so the relay can cross tenants and nothing else can |
| `0012_notifications` | `notifications` + `deliveries` (RLS, one row per person per event, unique per channel); `notifications` reachable by email or by staff row |
| `0013_invite_email` | `notifications.employee_id` nullable + `recipient_email` + CHECK one is set + unique `(outbox_id, recipient_email)` (plain index: `ON CONFLICT` cannot infer a partial one) |
| `0014_platform_tokens` | `one_time_tokens` (hash, expiry, `used_at`, platform table); `outbox.org_id` nullable + `outbox_platform_insert` policy (ADR 018) |
| `0015_push_subscriptions` | `push_subscriptions` (endpoint unique, same-org FK to employees, RLS) |
| `0016_message_quota_and_dead_letters` | `message_usage` (org, month on the Asia/Kolkata calendar, paid channel → count; RLS) and `deliveries.dead_lettered_at` + `replays` with a partial index for the dead-letter list |
| `0019_open_shift_offers` | `shifts.offered_at` and a partial index `(org_id, location_id, starts_at) WHERE status = 'open' AND offered_at IS NOT NULL` for "open shifts I could take" |
| `0018_shift_requests` | `shift_requests` (type swap\|drop\|pickup, status, shift, requester, colleague, optional shift in return, note, responded/decided times, decider, decision note; partial unique indexes: one open request per shift and per shift-in-return; CHECKs: swap ⇔ colleague, not self, open ⇔ undecided; same-org FKs; RLS) |
| `0017_delivery_reports_and_shift_alerts` | `deliveries.provider_message_id` (unique per channel), `delivered_at`, `read_at`; `shift_alerts` (org, shift, `reminder`\|`missed_clock_in`; same-org FK, cascade; RLS); `SELECT` switches `app.alert_scan` on `organizations` and `app.provider_report` on `deliveries` (ADR 019) |
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
outbox         (id, org_id? null = platform event, topic (entity.past_tense,
                CHECK ^[a-z_]+\.[a-z_]+$), payload jsonb, created_at, published_at?)
                RLS, partial index on pending rows; relay policy (0011) + platform insert (0014)
notifications  (id, org_id, outbox_id, employee_id?, recipient_email?, kind, subject, body,
                payload jsonb, created_at)      RLS, one row per person per event,
                CHECK (employee_id is not null or recipient_email is not null),
                unique (outbox_id, employee_id), (outbox_id, recipient_email)
deliveries     (id, org_id, notification_id, channel email|whatsapp|sms|push, address?,
                status queued|sent|delivered|failed|skipped, attempts, last_error, sent_at,
                created_at)                    RLS, unique (notification_id, channel)
one_time_tokens (id, user_id, purpose verify_email|reset_password, token_hash unique,
                expires_at, used_at?, created_at)      platform table, no RLS, hash only
push_subscriptions (id, org_id, employee_id, endpoint unique, p256dh, auth, created_at)
                                        RLS, FK (org_id, employee_id) → employees
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
| W4 | ~~`notifications`, `deliveries`~~ (0012, 0013), ~~`message_usage`~~ (0016), ~~`shift_alerts`~~ (0017) |
| W5 | ~~`shift_requests`~~ (0018), `idempotency_keys` |
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
| `POST /auth/verify-email` | public, rate-limited | the token from the email → 204; 400 `auth.invalid_token` when unknown, expired or already used |
| `POST /auth/password/forgot` | public, rate-limited | anyone → always 202, whether or not the address exists |
| `POST /auth/password/reset` | public, rate-limited | the token + a new password → 204; ends every live session for that person |
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
| `GET /messages/dead-letters` | token + org | owner; deliveries that failed every retry, masked address, where the message went instead |
| `POST /messages/dead-letters/:id/replay` | token + org | owner; resets the row and writes `delivery.replay` to the outbox (409 unless dead-lettered) |
| `GET /messages/usage` | token + org | owner; this month's WhatsApp/SMS against the quota |
| `GET /messages/recent` | token + org | owner; the last 50 deliveries with how far each got (queued → read), addresses masked |
| `GET /webhooks/whatsapp` | public | Meta's registration handshake: echoes `hub.challenge` for the right `hub.verify_token` (403 otherwise, 404 when not configured) |
| `POST /webhooks/whatsapp` | public + `X-Hub-Signature-256` | delivery statuses → one `delivery.reported` platform event; 401 on a bad signature, 404 when `WHATSAPP_APP_SECRET` is unset |
| `GET /push/public-key` | public | the VAPID public key, `null` when Web Push is not configured |
| `POST /me/push-subscriptions` | token + org | any member with a staff profile; upsert by endpoint → 201 `{ subscribed: true }` |
| `DELETE /me/push-subscriptions` | token + org | any member; 204, removes only the caller's own row |
| `POST /clock-in` | token + org + `Idempotency-Key` | any member with a staff profile; geofence checked server-side → 201 `{ entry, created }`, 422 when the org rejects out-of-fence punches, 409 if a punch is already open |
| `POST /clock-out` | token + org | any member with a staff profile; closes the open punch → 200, 409 when nothing is open |
| `GET /me/time-entries` | token + org | any member; own punches in a local-date range, with location name and wall clock |
| `POST /me/shift-requests` | token + org | any member with a staff profile; swap (colleague, optional shift in return) or drop of their own published, future shift → 201; 409 `already_open` / `not_published` / `expired` |
| `GET /me/shift-requests` | token + org | any member; requests they made or were asked, with their `actions` |
| `POST /me/shift-requests/:id/accept` \| `decline` \| `cancel` | token + org | the named colleague (accept/decline) or the requester (cancel); 409 on a wrong state, 404 to anyone else |
| `GET /shift-requests?scope=open\|all` | token + org | owner, manager (scoped): the inbox |
| `GET /shift-requests/:id` | token + org | owner, manager (scoped) |
| `POST /shift-requests/:id/approve` | token + org | owner, manager (scoped, writable); `{ note?, acknowledgeWarnings? }`; 409 `not_eligible` (blocking) / `needs_acknowledgement` (advisories) / `invalid_transition` |
| `POST /shift-requests/:id/reject` | token + org | owner, manager (scoped); `{ note? }` |
| `GET /shifts/:id/candidates` | token + org | owner, manager (scoped): everyone at the location with `eligible` and the reasons; 409 `shift.not_open` |
| `POST /shifts/:id/offer` | token + org | owner, manager (scoped, writable): offers an open shift to the eligible staff → `{ offeredTo }` |
| `GET /me/open-shifts` | token + org | any member: offered open shifts they could take now (never one they dropped) |
| `POST /me/open-shifts/:id/claim` | token + org + `Idempotency-Key` | any member with a staff profile: takes an offered shift → 200 with the shift; 409 `shift.already_taken` when someone else's update landed first, 409 `shift.not_open` when it was never offered, 400 `idempotency.key_required` without the header |
| `POST /schedules/:id/publish` | token + org | owner, manager (in scope), writable location; 200 with `{ schedule, publication }`; one `schedule.published` outbox row + one audit row in the same transaction |

Error codes in use: `validation_failed`, `not_found`, `rate_limited`, `internal_error`,
`auth.unauthenticated`, `auth.email_taken`, `auth.invalid_credentials`,
`auth.invalid_refresh_token`, `auth.forbidden`, `org.required`, `org.not_member`,
`org.member_not_found`, `org.last_owner`, `invite.invalid`, `invite.email_mismatch`,
`invite.already_member`, `conflict.name_taken`, `location.not_found`, `location.read_only`,
`location.owner_unrestricted`, `department.not_found`, `job_role.not_found`, `conflict.duplicate`,
`employee.not_found`, `employee.archived`, `time_off.not_found`, `shift_template.not_found`,
`schedule.not_found`, `shift.not_found`, `shift.overlap`, `shift.version_conflict`,
`delivery.not_found`, `delivery.not_dead_lettered`, `webhook.bad_signature`,
`webhook.not_configured`, `shift_request.not_found`, `shift_request.invalid_transition`,
`shift_request.already_open`, `shift_request.not_published`, `shift_request.expired`,
`shift_request.not_eligible`, `shift_request.needs_acknowledgement`, `employee.profile_required`,
`shift.not_open`.

### 11.2 Conventions

REST under `/api/v1`; Zod schemas from `packages/shared` validate every body; cursor
pagination (`?cursor=&limit=`) for lists that can grow; `Idempotency-Key` header on writes
clients may retry (clock-in, claim, swap; from week 3); OpenAPI generation planned.

---

## 12. Testing

| Kind | Tool | Where | Today |
|---|---|---|---|
| Unit | Vitest | `*.test.ts` next to code | 272 |
| Integration (DB) | Vitest + Testcontainers | `packages/db/src/__tests__/*.int.test.ts` | 53 |
| Integration (API, full HTTP) | Vitest + Testcontainers + Fastify inject | `apps/api/src/**/__tests__/*.int.test.ts`, helper `src/testing/test-app.ts` | 187 |
| Integration (worker, real Postgres + queues) | Vitest + Testcontainers | `apps/worker/src/**/*.int.test.ts` | 29 |
| E2E | Playwright | `apps/web/e2e/*.spec.ts` (`pnpm test:e2e`) | 5 |
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

Legend: ✅ done · ⏳ partly done (the row says what is left) · ⏭ next · ☐ planned

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
| D3 | ✅ | **Email:** SMTP adapter (nodemailer → Mailpit :1025), a `deliveries` queue, `dispatchDelivery` (attempts counted before the call, status + reason recorded, throws to trigger backoff, never sends twice), the **invite email** (`invite.created` written in the same transaction as the invite). **Account mail:** `one_time_tokens` (`0014`, hash + expiry + `used_at`, platform table with no RLS), `POST /auth/verify-email`, `POST /auth/password/forgot` (always 202 — never reveals who exists), `POST /auth/password/reset` (new password, every live session revoked, link burned), signup mints a verification link, and `renderVerifyEmail`/`renderResetPassword` in `packages/domain/notifications`; platform events ride the outbox with `org_id IS NULL` (ADR 018). **Web Push:** `push_subscriptions` (`0015`, endpoint unique, same-org FK, RLS), `GET /push/public-key`, `POST`/`DELETE /me/push-subscriptions`, a `push` branch in `dispatchDelivery` (one delivery row per channel, many devices, gone subscriptions pruned on 404/410), `web-push` with VAPID loaded only when both keys exist, `public/push-handler.js` (push + notificationclick) imported into the generated service worker, and a per-device toggle on the staff profile | Email: invite and both account mails arrived in Mailpit with working links; verification 204 then 400 on replay; reset changed the password (old 401, new 200) and refused the used link. Push: a real Chrome subscription stored, FCM accepted the VAPID push (`201`, message id returned), the toggle flipped to "on". Tests: 6 account + 6 push (API), 7 push (worker), 5 templates (domain) — commit `5c5a244` |
| D4 | ✅ | **Done 2026-11-16 with a fake provider** (`WHATSAPP_PROVIDER`/`SMS_PROVIDER=fake`, `FAKE_PROVIDER_FAILURE` to inject outages): permanent/transient/429 errors, jittered backoff, dead letters with fallback, the `message_usage` quota and the owner's Messages page with Replay. The Meta adapter plugs into the same `MessageSender` later. **Landed early as a hotfix (2026-11-15):** the routing ladder — `sendableChannels` gates the policy given to `routeChannels`, a channel with no sender is `skipped` instead of retried, push reads real device counts, and a `MessageSender` contract (same shape as `Mailer`) exists for the providers. **Still to do:** WhatsApp (Meta Cloud API, approved utility templates) + SMS senders behind that contract; per-provider rate limits; retries with backoff + jitter; DLQ; `message_usage` quota with fallback to push/email | Failure injection → retry → DLQ, test green |
| D5 | ✅ | Delivery-status webhooks (signature-verified); repeatable jobs: shift reminders, missed clock-in detection; move throttler storage to Redis. **Done 2026-11-16:** `POST`/`GET /webhooks/whatsapp`, `delivery.reported` → `applyDeliveryReports` (forward-only, late failure → fallback + quota back), fake provider posting signed reports; `alerts` job scheduler → `scanShiftAlerts` → `shift_alerts` + outbox (`0017`, ADR 019) → reminder / missed clock-in handlers (employee + location managers); `RedisThrottlerStorage` | Reminder sent 2 h before a shift: verified live ("Shift in 1 hour 29 minutes" over the fake WhatsApp, delivered + read by webhook); 9 alert + 8 report (worker), 6 webhook + 3 shared-rate-limit (API), 22 unit tests |
| D6 | ✅ | End-to-end: publish → employees get WhatsApp/email; failure-injection tests. **Done 2026-11-16:** `startPipeline` shared by `main.ts` and `pipeline.int.test.ts` (5 scenarios on real Postgres + Redis), `e2e/messages.spec.ts`, `GET /messages/recent` + Recent messages table, early-report retry | Publish in UI → message in Mailpit/WhatsApp sandbox |

### Week 5: Shift swaps and open-shift marketplace (concurrency)

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ✅ | `shift_requests` and its state machine (swap/drop/pickup) as a pure function. **Done 2026-11-16:** `packages/domain/requests/shift-request.ts` (`transition`, `availableActions`, `initialStatus`), `scheduling/eligibility.ts` (`assessAssignment`, `canTakeOpenShift`, `needsAcknowledgement`), migration `0018` | 21 unit tests (an exhaustive state × action × actor sweep: approval only from `pending_manager` by a manager; decided requests refuse everything) + 8 database tests |
| D2 | ✅ | Swap/drop APIs; colleague accepts; manager approves; re-validate on approval; lock both shifts in a stable order. **Done 2026-11-16:** 8 endpoints, `ShiftsService.assessMany`, `lockForUpdate` (id order), `recordToldChange` + patched publication, `handleShiftRequestEvent` (colleague / managers / affected people), expiry in the minute scan | Approve re-checks overlap/hours: 19 API tests (overlap and location refused, rest needs acknowledgement, a moved shift refused, two managers approving at once → one 200 + one 409 and one audit row, an overlapping exchange works), 6 worker tests, 4 template tests; mutation checks on the exchange ordering and the re-check |
| D3 | ✅ | Open shifts: post, eligibility query (job role, location, hours, rest), notify eligible staff. **Done 2026-11-16:** `OpenShiftsService` (`candidates`, `offer`/`offerShift`, `mine`) on the shared `assessMany` + `canTakeOpenShift`, migration `0019` (`offered_at` + partial index), `handleShiftOffered` in the worker | Only eligible staff are notified: 5 API tests (of five people only the free nurse at the branch is offered it and sees it; a drop's freed shift goes to the others, not the dropper), 2 worker tests, 1 template test; mutation check: offering to everyone at the location turns the test red |
| D4 | ✅ | Race-safe claim (conditional UPDATE + version) + `idempotency_keys`. **Done 2026-11-16:** `POST /me/open-shifts/:id/claim` (`ShiftsRepository.claim` updates only while `status = open`, `employee_id is null` **and** `version` is the one it read), `idempotency_keys` (`0020`, RLS, unique per org + route + key, request hash, stored response), `IdempotencyService` (reserve → run → store; the reservation is the lock, the unique index is the serialization point), audit `shift.claimed` + `shift.claimed` event (managers only — the claimer pressed the button), `recordToldChange` so reminders follow the new person, realtime hint | Three claims at the same instant → exactly one 200 and two 409s with the winner on the row; a retry with the same key returns the first answer byte for byte and claims once; the same key on a different shift is refused (`idempotency.key_reuse`); 8 integration tests |
| D5 | ✅ | **Done 2026-11-16:** staff app gains "Open shifts you can take" (claim, with a per-tap `Idempotency-Key` and a plain "someone else took it" when the race is lost) and "Your requests" (what I asked for, what is waiting on my answer, withdraw), plus "Ask a colleague to take it" / "I cannot work this shift" in the shift drawer; manager gains a **Requests** inbox (`/o/:orgId/requests`) with approve/reject, wired into the sidebar for managers. Buttons come from the server's `actions`, so the UI cannot offer a move the state machine would refuse | Full loop in the browser: Asha claimed an offered shift (it left the open list and appeared in her week), asked to give it up (request showed "Waiting on a manager"), Priya approved it from the inbox (inbox emptied, the shift left Asha's week and returned to open) |
| D6 | ✅ | **Done 2026-11-16:** ADR 019 (why a conditional update beats a lock or a queue, and why the idempotency row must be written before the work) and the blog draft `docs/blog/how-i-stop-two-nurses-taking-the-same-shift.md` — the naive read-then-write, the three fixes that do not work, the real statement, the retry problem, and the parallel test that makes the whole thing credible | Draft in `docs/blog/`; week 5 is finished (D1–D6) |

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
| ~~Move rate-limit storage to Redis (multiple API instances)~~ Done: `RedisThrottlerStorage` | ✅ W4 D5 |
| Enable Fastify `trustProxy` behind the load balancer (or every request shares one IP for rate limits) | W8 D1 |
| Audit log partitioning and owner UI | W7 D4 |
| `auth.int.test.ts` could reuse `src/testing/test-app.ts` | Any time |
| Web bundle is 1,093 kB / 339 kB gzip (one chunk, now including the schedule page, dnd-kit and Motion): split per route with React Router `lazy` | W3 D1 (PWA) |
| Employee search filters only the pages already loaded; add server-side `q` to `GET /employees` when lists get long (the board shows the first 100 of a location) | W3+ |
| ~~Browser E2E tests (Playwright)~~ Done: `pnpm test:e2e` builds a clinic through the API, then drives login → board → add shift → publish; extend to clock-in in W3 | ✅ W2 D6 |
| Domain time helpers use `Temporal`; check browser support (Safari) before the web calls them, else add `temporal-polyfill` (ask first) | W2 D3 |
| ~~Shift warnings are computed on write only~~ Done: `GET /schedules/:id/conflicts` feeds the board's badges | ✅ W2 D4 |
| Meta WhatsApp Cloud API adapter behind `MessageSender` (approved utility templates; the signed webhook is done in D5); pick and add the real SMS provider and its delivery reports | Before pilots |
| Reminder lead (2 h) and missed clock-in rules are constants; make them per-org settings if clinics ask | W8 polish |
| A separate `app_worker` role, so the three cross-tenant switches (ADR 017/019) become grants | Before production |
| ~~Messages page: the usage meter lags one refresh after Replay~~ Done: the page polls while a message is in flight | ✅ W4 D6 |
| Replaying a dead letter whose fallback email was already sent sends the message twice (by design: the owner asked); say so in the confirm, or offer "replay" only when there was no fallback | W8 polish |
| Plan entitlements: today every active location counts as paid and Free orgs can use WhatsApp; `EntitlementService` decides from the subscription | W8 D2 |
| ~~Auth throttle on `/auth/refresh` was per IP, so staff behind one office connection logged each other out~~ Done: refresh is limited per login (session family); no/unknown cookie still per IP | ✅ 2026-11-16 |
| Week board header is sticky only within its own (horizontal) scroll box; make it stick while the page scrolls (vertical scroll container with a max height) | W5+ |

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
