# Architecture: Shiftora

> Status: Draft v0.2 · Last updated: 2026-11-03 · Companion to `PRD.md`

---

## 1. Principles

1. **Modular monolith.** One codebase, one database, clear module boundaries. Two process
   types (API and worker) from the same code. No microservices at this scale: a team of one,
   < 10k employees, and cross-module transactions (shift + audit + outbox) are much simpler
   in one Postgres. Modules talk through service interfaces and domain events, so any one of
   them could be extracted later if load demands it.
2. **Tenant isolation in the database**, not just in application code (Postgres RLS).
3. **UTC everywhere + an IANA zone per location.** Never store local wall-clock times as instants.
4. **Business rules as pure functions** (validation, pay rules, scheduling) → easy to unit
   and property test, reused by API, worker and frontend.
5. **Reliable side effects:** transactional outbox → queue → idempotent workers.
6. **Boring, explainable tech.** Every piece must be defensible in an interview.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | Existing expertise; shared types front to back |
| Monorepo | pnpm workspaces + Turborepo | Shared packages, cached builds |
| API | **NestJS** on the Fastify adapter | Module system maps to the modular monolith; DI, guards, interceptors; Fastify for speed |
| Validation / contracts | Zod (shared schemas in `packages/shared`) | One source of truth for API and UI |
| Database | PostgreSQL 16 | RLS, `tstzrange` + exclusion constraints, JSONB, `SELECT … FOR UPDATE` |
| ORM / SQL | Drizzle ORM + raw SQL migrations | Close to SQL; RLS policies and triggers live in migrations |
| Queue | BullMQ on Redis 7 | Retries, backoff, delayed + repeatable jobs, rate limiting |
| Realtime | Socket.IO + Redis adapter | Live schedule board across API instances |
| Web app | React 18 + Vite + TanStack Query + React Router | Fast dev loop; server-state caching |
| UI | Tailwind CSS + **shadcn/ui** (Radix) with a themed design system and dark mode; lucide icons, sonner toasts, cmdk, TanStack Table, Vaul, Motion; dnd-kit for drag-and-drop; react-hook-form for complex forms | Accessible primitives we own and can restyle; attractive, consistent UI; robust DnD |
| Mobile | **PWA** (vite-plugin-pwa / Workbox), IndexedDB for offline queue | No app-store friction; WhatsApp link opens straight into it |
| Dates | Native `Temporal` (Node 26) in `packages/domain/time` | IANA zone math and DST handling with no dependency; plain values in and out |
| Auth | JWT access (15 min, `jose`, HS256) + rotating refresh tokens with reuse detection (httpOnly cookie, stored as SHA-256), argon2id (`@node-rs/argon2`) | Standard, explainable |
| Rate limiting | `@nestjs/throttler` with our own Redis storage (`RedisThrottlerStorage`, one Lua script per hit) when `REDIS_URL` is set, so every API instance shares one limit; in memory without Redis or while it is down | Throttled requests go through Nest's exception filter, so 429s use the same error format |
| Email | Resend or AWS SES | Cheap, good deliverability |
| WhatsApp / SMS | **Meta WhatsApp Cloud API** (direct, decided); SMS via Twilio/MSG91 | WhatsApp-first positioning; no BSP markup |
| Billing | **Razorpay Subscriptions** (INR) behind a `BillingProvider` interface; own GST invoice PDFs (pdfkit or react-pdf) | INR, UPI AutoPay; coupons and GST invoices stay under our control |
| Push | Web Push (VAPID) | Free channel for free tier |
| Exports | exceljs (streamed XLSX), csv-stringify | Payroll export |
| Auto-scheduler v2 (optional) | Python + Google OR-Tools CP-SAT, consumed as a BullMQ job | Proper solver once the heuristic hits limits |
| Observability | OpenTelemetry SDK → Grafana (Tempo/Loki/Prometheus); pino JSON logs; Sentry for errors | Traces across API → queue → worker |
| Testing | Vitest (unit), Testcontainers Postgres (integration), Playwright (E2E), fast-check (property tests) | |
| Deploy | Docker images; Fly.io/Render/Railway for API + worker; managed Postgres (Neon/Supabase/RDS) and Redis (Upstash) | Low ops for a solo dev |
| CI | GitHub Actions: lint, typecheck, test, build, migrate | |

## 3. System overview

```
┌──────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
│ Web app (React)      │   │ Employee PWA         │   │ Kiosk tablet (PWA)  │
│ managers / owners    │   │ clock-in, swaps      │   │ rotating QR         │
└──────────┬───────────┘   └──────────┬───────────┘   └──────────┬──────────┘
           │ HTTPS (REST/JSON) + WebSocket (Socket.IO)             │
           ▼                                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ API process (NestJS + Fastify)                                           │
│  auth · tenancy · org · employees · scheduling · attendance · requests   │
│  pay · notifications · audit · realtime gateway                          │
│  every request: BEGIN; SET LOCAL app.org_id / app.user_id; …; COMMIT     │
└───────┬─────────────────────────────┬────────────────────────────────────┘
        │ SQL (RLS enforced)          │ pub/sub (Socket.IO Redis adapter)
        ▼                             ▼
┌───────────────────┐        ┌─────────────────┐
│ PostgreSQL        │        │ Redis           │
│ tenant data, RLS  │        │ BullMQ queues,  │
│ outbox, audit     │        │ pub/sub, cache  │
└───────┬───────────┘        └───────┬─────────┘
        │ outbox relay               │ jobs
        ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Worker process (same codebase)                                           │
│  outbox-relay · notifications · auto-scheduler · payroll-calc · cron     │
│  (reminders, no-show detection, credential expiry, partition upkeep)     │
└───────┬───────────────────────────────┬──────────────────────────────────┘
        ▼                               ▼
  Email / WhatsApp / SMS / Push   Optional: Python OR-Tools solver worker
  providers (+ delivery webhooks) (consumes `solve` jobs)
```

## 4. Repository layout

```
.
├── apps/
│   ├── api/              # NestJS app (HTTP + WebSocket)
│   │   └── src/modules/  # auth, tenancy, orgs, employees, locations, job-roles,
│   │                     # scheduling (shifts, publications), outbox, realtime, audit
│   ├── worker/           # BullMQ processors + cron (imports domain modules)
│   ├── web/              # React app: manager dashboard + employee PWA + kiosk route
│   │                     # (e2e/ = Playwright specs, playwright.config.ts)
│   └── solver/           # (later) Python OR-Tools worker
├── packages/
│   ├── db/               # Drizzle schema, SQL migrations (incl. RLS), seed scripts
│   ├── domain/           # pure business logic: validation, pay rules, scheduler, time utils
│   ├── shared/           # Zod schemas, API types, constants
│   └── config/           # eslint, tsconfig, prettier presets
├── infra/                # docker-compose, Dockerfiles, Grafana dashboards
├── docs/                 # ADRs, blog drafts, diagrams
├── PRD.md · ARCHITECTURE.md · AGENTS.md
```

## 5. Module boundaries

