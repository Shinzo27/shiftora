# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.
Read `PRD.md` for *what* we're building and `ARCHITECTURE.md` for *how*. This file is the
rules of the road.

## Project in one paragraph

**Shiftora** is a multi-tenant, multi-location shift scheduling and attendance SaaS for
small businesses, clinics first.
Managers build and publish weekly schedules, employees get them over WhatsApp, clock in with
geofence/QR from a PWA, swap or pick up shifts, and managers export payroll-ready timesheets.
It is a TypeScript modular monolith: NestJS API + BullMQ worker + React/Vite web app/PWA,
PostgreSQL with Row-Level Security, Redis.

This is also a portfolio project: the owner must be able to **explain every line in an
interview**. Prefer clear, small, well-named code over clever code. Explain non-obvious
decisions in the PR/summary, not in long comments.

## Repo map

```
apps/api        NestJS HTTP + WebSocket (src/modules/<module>)
apps/worker     BullMQ processors, outbox relay, cron jobs
apps/web        React app: manager dashboard, employee PWA, kiosk route
apps/solver     (later) Python OR-Tools solver
packages/db     Drizzle schema, SQL migrations (incl. RLS policies), seeds
packages/domain Pure business logic: validation, pay rules, scheduler, time utils
packages/shared Zod schemas + API types shared by api/web/worker
infra/          docker-compose, Dockerfiles, dashboards
docs/           ADRs (docs/adr/NNN-title.md), blog drafts
```

