# Shiftora: project plan and full context

> One document with everything needed to understand, set up and continue the project:
> what we're building and why, every decision made so far, the tech stack, how the code is
> organised, what's done, and the day-by-day plan to launch.
>
> Last updated: 2026-11-05 (end of Week 1, Day 4) · Owner: Pratham (GitHub: Shinzo27)
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
| W1 D5 | Multi-location: locations, departments, job roles, manager location scopes, same-org foreign keys | ✅ Done | (uncommitted) |
| W1 D6 | Employees, availability, time off; web app shell (React) verified in a browser | ✅ Done | (uncommitted) |
| **W1 UI** | **UI foundation: shadcn/ui design system, theme, dark mode, app shell, restyle existing pages** | ⏭ **Next** | |
| W2 D1 | Time helpers (local → UTC, DST), shift templates, schedules | Planned | |
| W2 → W8 | See [§14](#14-day-by-day-plan) | Planned | |

Numbers today: 5 migrations, 204 automated tests (109 unit, 95 integration against real
Postgres), 39 API endpoints, a React web app (login, orgs, locations, employees).

Working agreement: **the owner commits and pushes**; agents prepare changes, run every check,
and propose a Conventional Commit message. Ask before adding a dependency.

---

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
| — | Table naming: **`job_roles`** for work roles (Nurse, Receptionist), distinct from the `member_role` access enum; **`time_off`** instead of `unavailability`; referencing columns are `job_role_id` | 2026-11-06 |

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
| Dates | date-fns + date-fns-tz (or Luxon) for IANA zone maths | Week 2 D1 |
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
│                                    locations, employees; src/lib/api-client.ts = token + refresh logic
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

# Clone with the PERSONAL GitHub account (SSH alias github-personal → Shinzo27's key)
git clone git@github-personal:Shinzo27/shiftora.git && cd shiftora
git config user.name "Shinzo27"
git config user.email "20bmiit031@gmail.com"     # repo-local, never --global

pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev                        # http://localhost:4000/api/v1/health/ready → 200
```

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

### 10.1 Implemented (migrations 0000–0004)

| Migration | Contents |
|---|---|
| `0000_foundation` | extensions `btree_gist`, `citext`; default grants to `app_user`; `current_org_id()` |
| `0001_auth` | `users`, `sessions` (platform tables, no RLS) |
| `0002_tenancy` | `member_role` enum; `organizations`, `memberships`, `invites`, `audit_events`; `current_user_id()`; RLS policies; audit append-only |
| `0003_locations` | `location_status` enum; `locations`, `departments`, `job_roles`, `membership_locations`; same-org composite FKs; coordinate/radius CHECKs; RLS |
| `0004_employees` | `employee_status`, `notify_channel` enums; `employees`, `employee_job_roles`, `employee_locations`, `availability`, `time_off`; same-org FKs; CHECKs; RLS |

```
users          (id, email citext unique, name, password_hash, email_verified_at, created_at, updated_at)
sessions       (id, user_id, family_id, token_hash unique, expires_at, revoked_at, replaced_by, user_agent, ip, created_at)
organizations  (id, name, created_at, updated_at)                                   RLS
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
```

IDs are UUIDv7 generated in the app (`newId()` in `packages/db`).

### 10.2 Planned (by week)

| Week | Tables |
|---|---|
| W2 | `shift_templates`, `schedules` (draft/published, version), `shifts` (starts_at/ends_at timestamptz, **exclusion constraint** against double-booking), `outbox` |
| W3 | `time_entries` (method gps/qr/manual, geo, accuracy, client_event_id unique, flags) |
| W4 | `notifications`, `deliveries`, `message_usage` |
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

Error codes in use: `validation_failed`, `not_found`, `rate_limited`, `internal_error`,
`auth.unauthenticated`, `auth.email_taken`, `auth.invalid_credentials`,
`auth.invalid_refresh_token`, `auth.forbidden`, `org.required`, `org.not_member`,
`org.member_not_found`, `org.last_owner`, `invite.invalid`, `invite.email_mismatch`,
`invite.already_member`, `conflict.name_taken`, `location.not_found`, `location.read_only`,
`location.owner_unrestricted`, `department.not_found`, `job_role.not_found`, `conflict.duplicate`,
`employee.not_found`, `time_off.not_found`.

### 11.2 Conventions

REST under `/api/v1`; Zod schemas from `packages/shared` validate every body; cursor
pagination (`?cursor=&limit=`) for lists that can grow; `Idempotency-Key` header on writes
clients may retry (clock-in, claim, swap; from week 3); OpenAPI generation planned.

---

## 12. Testing

| Kind | Tool | Where | Today |
|---|---|---|---|
| Unit | Vitest | `*.test.ts` next to code | 56 |
| Integration (DB) | Vitest + Testcontainers | `packages/db/src/__tests__/*.int.test.ts` | 17 |
| Integration (API, full HTTP) | Vitest + Testcontainers + Fastify inject | `apps/api/src/**/__tests__/*.int.test.ts`, helper `src/testing/test-app.ts` | 34 |
| E2E | Playwright | planned with the web app | — |
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
| **UI** | ⏭ | **UI foundation** (see [§14.1](#141-ui-and-design-system)): init shadcn/ui; brand theme tokens (teal primary, neutral greys) in CSS variables with **dark mode**; Inter Variable font (self-hosted); lucide icons; new app shell (collapsible sidebar, top bar with org + location switcher, user menu, mobile drawer); sonner toasts; skeleton loaders; empty states with illustrations/icons; restyle login/signup (split-screen hero), org picker, locations and employees (TanStack Table data table with search, sort, row actions; add/edit in a Sheet); command palette (⌘K) for navigation | The four existing pages look production-grade in light and dark mode, on desktop and phone; Lighthouse accessibility ≥ 95 |

### Week 2: Schedule builder, shifts, publish

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | Time helpers in `packages/domain/time` (local wall-clock + zone → UTC, week boundaries per location, overnight shifts, DST gaps/overlaps); `shift_templates`, `schedules` (week, draft/published, version) | Tests for Europe/London, America/New_York and Asia/Kolkata incl. both DST transitions |
| D2 | ☐ | `shifts` (timestamptz range, status open/assigned/cancelled, version) with **exclusion constraint** (no double-booking across locations); validation as pure functions: overlap, availability, max weekly hours, min rest | Double-booking rejected by the DB; validation unit tests |
| D3 | ☐ | Week board UI with shadcn components (rows by employee; filter by location/department; colour per job role; today marker; sticky header), shift create/edit in a Sheet using **react-hook-form + Zod** (first complex form); date navigation with shadcn Calendar | Manager builds a week by hand; the board feels as polished as a commercial product |
| D4 | ☐ | Drag-and-drop (dnd-kit) with drag overlay and smooth animation (Motion), optimistic updates, conflict warnings as badges/tooltips, optimistic concurrency (`version` → 409 shown as a toast + refetch) | Two managers editing: the stale one gets a clear toast and refetches |
| D5 | ☐ | Publish flow (draft → published, diff of changed employees); `outbox` table + `schedule.published` event in the same transaction | Publishing writes exactly one outbox row; edits after publish produce a diff |
| D6 | ☐ | Socket.IO + Redis adapter, room per org/location/week; Playwright E2E for the build-and-publish happy path | Second browser sees changes live |

### Week 3: Attendance (geofenced clock-in, timesheets)

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | PWA setup (manifest, icons, splash, service worker via vite-plugin-pwa); employee "My shifts" view designed mobile-first (bottom navigation, cards, Vaul drawer for details) | Installable on Android; looks and feels like a native app |
| D2 | ☐ | `time_entries`; clock-in/out API with server-side haversine geofence (`radius + min(accuracy, 100 m)`); `Idempotency-Key` | Outside the fence → rejected or flagged per org setting |
| D3 | ☐ | Clock-in UI: geolocation permission and error states, low-accuracy handling | Works on a real phone |
| D4 | ☐ | Match entries to shifts; early/late tolerance; flags (outside fence, device-time skew) | Flags visible to managers |
| D5 | ☐ | Timesheet per pay period; manager edits need a reason (audited) | Edited entry shows before/after in audit |
| D6 | ☐ | Buffer; tests for the clock-in path; seed script for a "demo clinic" tenant (`pnpm db:seed`) | Demo data in one command |

### Week 4: Notifications and reminders

| Day | Status | Tasks | Done when |
|---|---|---|---|
| D1 | ☐ | `apps/worker`; BullMQ queues; outbox relay (`FOR UPDATE SKIP LOCKED` → enqueue); workers set RLS context per job | Outbox rows become jobs exactly once |
| D2 | ☐ | Notification module: templates, channel routing by plan + preference; `notifications` and `deliveries` tables | One notification → one delivery per channel |
| D3 | ☐ | Email adapter (Resend/SES; Mailpit locally) + Web Push (VAPID); **email verification, password reset, invite emails** (deferred from D3/D4) | Invite arrives in Mailpit with a working link |
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