| Module | Owns | Publishes events |
|---|---|---|
| `auth` | users, sessions (refresh tokens), default-deny `JwtAuthGuard`, `@Public()` | — |
| `tenancy` | `TenancyInterceptor`: one transaction per request, RLS session vars, membership + `@Roles` check; `RequestContext` | — |
| `audit` | `AuditService.record()` into `audit_events`, same transaction as the change | — |
| `invites` | invite codes, accept flow | — |
| `org` | organizations, locations, departments, roles, memberships, manager location scopes | `location.created` |
| `billing` | plans, subscriptions, entitlements (employee/location limits, message quotas), coupons, GST invoices, Razorpay webhooks | `subscription.changed`, `payment.captured`, `invoice.issued` |
| `platform-admin` | internal Shiftora staff console: coupons, subscription overview (no tenant business data in v1) | — |
| `employees` | employee profiles, roles/skills, availability, credentials; `GET /me` and `GET /me/time-off` for every member | `credential.expiring` |
| `scheduling` | schedules, shifts, publications, templates, coverage, auto-scheduler orchestration; `GET /me/shifts` for every member | `schedule.published` (outbox) |
| `attendance` | time entries (geofenced clock-in/out, idempotent by `Idempotency-Key`), kiosk QR secrets, offline sync, fraud flags | `clock.in`, `clock.out`, `attendance.flagged` (planned) |
| `requests` | swap/drop/pickup requests, open-shift claims | `request.created`, `request.approved`, `open_shift.claimed` |
| `pay` | pay rules (versioned), pay periods, timesheets, exports | `pay_period.approved` |
| `notifications` | outbox events → one message per person, channel routing by preference, `deliveries` + dispatch (email live; WhatsApp/SMS/push pending), in the worker | `invite.created` (outbox) |
| `audit` | append-only audit events | — |
| `realtime` | Socket.IO gateway (auth via the access token + RLS membership read), one room per `org`, `schedule.changed` events; inert when no ws adapter is installed (tests) | — |

Rule: a module may read another module only through its exported service; never import
another module's tables directly in queries.

## 6. Data model

All tenant tables have `org_id uuid not null` and an RLS policy. Primary keys are UUIDv7
(time-ordered, index-friendly).

```
organizations(id, name, created_at, updated_at)
-- platform tables (no org_id, no RLS: a person can belong to several orgs)
users(id, email citext unique, name, password_hash, email_verified_at, created_at, updated_at)
sessions(id, user_id, family_id, token_hash unique, expires_at, revoked_at, replaced_by,
         user_agent, ip, created_at)               -- one row per refresh token (§7.11)
memberships(id, org_id, user_id, role: owner|manager|employee|kiosk, created_at, updated_at)
                                                   -- unique (org_id, user_id)
invites(id, org_id, email citext, role, token_hash unique, invited_by, expires_at,
        accepted_at, accepted_by, revoked_at, created_at)  -- one open invite per (org, email)
membership_locations(org_id, user_id, location_id)   -- restricts a non-owner to these locations;
                                                      -- no rows = all locations; owners always all
subscriptions(org_id, plan: free|pro, extra_locations int, status: active|past_due|cancelled,
              provider, provider_sub_id, provider_plan_id, current_period_end, grace_until,
              coupon_redemption_id?)
billing_profiles(org_id, legal_name, gstin?, state_code, address, billing_email)
invoices(id, org_id, number unique, financial_year, issued_at, subtotal_minor, discount_minor,
         taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor, place_of_supply,
         provider_payment_id unique, pdf_key)
invoice_lines(id, org_id, invoice_id, description, quantity, unit_minor, amount_minor)
message_usage(org_id, month, channel, sent_count)          -- quota counters
-- platform tables (no org_id, no RLS; only reachable via platform-admin role):
platform_admins(user_id, created_at)
coupons(id, code unique (case-insensitive), discount_type: percent|fixed, percent_off?,
        amount_off_minor?, applies_to: base|locations|both, duration: once|repeating|forever,
        duration_months?, valid_from, valid_to?, max_redemptions?, redeemed_count,
        first_time_only bool, status: active|paused, created_by, created_at)
coupon_redemptions(id, coupon_id, org_id, redeemed_at, months_remaining?,
                   unique(coupon_id, org_id))
locations(id, org_id, name citext, address, latitude, longitude, radius_m 25–1000, timezone,
          status: active|read_only, …)     -- later: qr_secret_enc, budget_weekly_minor
departments(id, org_id, location_id, name citext)   -- FK (org_id, location_id) → locations (org_id, id)
job_roles(id, org_id, name, requires_credential_type?)      -- Nurse, Receptionist… (what someone IS;
                                                           -- not member_role, which is what they may DO)
employees(id, org_id, user_id?, name, phone, hourly_rate_minor, currency,
          max_weekly_minutes, min_rest_minutes, notify_channel, active)
employee_job_roles(org_id, employee_id, job_role_id)
employee_locations(org_id, employee_id, location_id)   -- (is_primary dropped until clock-in needs it)
availability(id, org_id, employee_id, weekday, start_local, end_local)     -- recurring, local time
time_off(id, org_id, employee_id, starts_at, ends_at, reason)              -- UTC instants
credentials(id, org_id, employee_id, type, number, expires_on)

shift_templates(id, org_id, location_id, job_role_id, name, start_local, end_local, days_mask)
coverage_requirements(id, org_id, location_id, job_role_id, weekday, start_local, end_local, count)
schedules(id, org_id, location_id, week_start_date, status: draft|published,
          version, published_version?, published_at?, published_by?)
  -- CHECK published_version IS NULL OR published_version <= version
  --   version > published_version ⇒ the board has edits staff were not told about (0007)
schedule_publications(id, org_id, schedule_id, version, shifts jsonb, affected_employee_ids uuid[],
                      published_by?, published_at)   -- what each publish actually sent (0007)
  -- unique (schedule_id, version); never updated, only inserted
shifts(id, org_id, schedule_id, location_id, job_role_id?, employee_id?,
       starts_at timestamptz, ends_at timestamptz, break_minutes 0–240,
       status: open|assigned|cancelled, version int, notes)
  -- FK (org_id, schedule_id, location_id) → schedules (org_id, id, location_id):
  --   a shift is always in its schedule's week AND location
  -- FK (org_id, employee_id) → employees (org_id, id) ON DELETE RESTRICT (archived, not deleted)
  -- CHECK ends_at > starts_at, break shorter than the range, status matches the assignee
  -- EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  --   WHERE status = 'assigned'   → DB-level guarantee: no double-booking (migration 0006)

shift_requests(id, org_id, type: swap|drop|pickup, shift_id, requester_id,
               target_employee_id?, target_shift_id?, status, decided_by, decided_at)
idempotency_keys(org_id, key, endpoint, response_hash, created_at)

time_entries(id, org_id, employee_id, shift_id?, location_id,
             clock_in_at, clock_out_at, method: gps|qr|manual,
             in_geo point?, out_geo point?, accuracy_m, client_event_id unique,
             device_time, received_at, flags text[], edited boolean)
pay_rules(id, org_id, location_id?, effective_from, effective_to?, rules jsonb, version)
pay_periods(id, org_id, starts_on, ends_on, status: open|approved|exported)
timesheet_lines(id, org_id, pay_period_id, employee_id, date, kind, minutes, rate_minor, amount_minor)

time_entries(id, org_id, employee_id, location_id, shift_id?, clock_in_at, clock_out_at?,
             method: gps|qr|manual, in_* / out_* (coords, accuracy, distance), device_time,
             received_at, flags text[], edited, client_event_id)
  -- unique (org_id, client_event_id)                       → a retried punch is the same punch
  -- unique (org_id, employee_id) where clock_out_at is null → one open punch per person
  -- FK (org_id, shift_id, location_id) → shifts, ON DELETE SET NULL (shift_id)   (0008)

outbox(id, org_id, topic: 'entity.past_tense', payload jsonb, created_at, published_at?)
  -- CHECK topic ~ '^[a-z_]+\.[a-z_]+$'; partial index on pending rows (published_at IS NULL)
  -- written inside the request's transaction; the worker relays it (0011 adds the relay policy)
notifications(id, org_id, outbox_id, employee_id?, recipient_email?, kind, subject, body,
              payload jsonb, created_at)
  -- one row per person per event; unique (outbox_id, employee_id) and (outbox_id, recipient_email)
  -- CHECK employee_id is not null or recipient_email is not null  (an invite has no staff row)
deliveries(id, org_id, notification_id, channel: email|whatsapp|sms|push,
           address?, status: queued|sent|delivered|failed|skipped, attempts,
           last_error, sent_at, created_at)
  -- unique (notification_id, channel): one row per channel per message
  -- written by the fan-out, sent by the deliveries queue; the row, not the job, is the truth
audit_events(id, org_id, actor_user_id, action, entity, entity_id,
             before jsonb, after jsonb, ip, at)             -- append-only, partitioned by month
```