## Commands

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # postgres (localhost:5433), redis (6379), mailpit (smtp 1025, ui 8025)
pnpm infra:down
pnpm dev               # api + worker + web via turbo
pnpm format            # prettier --write (pnpm format:check in CI)
pnpm lint && pnpm typecheck
pnpm test              # unit (vitest)
pnpm build
# added in later weeks:
pnpm db:migrate        # apply migrations (runs as app_owner)
pnpm db:seed           # seed the "demo clinic" tenant
pnpm test:int          # integration (Testcontainers Postgres/Redis)
pnpm test:e2e          # Playwright
```

Toolchain notes:
- Node 26 (`.nvmrc`), pnpm 12 (pinned in `packageManager`), Turborepo, ESM everywhere.
- TypeScript is pinned to **6.0.x** because typescript-eslint doesn't support TS 7 yet.
  Don't bump to 7 until it does.
- `pnpm-workspace.yaml` sets `minimumReleaseAge` (7 days): pnpm won't install versions newer
  than that. Don't remove it to get a fresh release; wait or ask.
- Local Postgres uses port **5433** (5432 is taken by a system Postgres on the dev machine).
- Shared TS/ESLint presets live in `packages/config`; packages extend them, not copy them.

Before saying a task is done: `pnpm lint && pnpm typecheck && pnpm test` must pass, plus
`pnpm test:int` if you touched SQL, migrations, tenancy, concurrency or queues. Report
failures honestly with output; don't skip or delete failing tests to go green.

## Non-negotiable rules

### Tenancy and security
- Every tenant table has `org_id uuid not null`, **RLS enabled and forced**, and a policy on
  `current_setting('app.org_id')`. A new table without an RLS policy is a bug.
- Never connect as a superuser or a `BYPASSRLS` role from app code. Never disable RLS to make
  a query work.
- DB access goes through the request/job transaction that has `app.org_id` set
  (`set_config(..., true)` = transaction-local). Workers must set it from the job's `orgId`.
- Every new endpoint needs an RBAC guard (`owner`/`manager`/`employee`/`kiosk`) and an
  integration test proving another org's data is invisible.
- Never log secrets, tokens, phone numbers in full, or precise coordinates.

### Multi-location and plans
- Assume an org has many locations. Location-bound tables carry `location_id`; managers and
  kiosks are scoped to their `membership_locations`, and every endpoint that takes or returns
  location data must respect that scope (with a test).
- Overlap, max-hours, rest and overtime are computed per employee **across all locations**.
- Plan limits (Free ≤ 10 employees and 1 location; Pro ₹999 incl. 1 location, +₹999 per extra
  location; WhatsApp/auto-scheduler Pro-only) go through `EntitlementService`, server-side.
- WhatsApp goes only through the Meta WhatsApp Cloud API adapter using approved templates,
  and every WhatsApp/SMS send must pass the quota check (fallback to push + email).

### Billing, GST and coupons
- All prices and amounts are **INR in integer paise**. Price/discount/GST math lives in
  `packages/domain/billing` as pure functions with tests (CGST+SGST vs IGST, coupon before GST, rounding).
- Payments only through the Razorpay adapter; webhooks must verify the signature and be idempotent by event id.
- Invoice numbers are gap-free per financial year; never use a Postgres sequence for them and
  never delete or renumber an issued invoice (issue a credit note instead).
- Coupons and `platform_admins` are platform-level tables: only `/api/v1/platform/*` routes
  behind the platform-admin guard may touch them. Coupon redemption must be race-safe (test it).
- Prices are exclusive of GST (18% added on top). Seller GSTIN, SAC code, GST rate and
  invoice prefix come from config, never hardcoded (CA sign-off is pending).
- Don't invent GST rules beyond what `PRD.md` §7.1 states; ask.
- Auto-scheduler: implement and improve the TypeScript heuristic in `packages/domain`; don't
  start the OR-Tools solver until the owner says so.

### Time
- Store instants as `timestamptz` in UTC. Store templates/availability/coverage as local
  wall-clock time + the location's IANA zone.
- Never use `new Date()` arithmetic for days/weeks; use the helpers in
  `packages/domain/time`. Inject a clock (`Clock` interface) so tests can control "now".
- Any change touching shift times, pay or reminders needs tests for: an overnight shift,
  DST spring-forward and fall-back (Europe/London or America/New_York), and Asia/Kolkata.

### Money and durations
- Money is integer minor units + currency code. No floats for money. Durations are integer minutes.

### Business logic
- Validation, pay calculation and scheduling logic live in `packages/domain` as **pure
  functions** (no DB, no Nest, no `Date.now()`). Services call them; tests hit them directly.
- Pay rules are data (versioned JSON validated by Zod), never hardcoded per customer.

### Side effects and concurrency
- Never call providers (WhatsApp/SMS/email/push) from a request handler. Write an `outbox`
  row in the same transaction; the worker delivers.
- Jobs must be idempotent (deterministic job ids, upserts, `client_event_id`).
- Contended writes (claiming open shifts, swaps, clock-in sync) use conditional UPDATEs /
  `SELECT … FOR UPDATE` with a stable lock order, plus `Idempotency-Key` support. Add a
  concurrent test (`Promise.all` of N attempts → exactly one winner).
- Don't remove the shifts exclusion constraint (no double-booking).

### Audit
- Changes to schedules, shifts, time entries, pay rules, memberships and permissions write an
  `audit_events` row **in the same transaction** with actor, before and after.
- Never add UPDATE/DELETE on `audit_events`.

## Conventions

- TypeScript `strict`; no `any` (use `unknown` + Zod parse). No default exports except where a
  framework requires it.
- API: REST under `/api/v1`, Zod schemas from `packages/shared`, RFC 7807 errors with a stable
  `code`, cursor pagination.
- Nest module layout: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`,
  `<module>.repository.ts`, `dto/`, `__tests__/`. Modules talk only via exported services or
  domain events, never by querying another module's tables.
- DB toolkit is **Drizzle**, not Prisma: don't add Prisma or Prisma-style patterns. Use
  Drizzle's query builder for typed queries and raw `sql` only where needed (RLS context,
  exclusion constraints, `FOR UPDATE`).
- Mobile is a PWA for the MVP; don't add React Native/Expo until the owner starts that enhancement.
- Migrations: forward-only SQL files in `packages/db/migrations`, named
  `NNNN_short_description.sql`; include RLS policy, indexes and grants in the same file.
  Never edit a migration that has been merged.
- Frontend: TanStack Query for server state, no global store unless needed; Tailwind +
  shadcn/ui components; forms with react-hook-form + Zod; mobile-first for employee screens.
- Naming: tables `snake_case` plural; TS `camelCase`; events `entity.past_tense`
  (`schedule.published`).
- Commits: Conventional Commits (`feat(scheduling): ...`, `fix(attendance): ...`).
- New architectural decision → add an ADR in `docs/adr/` and update the table in `ARCHITECTURE.md`.

## Testing expectations

| Change | Required tests |
|---|---|
| Pure domain logic | Vitest unit tests; property tests (fast-check) for pay rules/scheduler |
| Repository / SQL / migration | Integration test on real Postgres incl. cross-tenant isolation |
| Concurrency path | Concurrent integration test (exactly one winner, no deadlock) |
| Queue / worker | Idempotency test (same job twice → one effect), failure → retry → DLQ |
| User-facing flow | Playwright E2E for the happy path |

## Scope discipline

- Follow the current week in `PRD.md` §11. Don't start advanced features (auto-scheduler,
  offline sync, selfie, forecasting) before the MVP piece they depend on exists.
- No new infrastructure (Kafka, Kubernetes, microservices, GraphQL, another database) without
  an ADR and the owner's explicit OK. The modular monolith is intentional.
- Ask before adding a dependency; prefer well-known, maintained libraries.
- Keep PRs small and focused (one feature slice: migration + domain + API + UI + tests).

## When unsure

Check `PRD.md` (requirements and acceptance criteria), then `ARCHITECTURE.md` (design), then
ask. Don't invent business rules for pay, labour law or attendance; list the assumption and ask.