Money is stored as integer minor units (`*_minor`) with a currency code; durations as minutes.

## 7. Key design decisions and how they work

### 7.1 Multi-tenancy with Postgres RLS
- App connects as role `app_user` (no `BYPASSRLS`, not table owner). Migrations run as `app_owner`.
  Locally both roles come from `infra/postgres/init/01-roles.sql`; in production they are
  created once by hand. `0000_foundation` grants `app_user` default table privileges and
  defines `current_org_id()`, which returns NULL when no tenant is set, so policies fail closed.
- Every tenant table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
  policy `tenant_isolation USING (org_id = current_org_id()) WITH CHECK (same)`
  (`0002_tenancy`). Two extra read-only policies let a user see **their own** memberships
  and the orgs they belong to with no org selected (`users_read_own_memberships`,
  `members_read_own_orgs`, via `current_user_id()`), so "list my orgs" works without a bypass.
- Policies on one table are OR-ed. With org A selected, `select * from memberships` also
  returns *your* memberships in other orgs. So repositories **always filter by org_id
  explicitly**; RLS is the safety net behind that filter, not a replacement for it.
- **Request flow** (`apps/api/src/modules/tenancy/tenancy.interceptor.ts`): after
  `JwtAuthGuard` identifies the user, `TenancyInterceptor` reads `X-Org-Id`, opens one
  transaction, runs `set_config('app.user_id'/'app.org_id', …, true)` (transaction-local, so
  pooled connections never leak context), loads the caller's membership (none → 403
  `org.not_member`, same answer for orgs that don't exist), checks `@Roles(...)`, then runs
  the handler inside `RequestContext` (AsyncLocalStorage). Repositories use
  `RequestContext.tx`, so the whole request commits or rolls back together, audit rows included.
  Routes that need a user but no org (`POST/GET /orgs`, `POST /invites/accept`,
  `GET /auth/me`) are marked `@WithoutOrg()`.
- The role comes from the database on every request, not from the token (ADR 014), so
  removing someone or changing their role takes effect on their next request.
- Creating an org or accepting an invite *enters* that org mid-transaction
  (`RequestContext.enterOrg`). Invite codes are `<org_id>.<secret>` so the invite is looked
  up through RLS, with no bypass role.
- Workers will do the same per job, using the `org_id` in the job payload.
- Why RLS over only a `tenant_id` filter: a forgotten `WHERE` becomes an empty result rather
  than a data leak. Trade-off: every query must run inside a transaction with context set;
  cross-tenant admin jobs use a separate, audited role.
- Test: an integration test suite creates two orgs and asserts every repository method
  returns nothing from the other org.

### 7.1a Multi-location (from day one)
- The org is the tenant boundary (RLS); the **location** is the operational unit. Every
  location-bound table (`shifts`, `schedules`, `time_entries`, `coverage_requirements`,
  `shift_templates`, `departments`) carries `location_id`.
- **Location scope** (`apps/api/src/modules/locations/location-access.service.ts`): owners see
  every location; anyone else is limited to their `membership_locations` rows, or sees every
  location if they have none. Only owners assign scopes (`PUT /members/:userId/locations`).
  Every location-bound read or write goes through `LocationAccess.assertAccess()` (or filters
  by `scope()`); a location outside the scope answers **404**, exactly like one that doesn't
  exist, so ids can't be probed. Tests assert a scoped manager can't read or write another location.
- **Same-org foreign keys:** Postgres checks foreign keys *without* RLS, so a plain
  `location_id → locations.id` key would let org A attach rows to org B's location by id.
  Child tables reference the pair `(org_id, location_id) → locations (org_id, id)` instead;
  every future location-bound table (`shifts`, `schedules`, `time_entries`…) must do the same.
- Locations are never deleted (history points at them); they become `read_only`, which
  accepts no changes except an owner re-activating it.
- Each location has its own IANA zone, so one org can span time zones; week boundaries are
  computed per location.
- Employees can work at several locations (`employee_locations`). Overlap (exclusion
  constraint on `employee_id`), max weekly hours, min rest and overtime are evaluated
  **across all locations in the org**, never per location.
- Reports and exports can be filtered per location or aggregated org-wide.

### 7.1b Plans and entitlements
- Plans: Free (₹0, ≤ 10 active employees, 1 location), Pro (₹999/month, unlimited employees,
  1 location included), +₹999/month per additional location (subscription quantity =
  `extra_locations`).
- An `EntitlementService` answers `canAddEmployee`, `canActivateLocation`, `canUseChannel('whatsapp')`,
  `canUseFeature('auto_scheduler')`; checked in services, not only the UI.
- Billing provider webhooks update `subscriptions` (idempotent by event id). When paid
  locations drop, the newest extra locations become `read_only` instead of being deleted.
- Message quotas: 1,000 WhatsApp + 200 SMS per paid location per month, pooled per org.
  `message_usage` is incremented atomically (`UPDATE … SET sent_count = sent_count + 1
  WHERE sent_count < :limit RETURNING`) in the notification worker before sending; if no row
  is returned the job reroutes to push + email. Warnings at 80%/100% via the outbox.

### 7.1c Billing, GST invoices and coupons
- **Flow:** owner picks Pro + N extra locations (+ optional coupon) → API computes the
  price with a pure `priceQuote(plan, extraLocations, coupon, billingProfile)` in
  `packages/domain` → creates/updates a Razorpay subscription → Razorpay checkout →
  `subscription.charged` webhook (signature-verified, idempotent by event id) → write
  `invoices` row + outbox `invoice.issued` → worker renders PDF, stores it, emails it.
- **Amounts:** integer paise. Discount is applied before GST; GST 18% split as CGST 9% +
  SGST 9% when buyer state = seller state, otherwise IGST 18%. Rounding rules live in one
  function with tests.
- **Invoice numbers:** gap-free sequence per financial year (Apr–Mar), allocated inside the
  invoice transaction from an `invoice_counters(financial_year, last_number)` row locked with
  `SELECT … FOR UPDATE` (Postgres sequences can leave gaps, so they aren't used).
- **Coupons with Razorpay:** Shiftora owns coupon logic; Razorpay only charges the computed
  amount. A discounted subscription is created on a Razorpay plan whose amount equals the
  discounted price (plans are created via API and cached by amount); when a repeating coupon
  ends, the worker switches the subscription to the full-price plan. (Check this against
  the Razorpay Subscriptions API in week 8 before relying on it.)
- **Coupon redemption** is race-safe: one transaction does
  `UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = :id AND status = 'active'
  AND now() BETWEEN valid_from AND coalesce(valid_to, 'infinity')
  AND (max_redemptions IS NULL OR redeemed_count < max_redemptions) RETURNING *` plus an insert
  into `coupon_redemptions` (unique per org). Random codes come from a crypto-random,
  unambiguous alphabet (no 0/O/1/I), format `SHF-XXXX-XXXX`, with a retry on unique conflict; bulk generation
  inserts in batches.
- **Platform admin:** separate `platform_admin` flag on the user (not an org role), its own
  guard and routes under `/api/v1/platform/*`, 2FA required, every action written to the
  audit log. Coupons are global tables without RLS, reachable only through these routes.

### 7.2 Time zones, DST and overnight shifts
- Shift instants are `timestamptz` (UTC). The location's IANA zone is the reference for
  "which week/day" and for display.
- Templates, availability and coverage use **local wall-clock times** + the location zone and
  are expanded to UTC instants for a specific date (so 09:00 stays 09:00 across DST changes).
- A shift is "on" the local date of its start. A 22:00–06:00 shift spans two dates; pay rules
  split it at local midnight / at night-premium boundaries.
- DST: on the spring-forward night a 22:00–06:00 shift is 7 h, on fall-back it is 9 h; duration
  is always computed from UTC instants. Nonexistent local times (e.g. 02:30 on spring-forward)
  are shifted forward; ambiguous ones take the earlier offset. Covered by fixed test cases
  for zones with DST (Europe/London, America/New_York) and without (Asia/Kolkata).
- Implementation: `packages/domain/src/time/zoned.ts` (`toInstant`, `toLocal`, `shiftTimes`,
  `weekBounds`, `localDayBounds`, `startOfWeek`, `nominalMinutes`) on native `Temporal` with
  `disambiguation: 'compatible'`. Weeks run Monday–Sunday in the location's zone; a schedule
  week is 167, 168 or 169 hours long.

### 7.3 Schedule publishing and live board (implemented, W2 D5–D6)
- Edits to a schedule are silent until it is published. Every shift write bumps
  `schedules.version`, so `version > published_version` is "the board has edits staff have not
  been told about" — the badge, the Publish button's weight, and the dialog's premise all read
  from those two numbers.
- **Publishing** (`POST /schedules/:id/publish`) runs in the request's transaction:
  1. snapshot the week's live shifts as local wall clock (`PublishedShift`);
  2. diff that against the latest `schedule_publications` row — added / changed / removed, and
     the employees on **both** sides of a change (`diffPublication`, pure);
  3. bump `version` and `published_version` together, set status, moment and actor;
  4. insert the publication (the record of what staff were told);
  5. write **one** `schedule.published` outbox row carrying `affectedEmployeeIds`;
  6. audit it.
  Publishing a week with no edits is allowed and tells nobody (`affectedEmployeeIds: []`), but
  it still records the publication — "we told them nothing new" is a fact worth keeping.
  `GET /schedules/:id/publish-preview` computes the same diff without writing, which is what the
  Publish dialog shows.
- **Live board** (ADR 016): shift writes and publishes call `RealtimeService.scheduleChanged()`,
  which emits `schedule.changed` to room `org:{orgId}`. The payload names the schedule; a client
  refetches shifts, conflicts and the schedule only when the event belongs to the week on screen.
  Events are a **hint to refetch**, never data: HTTP stays the source of truth.
- Optimistic concurrency: shift updates send `version`; a stale version → 409, the client
  refetches.

### 7.3a Shift conflicts: one hard rule, four warnings

A shift is placed with a local date and wall-clock times (`09:00`–`17:00` on a date); the API
converts them with the location's zone, so no client does time zone maths and the response
carries both instants and wall clock. Validation is a pure function
(`packages/domain/src/scheduling/validation.ts`) over plain values — the candidate shift, the
employee's availability, time off and other shifts, and their limits:

| Check | Outcome | Notes |
|---|---|---|
| Overlap | **409 `shift.overlap`** | Exclusion constraint in Postgres is the last word; the service pre-check names the shift in the way |
| Availability | warning `unavailable` | Weekly wall-clock pattern; an overnight slot covers the next morning, Sunday night covers Monday; no recorded availability = no restriction |
| Time off | warning `time_off` | Exact UTC instants |
| Max weekly hours | warning `max_weekly_hours` | Paid minutes (breaks deducted), summed across **all** locations for the week the shift starts in |
| Min rest | warning `min_rest` | Gap on either side; skipped when the employee has no rule |

Rationale in [ADR 015](docs/adr/015-shift-conflict-policy.md). Warnings are never stored: they
are recomputed from the employee's current rules, and a write returns `{ shift, warnings }`.
The database window for the checks is the schedule's week plus two days each side (the largest
allowed rest rule), queried once per employee.

### 7.3b The staff app and the installable build (from W3)
The same React app serves two audiences with two shells under `/o/:orgId`, chosen by the role
read from the org (not from the token):
- **Manager shell** — sidebar, location switcher, the rota, locations and employees.
- **Staff shell** — a phone-width column, a sticky header and three bottom tabs (Shifts, Time
  off, Profile). No location switcher: an employee works where the rota says.

Staff never read the manager's endpoints. `GET /me`, `GET /me/shifts` and `GET /me/time-off` are
the only routes they call, and each one answers about the caller alone — `profile: null` and
empty lists when a login is not linked to a staff record, which is the normal state for an owner
who only administers. None of the three is location-scope checked: these rows are the caller's.

`GET /me/shifts?from=&to=` takes *local dates* and applies them per shift: each row is converted
to the wall clock of its own location before its date is compared, so someone working across two
zones sees exactly the days they asked for. The SQL window is a day wider at each end to make
that exact rather than lucky.

**Installable:** `vite-plugin-pwa` generates a manifest (standalone, portrait, teal, 192/512 +
maskable icons rasterised from the same mark as the favicon) and a service worker that precaches
the built shell. There is deliberately **no runtime caching of `/api`**: a stale rota presented as
current is worse than a spinner. Offline clock-in (W3 D6) will be an explicit IndexedDB queue,
not a cached GET. Every route is `lazy()`-loaded, so the entry chunk is the shell plus the login
page (130 kB gzip) instead of the whole app (339 kB before).

### 7.4 Open shifts and swaps: concurrency
- Claiming an open shift:
  ```sql
  UPDATE shifts SET employee_id = $emp, status = 'assigned', version = version + 1
  WHERE id = $shift AND status = 'open' AND version = $expectedVersion
  RETURNING *;
  ```
  Zero rows → "already taken". The exclusion constraint independently prevents the claimer
  from being double-booked. Eligibility (role, hours, rest, credentials) is checked in the
  same transaction.
- The client sends an `Idempotency-Key`; the first response is stored in `idempotency_keys`,
  so a retried request returns the same result instead of a confusing error.
- **Swaps and drops (implemented, W5 D1–D2).** `shift_requests` + a pure state machine
  (`packages/domain/requests`): swap = `pending_colleague` → `pending_manager` → `approved`, drop
  = `pending_manager` → `approved`; a manager always decides. Approval (`ShiftRequestsService`)
  locks both shifts with `SELECT … FOR UPDATE` **ordered by id** (two approvals of overlapping
  pairs queue instead of deadlocking), checks they still belong to the same people and have not
  started, re-validates the new assignees with `assessMany` → `assessAssignment` (blocking:
  archived, location, job role, overlap; advisories need `acknowledgeWarnings`), then reassigns —
  an exchange frees the first shift before filling the second, so the exclusion constraint never
  sees one person on both. The change is recorded as told (schedule version + a patched
  publication), audited per shift, and announced through the outbox; the request's own status
  moves with a conditional update (`where status = <seen>`), so two deciders produce one
  decision.
- Test: N concurrent claims via `Promise.all` against a real Postgres → exactly one winner.

### 7.5 Attendance and anti-fraud (geofence in W3 D2, matching in W3 D4, corrections in W3 D5)
- **Geofence:** the server computes the haversine distance between the reported coordinates and
  the location's own coordinates; the punch is inside if `distance ≤ radius + min(accuracy, 100 m)`.
  Both coordinates and the computed `in_distance_m` are stored — "16 m from the clinic, ±8 m
  accuracy" is what settles an argument later — and the client's arithmetic is never an input.
- **Policy is the tenant's** (`organizations.geofence_policy`): `flag` (default) records the punch
  with an `outside_geofence` flag and lets the manager decide; `reject` answers 422 so nobody
  starts a shift untracked. A ±400 m fix does not widen the fence: accuracy counts up to 100 m.
- **On the phone:** a punch is one tap on "My shifts" — the card names the branch and today's
  shift, shows a live "on the clock" timer while the punch is open, and the same button closes
  it. The idempotency key is minted per intent on the client and reused across retries of it.
- **Idempotent punches:** the device's `Idempotency-Key` is stored as `client_event_id`, unique
  per org — a retry after a dead connection returns the row it created (`created: false`), never
  a duplicate. One open punch per employee is a **partial unique index**, so two simultaneous
  clock-ins cannot both win (the loser gets 409).
- **Time is the device's claim plus the server's fact:** `clock_in_at` is the device's time,
  `received_at` the server's; a gap over five minutes is a `device_skew` flag, never a rejection.
- **The clock screen** (W3 D3) asks for a position only when the button is pressed, and turns
  every failure into a sentence with a next step: no permission ("allow it in browser
  settings"), an insecure page (a phone on plain `http://192.168.x.x`, where the browser never
  even prompts), a timeout, or no fix at all. A fix worse than ±100 m is confirmed before it is
  sent, and a punch the server flagged says so on the card — the person who will be questioned
  is told first.
- **Matching a punch to its shift** (W3 D4) is a pure function in
  `packages/domain/src/attendance/match.ts`: the punch's own `shift_id` when the app sends it,
  otherwise the employee's shift whose start is nearest, within a two-hour window of the shift.
  The result is one of `on_time | early | late | unscheduled`.
- **Lateness is derived, never stored.** The difference between punch and shift is computed on
  every read with the organisation's grace (`organizations.attendance_grace_minutes`, default 5,
  migration `0009`), so correcting a punch cannot leave a stale flag behind — the test that
  proves it changes a punch from on-time to 40 minutes late and reads the state again.
- **Corrections** (W3 D5) are wall clock, not instants: a manager types `09:00`–`17:05` and the
  server converts with the location's zone (`toInstant(day, time, zone)`), because that is how
  the times are read off the door log. A clock-out earlier than the clock-in is read as **the
  next morning**, so an overnight shift is one correction rather than an error; over sixteen
  hours is refused as a typo. The reason is required and sits in the same `audit_events` row as
  the before/after, which is what `GET /time-entries/:id` replays as the on-screen history.
  Reopening a forgotten clock-out (`clockOutTime: null`) is allowed, but two open punches for one
  person are not — that is a 409, not a constraint violation.
- **The review queue** (W3 D6) is a list of punches, not a count: each row carries the distance
  from the branch and the accuracy of the fix, which is what makes "accept or dispute" a decision
  rather than a guess. A review is `accepted` or `disputed`; a dispute requires a note, because
  the person it is about will read it. The punch keeps its times and its flags — the verdict is a
  separate fact, and the four review columns are all-or-nothing by CHECK. `reviewed_at IS NULL` is
  the queue's only filter, covered by a partial index (`0010`), so the queue does not slow down
  with age.
- **An open punch counts at most its rostered length** in the week's totals. The row still shows
  live elapsed time — that is what "on the clock" means — but a punch nobody closed must not turn
  three days into seventy-seven hours. Deciding what a runaway punch was is a manager's job (a
  correction, or a dispute); the timesheet's job is not to invent overtime.
- **Export** is the week plus its worked-vs-rostered totals, written with RFC-4180 quoting and a
  BOM (Excel on Windows reads it as UTF-8 rather than mojibake). It is generated from the rows the
  manager is already looking at, so the file and the screen never disagree.
- **The demo tenant** is a fixture, not a simulation: `pnpm db:seed` inserts Sunrise Clinic
  directly, in one transaction with the org context set, because a seed that goes through the API
  needs the API running and hides which row a failure came from. It mints the org id first — RLS
  only accepts rows for the org the transaction points at. Re-running deletes the demo org, so the
  fixture is idempotent.
- **Planned (W3 D6+):** rotating QR for a kiosk tablet, optional selfie, and an offline queue in
  IndexedDB.
- **Rotating QR (kiosk):** tablet shows `HMAC_SHA256(location.qr_secret, floor(now/30s))`
  truncated, plus the location id. Server accepts the current or previous window only, and a
  code+employee pair can be used once. Kiosk is a `kiosk` membership with a long-lived
  device token restricted to one location.
- **Selfie (optional):** uploaded to object storage with short-lived signed URLs; retention
  per org; no face recognition in v1.
- **Flags:** outside geofence, low GPS accuracy, device-time skew > 5 min, QR replay,
  clock-in far from shift start, impossible travel between entries. Flags are shown to
  managers; they do not silently block.

### 7.6 Offline clock-in
- PWA writes clock events to IndexedDB with `client_event_id` (UUIDv7), device time,
  coordinates and QR code if scanned; the service worker syncs when online (Background Sync
  where supported, else on app open).
- Server upserts by `client_event_id` (idempotent), uses device time as the claimed time but
  records `received_at`; large gaps or device-time skew raise flags. Conflicts (e.g. a
  manager already created a manual entry) keep both and flag for review rather than overwrite.

### 7.7 Notifications pipeline (relay, fan-out, email, push, providers, reports, reminders — W4)
```
domain txn ──writes──▶ outbox ──relay (poll, FOR UPDATE SKIP LOCKED)──▶ BullMQ `notifications`
   ▶ fan-out job: who is affected, what to say, which channel each person allows
   ▶ one BullMQ `deliveries` job per (message, channel); job id = delivery id
   ▶ provider adapter by channel (email and Web Push live; WhatsApp/SMS arrive in D4)
   ▶ `deliveries` row: queued → sent | failed (reason recorded) → provider webhook → delivered
```
- **The relay** lives in `apps/worker` (a plain Node process, not a second Nest app) and ticks
  every `RELAY_INTERVAL_MS`. Each tick is one transaction: set the relay flag (ADR 017), claim up
  to `RELAY_BATCH` rows with `for update skip locked`, enqueue them, then mark them published.
  Enqueue-then-mark is deliberate: a failed enqueue rolls back and the row is still pending, and a
  crash between insert and commit re-claims the row harmlessly because the BullMQ job id **is**
  the outbox row id. Several workers can run at once; none of them claims another's rows.
- **Reading across tenants is one policy wide.** `outbox` accepts `current_setting(
  'app.outbox_relay', true) = 'on'` for `SELECT` and `UPDATE`; the flag is transaction-local and
  nothing else has it. Every job after that runs under a single org's context, taken from the
  event (ADR 017).
- **A notification is one person's message**, not one event: `notifications` carries the
  employee, `(outbox_id, employee_id)` is unique, and the body is rendered per person (their
  name, their own shifts). The fan-out only messages the employees in the publication diff —
  telling the whole rota every week is how people learn to ignore the messages that matter.
- **Routing is a pure function** in `packages/domain/notifications/routing.ts`: the person's own
  preference when it has an address and the tenant allows it, else email (the login, so it always
  exists), with email and push as the ladder. WhatsApp and SMS are never a silent fallback —
  silence is not consent to a channel that costs the clinic money per message.
- **Sending is its own job.** The fan-out commits the rows and returns their ids; the handler
  queues one job per delivery with `jobId = delivery id`, so a replay re-queues nothing.
  `dispatchDelivery` counts the attempt *before* calling the provider (a crash mid-send leaves
  evidence), records `sent`/`failed`/`skipped` with the reason, and throws only to ask for
  backoff. A job for an already-sent delivery is a no-op.
- **Web Push is one row per channel, many devices.** `push_subscriptions` holds the browser's
  endpoint and its `p256dh`/`auth` keys; the endpoint is unique, so a browser that changes hands
  moves its row. `dispatchDelivery` sends to every subscription the person has, reports the
  delivery sent when at least one device took it, treats "no device subscribed" as a **skip** (a
  retry would spin forever), and deletes any subscription the push service answers 404/410 for.
  The VAPID keys are optional: with no keys the sender is `null`, the channel records
  "not configured", and the staff app hides its button.
- **Account mail never enters this pipeline** (ADR 018). Verification and password-reset emails
  belong to a person who may have no organisation at all, so the outbox row carries
  `org_id IS NULL`, and the worker renders and sends straight through the mailer — the record
  that matters is the hashed one-time token, not a delivery row.
- **Email is SMTP** (nodemailer): Mailpit on `:1025` locally, any relay in production, one code
  path. The templates are plain text on purpose — they have to survive a WhatsApp utility body
  (no markdown, 1024 characters), an SMS that truncates at 160, and an email that renders better
  without styling.
- **A channel the worker cannot send on is never offered.** `sendableChannels(adapters)` turns
  "is there a provider?" into the `ChannelPolicy` handed to `routeChannels`, so a person who chose
  WhatsApp on a deployment without that sender is routed to email (then push) instead of being
  queued a message that can only fail. A row that still lands on such a channel — queued before
  the provider existed, or after keys were removed — is `skipped` **with the reason** and the job
  completes: a missing provider is permanent, and five retries cannot conjure one. The same rule
  covers push with no VAPID keys. Push counts `push_subscriptions` per person for the same reason
  it is a policy question at all: a preference is not a device.
- **Retries** are job options (`attempts: 5`, exponential backoff from 5 s), not queue logic:
  a provider having a bad minute should not lose "you are working tomorrow". Failures stay in the
  failed set — the dead-letter list until D4 gives it a reason and a replay button.
- **Retries, dead letters and fallback (W4 D4, implemented).** Adapters throw `SendError` with a
  `kind`: `permanent` (invalid number, opted out) → recorded and fallen back at once;
  `transient` → retried on the delivery worker's own backoff (`retryDelayMs`: exponential from
  5 s, ±50% jitter, capped at 30 min); `rate_limited` (429) → the queue pauses for the provider's
  delay via `Worker.RateLimitError`, which does not spend an attempt. On the last attempt a
  transient failure is **dead-lettered in the database** (`deliveries.dead_lettered_at`), not in a
  second queue, and the message falls back to the next free rung (`createFallback` →
  `nextFallback`; paid channels never). The owner sees dead letters on the Messages page and
  replays one through the outbox (`delivery.replay`); the replay number is part of the job id.
- **Quota (implemented).** Before a paid send the worker reserves one message with a conditional
  upsert on `message_usage` (`… do update … where sent_count < limit returning`); no row back
  means no quota, and the delivery is skipped with the reason and falls back to email/push. A
  refused send gives the reservation back. Until billing, every active location counts as paid.
- **Providers:** `WHATSAPP_PROVIDER`/`SMS_PROVIDER` = `none` (channel out of routing) or `fake`
  (logs the masked number, fails on demand with `FAKE_PROVIDER_FAILURE`); Meta is next.
- Job ids derived from `notification_id + channel` → enqueue is idempotent.
- Fallback: if WhatsApp fails permanently, fall back to SMS/email per org setting.
- WhatsApp specifics (Meta Cloud API, adapter still to come): business-initiated messages use
  pre-approved **utility templates** (schedule published, shift reminder, swap update, open
  shift); free-form text only inside the 24 h customer-service window. Free plan never routes to
  WhatsApp (W8 entitlements).
- **Delivery reports (W4 D5, implemented).** A sender returns the provider's message id, stored on
  `deliveries.provider_message_id` (unique per channel). Meta posts statuses to
  `POST /webhooks/whatsapp`; the API checks `X-Hub-Signature-256` (HMAC-SHA256 of the **raw** body
  with `WHATSAPP_APP_SECRET`, constant-time), drops the recipient's number, and writes one
  `delivery.reported` platform event — no tenant work in the request, a fast 200 for Meta. The
  worker finds each delivery by message id (the `app.provider_report` switch, ADR 019) and applies
  `applyProviderReport`: forward only (`sent` → `delivered`, `read_at`), duplicates and stale
  reports change nothing, and a **late failure** (accepted, then undeliverable) fails the row,
  gives the quota back and falls back down the ladder like a permanent send error. The worker's
  own "sent" write never overwrites a `delivered` that beat it. Locally the fake WhatsApp provider
  posts the same signed webhooks (`FAKE_PROVIDER_REPORT_URL`; `FAKE_PROVIDER_FAILURE=undeliverable`
  for the late failure). `GET /webhooks/whatsapp` answers Meta's registration handshake.
- **Shift reminders and missed clock-ins (W4 D5, implemented).** One BullMQ **job scheduler**
  (`upsertJobScheduler`, every `ALERT_SCAN_INTERVAL_MS`, default 60 s) on the `alerts` queue —
  scheduled in Redis, so several workers still run one scan per interval. `scanShiftAlerts` lists
  orgs (`app.alert_scan`, ADR 019), then per org finds published shifts (in the schedule's
  **latest publication with the same person**) that start in the next 2 h (`reminderWindow`) or
  started more than the org's grace ago, within 4 h, with no punch from 2 h before the start
  (`missedClockInWindow`). For each it inserts `shift_alerts (org, shift, kind)` `ON CONFLICT DO
  NOTHING` and writes an outbox event (`shift.reminder` / `attendance.missed`) only for the rows
  created — exactly once per shift and kind, however many scans race. The handlers re-read the
  shift (cancelled, reassigned, started, or punched since → nothing) and use the same
  `notifyEmployee` ladder as a publish; a missed clock-in also emails the owners and the managers
  whose scope includes the location.
- **One wiring (W4 D6).** `startPipeline` (`apps/worker/src/pipeline.ts`) builds the relay, both
  consumers and the alert scheduler; `main.ts` adds configuration, the relay timer and signals, and
  `pipeline.int.test.ts` starts the same function on real Postgres + Redis with failure injection.
  A `delivery.reported` batch naming a message id not stored yet throws, so BullMQ retries it: a
  fast provider can report before the worker's own "sent" write commits. The owner follows each
  delivery on the Messages page (`GET /messages/recent`, polled while something is in flight).
- Still planned for the scheduler: nightly credential-expiry scan, monthly audit partition creation.

### 7.8 Pay rules engine
- Rules are versioned JSON validated by a Zod schema, e.g.:
  ```json
  {
    "overtime": [{ "period": "week", "thresholdMinutes": 2880, "multiplier": 1.5 },
                 { "period": "day",  "thresholdMinutes": 600,  "multiplier": 1.5 }],
    "nightPremium": { "startLocal": "22:00", "endLocal": "06:00", "multiplier": 1.25 },
    "breaks": [{ "afterMinutes": 360, "deductMinutes": 30, "paid": false }],
    "rounding": { "toMinutes": 5, "mode": "nearest" }
  }
  ```
- `computePay(entries, rules, timezone)` in `packages/domain` is pure and deterministic:
  segment entries at local midnight and premium boundaries → apply breaks → classify regular vs
  overtime (no double-counting between daily and weekly; the larger applies) → price each segment.
- Rule version chosen by `effective_from` at the time worked, so recalculating an old period
  gives the same result. Property tests (fast-check): total paid minutes ≤ worked minutes,
  splitting an entry doesn't change pay, etc.

### 7.9 Auto-scheduler
- **Input:** coverage slots (role, start, end, count) for a week, employees with roles,
  availability, max hours, min rest, credentials, hourly cost, history for fairness, locked
  (manually placed) shifts.
- **v1 (TypeScript, in worker):**
  1. Expand coverage into slots; sort by difficulty (fewest eligible candidates first).
  2. For each slot, filter by hard constraints, score candidates
     `w1·cost + w2·fairnessDeficit + w3·preference + w4·weekendNightBalance`, pick best.
  3. If a slot has no candidate, bounded backtracking (depth/time limit) to reassign earlier
     slots; else leave unfilled with a reason ("no Nurse available Tue 22:00, 2 over max hours").
  - Complexity ~O(S·E·log E) for greedy (S slots, E employees); backtracking is capped by a
    time budget (e.g. 2 s), so it always returns.
- **v2 (optional):** same contract, solved by OR-Tools CP-SAT in `apps/solver` (boolean
  `x[e,s]`, hard constraints as linear constraints, soft ones in the objective). Chosen per job
  by size or plan.
- Runs as a job; progress streamed to the manager via Socket.IO; result written as a draft.

### 7.10 Audit log
- `audit_events` written in the **same transaction** as the change (service-level helper,
  not triggers, so actor and reason are captured).
- `app_user` has `INSERT, SELECT` only — no `UPDATE/DELETE` — making it append-only at the
  permission level. Monthly partitions keep it fast. Optional later: hash chain
  (`hash = sha256(prev_hash || row)`) for tamper evidence.

### 7.11 Authentication and sessions
- **Signup/login** return a 15-minute access token (JWT, HS256, `sub` = user id,
  `iss: shiftora`, `aud: shiftora-api`) in the body, and set a refresh token cookie
  `shiftora_rt` (`HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` in production,
  30 days). The web app keeps the access token in memory only.
- **Refresh tokens** are 32 random bytes; only their SHA-256 is stored in `sessions`. Every
  refresh revokes the presented row and inserts a new one in the same `family_id` (one family =
  one login) inside one transaction. The conditional `UPDATE … WHERE revoked_at IS NULL`
  makes concurrent refreshes safe: exactly one wins.
- **Reuse detection:** presenting an already-rotated token means it was copied, so the whole
  family is revoked and the user must log in again. Consequence for the web app: refreshes
  must be single-flight across tabs (`navigator.locks`), or two tabs refreshing at once would
  look like reuse.
- **Login errors** are identical for unknown email and wrong password, and unknown emails are
  verified against a dummy hash so timing doesn't reveal accounts.
- **Default deny:** `JwtAuthGuard` is a global guard; routes opt out with `@Public()`
  (health, signup, login, refresh, logout). Org and role checks are added on day 4.
- **Errors:** a global filter renders every error as RFC 7807 `application/problem+json`
  with a stable `code` (`packages/shared/src/problem.ts`); unexpected errors become a generic 500.
- Not yet: email verification and password reset (need the email queue, week 4), 2FA.

### 7.12 Realtime channel (implemented, W2 D6)
```
browser ──io(auth:{token})──▶ /socket.io ──▶ ScheduleGateway.handleConnection
                                             verify access token (TokenService)
                                             read memberships with RLS for that user
                                             join "org:<id>" for each organisation
services ──RealtimeService.scheduleChanged()──▶ server.to("org:<id>").emit("schedule.changed")
```
- **One room per organisation.** The payload carries `scheduleId`/`weekStart`, so the client
  decides whether the open board is affected. Rooms keyed by location and week look tidier but go
  stale the moment a manager's scope changes; a payload filter cannot.
- **Auth is the HTTP token, and membership is re-read through RLS** — the socket gets exactly the
  visibility an HTTP request would, with no bypass role. Failure closes the socket.
- **Redis adapter when `REDIS_URL` is set** (`@socket.io/redis-adapter`), so several API
  instances share rooms; without it a warning says realtime is single-process.
- **Inert in tests.** `main.ts` installs `IoAdapter`; the test app does not, so the gateway never
  starts and `RealtimeService` is a no-op. Every service stays callable from a test.
- **Deployment note:** sticky sessions are not required (websocket transport is used first), but
  if a load balancer terminates websockets it must allow the upgrade on `/socket.io`.

## 8. API conventions

- REST, JSON, `/api/v1/...`. The organisation a request acts on is chosen with the
  `X-Org-Id` header (ADR 014), not the URL or the token.
- Errors: RFC 7807 problem+json with stable `code`s.
- Pagination: cursor-based (`?cursor=&limit=`).
- Writes that clients may retry (clock-in, claim, swap) accept `Idempotency-Key`.
- OpenAPI generated from Nest decorators + Zod; typed client generated for the web app.

Example endpoints:
```
POST /auth/signup | /auth/login | /auth/refresh
GET  /locations · POST /locations
GET  /schedules?locationId=&week=2026-11-09
POST /schedules/:id/publish
POST /schedules/:id/auto-schedule            -> 202 { jobId }
PATCH /shifts/:id   (If-Match: version)
POST /shifts/:id/claim                       (Idempotency-Key)
POST /requests  · POST /requests/:id/approve
POST /attendance/clock-in | /attendance/clock-out | /attendance/sync
GET  /kiosk/qr                               (kiosk token)
GET  /pay-periods/:id/export?format=xlsx
GET  /audit?entity=shift&entityId=
```

## 9. Security

- RBAC roles: `owner`, `manager` (optionally scoped to locations), `employee`, `kiosk`.
  Enforced by Nest guards; RLS is the second line of defence.
- Rate limiting on signup/login/password routes per IP, and on refresh **per login** (session family; per IP only when the cookie is missing or unknown) so staff behind one office connection don't log each other out (10/min/route, in-memory today) and later on clock-in; Redis-backed from week 4. Behind a proxy, enable Fastify `trustProxy` so `request.ip` is the client, not the load balancer.
- Provider webhooks verified by signature; secrets in env/secret manager; QR secrets encrypted at rest.
- PII minimisation: location only at clock events; selfies opt-in with retention; data export
  and deletion per employee.

## 10. Observability

- OpenTelemetry auto-instrumentation (HTTP, pg, ioredis, BullMQ) with trace context propagated
  into job data, so one trace spans "publish → outbox → worker → WhatsApp API".
- pino JSON logs with `traceId`, `orgId`, `userId`.
- Dashboards: API p50/p95 by route, error rate, queue depth/age per queue, delivery success
  rate by provider, auto-scheduler runtime, clock-in flag rate.
- Alerts: DLQ growth, delivery success < 98%, outbox lag > 1 min.

## 11. Scaling notes (what breaks at 5,000+ employees)

| Pressure point | Plan |
|---|---|
| Clock-in spikes at shift change | Stateless API scales horizontally; clock-in is one indexed insert |
| Schedule board queries | Index `(org_id, location_id, starts_at)`; week-scoped queries |
| Notification bursts on publish | Queue absorbs; per-provider limiter; batched fan-out |
| Auto-scheduler on large orgs | Time-boxed; move to CP-SAT worker; per-location decomposition |
| Audit table growth | Monthly partitions; archive old partitions |
| DB connections | PgBouncer (transaction mode works because context is `SET LOCAL`) |

## 12. Environments and deployment

- **Local:** `docker compose up` (Postgres, Redis, Mailpit, Grafana stack), `pnpm dev`.
- **CI:** lint → typecheck → unit → integration (Testcontainers) → build → Docker images, plus
  a separate `e2e` job that boots compose + migrations and runs Playwright in Chromium.
- **Prod:** API and worker as separate services from the same image (different start
  command); migrations run as a release step; daily DB backups + PITR; seeded "demo clinic"
  tenant reset nightly.

## 13. Decisions log (ADR index)

| # | Decision | Status |
|---|---|---|
| 001 | Modular monolith over microservices | Accepted |
| 002 | NestJS (Fastify adapter) over plain Fastify | Accepted (2026-11-03) |
| 003 | PWA for the MVP; native mobile app (React Native) as a future enhancement | Accepted (2026-11-03) |
| 004 | Postgres RLS for tenant isolation | Accepted |
| 005 | Drizzle + SQL migrations over Prisma (RLS/exclusion constraints need raw SQL; deliberate step up from Prisma experience) | Accepted (2026-11-03) |
| 006 | Transactional outbox for side effects | Accepted |
| 007 | TS heuristic auto-scheduler first, OR-Tools CP-SAT later (same contract) | Accepted (2026-11-03) |
| 008 | Meta WhatsApp Cloud API directly, no BSP | Accepted (2026-11-03) |
| 009 | Multi-location data model and UI from day one; org = tenant, location = operational unit | Accepted (2026-11-03) |
| 010 | Flat pricing: Free ≤ 10 employees, Pro ₹999/month, +₹999 per extra location | Accepted (2026-11-03) |
| 011 | INR billing via Razorpay Subscriptions; Shiftora generates its own GST invoices | Accepted (2026-11-03) |
| 012 | Coupon engine owned by Shiftora (platform-admin managed, random/custom codes) | Accepted (2026-11-03) |
| 013 | Message quotas: 1,000 WhatsApp + 200 SMS per paid location/month, fall back to push/email | Accepted (2026-11-03) |
| 014 | Org selected per request with `X-Org-Id`; role loaded from the DB each request (not token claims) | Accepted (2026-11-05) |
| 015 | Shift overlap blocks (DB exclusion constraint + 409); availability, time off, weekly hours and min rest are returned as warnings | Accepted (2026-11-06) |
| 016 | Realtime over Socket.IO on the API's own server, one room per org, auth = the access token + RLS membership read, Redis adapter only when configured; events are refetch hints, not data | Accepted (2026-11-12) |
| 017 | The outbox relay reads across tenants through a transaction-local switch (`app.outbox_relay`) and two policies on `outbox` only; no BYPASSRLS role | Accepted (W4 D1) |
| 018 | Account mail (verification, reset) is a platform outbox event with `org_id IS NULL`, sent directly by the worker | Accepted (W4 D3) |
| 019 | The alert scan (`app.alert_scan` on `organizations`) and delivery reports (`app.provider_report` on `deliveries`) get the same kind of switch: `SELECT`-only, one query wide; the webhook only writes a platform event | Accepted (2026-11-16) |
