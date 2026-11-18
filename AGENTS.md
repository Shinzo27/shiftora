# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.
Read `PROJECT_PLAN.md` first (full context, current status, day-by-day plan), then `PRD.md`
for *what* we're building and `ARCHITECTURE.md` for *how*. This file is the rules of the road.

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
pnpm db:migrate        # apply migrations (runs as app_owner via MIGRATION_DATABASE_URL)
pnpm db:generate       # drizzle-kit: write the next migration from packages/db/src/schema
pnpm dev               # web (:5173, proxies /api) + api (:4000) + worker, all via turbo
pnpm format            # prettier --write (pnpm format:check in CI)
pnpm lint && pnpm typecheck
pnpm test              # unit (vitest)
pnpm test:int          # integration (Testcontainers Postgres; needs Docker)
pnpm build
pnpm test:e2e          # Playwright (needs `pnpm dev` running, or it starts one)
# added in later weeks:
pnpm db:seed           # seed the "demo clinic" tenant
```

Toolchain notes:
- Node 26 (`.nvmrc`), pnpm 12 (pinned in `packageManager`), Turborepo, ESM everywhere.
- TypeScript is pinned to **6.0.x** because typescript-eslint doesn't support TS 7 yet.
  Don't bump to 7 until it does.
- `pnpm-workspace.yaml` sets `minimumReleaseAge` (7 days): pnpm won't install versions newer
  than that. Don't remove it to get a fresh release; wait or ask.
- Local ports: Postgres **5433**, API **4000** (5432 and 3000 are used by other projects
  on the dev machine).
- Shared TS/ESLint presets live in `packages/config`; packages extend them, not copy them.
- Database roles: `postgres` (local superuser, admin only), `app_owner` (owns schema, runs
  migrations), `app_user` (the API/worker; no BYPASSRLS, owns nothing). Created locally by
  `infra/postgres/init/01-roles.sql`, which runs only on a fresh volume
  (`docker compose -f infra/docker-compose.yml down -v` to reset).
- Migrations: `pnpm db:generate` for schema changes, or
  `pnpm --filter @shiftora/db exec drizzle-kit generate --custom --name=<name>` for
  hand-written SQL (policies, functions). Each statement is separated by
  `--> statement-breakpoint`. Tenant context is read with `current_org_id()`
  (from `0000_foundation`), never `current_setting` directly.
- API (NestJS 12, ESM): tests use Vitest + `unplugin-swc` because esbuild drops the decorator
  metadata Nest's DI needs. Share HTTP setup through `configureApp()` so tests match `main.ts`.
  Read settings from the injected `AppConfig`, never `process.env` — the one exception is the
  socket gateway's CORS origin, which is evaluated before DI exists (see gotchas).

Before saying a task is done: `pnpm lint && pnpm typecheck && pnpm test` must pass, plus
`pnpm test:int` if you touched SQL, migrations, tenancy, concurrency or queues. Report
failures honestly with output; don't skip or delete failing tests to go green.

## Start of every session ("collect the context")

Do this before writing any code, whatever tool or model you are:

1. Read, in order: this file → `PROJECT_PLAN.md` §2 (status + **Handoff note**) → the next
   day's row in `PROJECT_PLAN.md` §14 (marked ⏭) → §5 decisions and §18 follow-ups → the
   `ARCHITECTURE.md` sections that day touches → `PRD.md` only for product questions.
2. Look at the repo state: `git status`, `git log --oneline -10`. Uncommitted work from a
   previous session is the owner's to commit; don't revert or redo it.
3. Check the machine works: `pnpm install`, `pnpm infra:up`, `pnpm db:migrate`, then
   `pnpm lint && pnpm typecheck && pnpm test && pnpm test:int`. If it's a new machine,
   follow `PROJECT_PLAN.md` §8.1 first. Fix or report anything red before new work.
4. Read the code you will extend: the closest existing module is the template (e.g. a new
   API module copies `apps/api/src/modules/job-roles` / `locations` patterns; a new page
   copies `apps/web/src/pages/employees-page.tsx`).
5. Tell the owner in a few lines: what the next day is, what you'll build, any decision you
   need from them (with options and your recommendation). Then work through
   "How to work a day" below without stopping for routine choices.
6. End every session by updating the **Handoff note** in `PROJECT_PLAN.md` §2.

## Working with the owner

- Pratham (GitHub Shinzo27): ~1 year of professional JS/TS, multi-tenant HRM background.
  Shiftora is a portfolio project: **he must be able to explain every line in an interview**.
  Prefer clear, small, well-named code; short comments on *why*, not *what*.
- He has used **Prisma a lot and is learning Drizzle and NestJS** in depth: when you use a
  Drizzle or Nest pattern that differs from Prisma/Express habits, say so in one line in
  your summary.
- He decides quickly when given **numbered questions with a recommended option**. Ask only
  for real product/architecture decisions; pick sensible defaults for the rest and say so.
- Business/legal items (GST sign-off with a CA, domain/trademark) are deferred on purpose.
- Summaries in plain language: what changed, what was verified (with numbers), what's left,
  trade-offs, and a proposed Conventional Commit message. **He commits and pushes himself.**
- When he says "go" / "next day", do the ⏭ day from §14 end to end.

## How to work a day (the workflow this repo was built with)

1. Read the day's row in `PROJECT_PLAN.md` §14 (tasks + "done when") and the relevant
   sections of `ARCHITECTURE.md`. Check §5 (decisions) and §18 (follow-ups) for anything
   that affects the day. If a business rule is unclear, ask; don't invent one.
2. Build bottom-up in this order: `packages/domain` (pure functions + unit tests) →
   `packages/shared` (Zod schemas + tests) → `packages/db` (schema → `pnpm db:generate` →
   review and hand-edit the SQL → RLS section → integration tests) → API module
   (repository → service → controller → module → integration tests) → web.
3. Write tests first or alongside; follow the existing test files as templates
   (`packages/db/src/__tests__/*.int.test.ts`, `apps/api/src/modules/*/__tests__/*.int.test.ts`
   with `src/testing/test-app.ts`). Every new endpoint: role test (403), other-org test
   (404/invisible), scoped-manager test (404), and an audit-row check for writes.
4. Prove important tests can fail: temporarily break the code they guard (remove a scope
   filter, change a DST option), see the test go red, then restore the file exactly.
5. For UI work, run the app (`pnpm dev`) and check it in a real browser: the happy path,
   validation errors, light and dark mode, a 390 px phone width, no console errors, and a
   Lighthouse accessibility score ≥ 95. If your tool has no browser, list what the owner
   should click through.
6. Run everything: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int
   && pnpm build`. Report failures honestly.
7. Update the docs in the same change: `PROJECT_PLAN.md` (§2 status table and handoff note and "Numbers
   today", §5 decisions with the date, §10 data model, §11 endpoints and error codes, §14 day
   ✅ and next day ⏭, §18 follow-ups), plus `ARCHITECTURE.md`/`AGENTS.md` if a design or
   rule changed. Docs are how the next session (human or agent) knows where things stand.
8. Don't commit or push. Summarise what changed, what you verified and any trade-offs, and
   propose a Conventional Commit message. The owner commits from the personal account.

## Known gotchas (learned the hard way)

- **`pnpm dev` now starts three things**: the API, the web app and `@shiftora/worker` (relay +
  queue). The worker's `dev` script compiles once, then runs `tsc --watch` beside
  `node --watch`: without the first compile, `node --watch` races tsc and prints
  `MODULE_NOT_FOUND` on a clean checkout.
- **`engines` does not enforce anything; `scripts/require-node.mjs` does.** On Node 22
  `pnpm dev` dies inside the Nest watcher with `ERR_REQUIRE_CYCLE_MODULE` naming `ora`, which
  sends people hunting a broken dependency instead of the Node version. The guard runs from
  `predev`/`prebuild`/`pretest*`/`predb:*` in the root and in both apps — do not remove it, and
  run it directly (`node scripts/require-node.mjs`) when a tool reports a strange loader error.
- **`ON CONFLICT` cannot infer a partial unique index.** A unique index with a `WHERE` clause
  looks like the right key for "replay protection", and Postgres rejects it at runtime with
  `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification` —
  only a full index can be inferred. A plain `(outbox_id, recipient_email)` works for both staff
  rows and address-only ones because NULLs are distinct.
- **Sending throws to retry; it does not swallow.** `dispatchDelivery` returns
  `{status: 'retry', reason}` for a provider failure and the queue worker **throws** that reason,
  which is what makes BullMQ back off. Recording the failure and returning normally would mark
  the job complete and lose the message. A delivery already `sent` is a no-op, because the row —
  not the job — is the source of truth.
- **A `psql` session as `app_owner` sees nothing in a tenant table.** `FORCE ROW LEVEL
  SECURITY` applies to the owner too, so `select count(*) from outbox` answers `0` on a full
  table. Check with `begin; select set_config('app.org_id', '<uuid>', true); …; commit;` — or, for
  the whole tenant, `set_config('app.outbox_relay','on',true)` on `outbox` only. A "missing" row
  is almost always this, not a bug.
- **`pnpm db:seed` mints the org id before inserting the org.** RLS only accepts rows for the
  org the transaction points at, so a seed (or any direct insert) must `setTenantContext` with the
  id it is about to use — the same sequence `OrgsService.create` follows. Re-running the seed
  deletes the demo org first, so it is idempotent; it needs `MIGRATION_DATABASE_URL`, not the app
  URL, because it writes tenant rows on purpose.
- **A punch correction is wall clock, and the server converts it.** `PATCH /time-entries/:id`
  takes `clockInTime`/`clockOutTime` as `HH:MM` plus an optional `date`, never instants: the
  service calls `toInstant(day, time, location.timezone)`. A clock-out earlier than the clock-in
  means *the next morning* (an overnight shift), so the wall-clock form is what makes a night
  correction possible at all — with instants, the client would do zone arithmetic and every
  overnight fix would look invalid.
- **Read the audit trail through `AuditService.history()`, never by querying `audit_events`.**
  The table belongs to the audit module; the timesheet's history comes from that method so org
  scoping stays in one place. Writes go through `record()` inside the request transaction, which
  is what makes a correction and its reason impossible to separate.
- **`FormAlert` takes `message`, not children.** In `components/page.tsx` it is
  `({ message }: { message: string | null })`, so `<FormAlert>{text}</FormAlert>` fails the
  typecheck; `FieldError` next to it does take children.
- **drizzle-kit output needs review.** It once emitted a `UNIQUE (org_id, id)` after the
  foreign key that needed it (0004: moved up by hand). On a composite same-org FK, a plain
  `ON DELETE SET NULL` would also null `org_id`; write `ON DELETE SET NULL (column)` by hand
  (0005). Name unique constraints explicitly or drizzle-kit uses camelCase names.
- **New tenant table → add it to the list in `packages/db/src/__tests__/tenancy-rls.int.test.ts`**
  (the test fails on purpose until you do).
- **drizzle-kit emits constraints in the wrong order for composite foreign keys:** a
  `UNIQUE (org_id, id, …)` added in the same migration lands *after* the FK that needs it
  (0006: moved above by hand). Same file: re-check every `SET NULL` on a multi-column key.
- **Postgres `time` columns come back as `HH:MM:SS`**; the API speaks `HH:MM`.
- **Zod 4 runs `.superRefine` on the object even when a field already failed**, so
  cross-field checks must tolerate malformed fields (see `shiftTemplateIssue`).
- **Time:** use `packages/domain/src/time/zoned.ts` (`toInstant`, `toLocal`, `shiftTimes`,
  `weekBounds`, `startOfWeek`…), built on native `Temporal` (Node 26). Never add date
  libraries or do `Date` arithmetic for days/weeks.
- **Web:** TanStack Table is **v9** (`useTable` + `tableFeatures`, not `useReactTable`);
  read `node_modules/@tanstack/react-table/skills/` for the API. shadcn's `CommandDialog`
  needs its content wrapped in `<Command>`. Theme comes from `src/lib/theme.tsx`, not
  next-themes (React 19 warns about its injected script). Generated shadcn files may need
  small lint fixes (e.g. `hooks/use-mobile.ts` uses `useSyncExternalStore`).
- **Nest + Vitest:** tests compile with SWC (`unplugin-swc`); esbuild would drop the
  decorator metadata DI needs.
- **WebSockets on Fastify need an explicit adapter:** `app.useWebSocketAdapter(new IoAdapter(app))`
  in `main.ts`, or `@WebSocketGateway` silently never starts. It is installed in `main.ts` only,
  which is what keeps the gateway inert in tests (no port, no handles to close).
- **`@WebSocketGateway()` options run before dependency injection**, so the socket CORS origin is
  read from `process.env.WEB_ORIGIN` at module load — the single setting in the API that does not
  come from `AppConfig`. Don't "fix" it by injecting; the decorator cannot see DI.
- **A schedule's `version` moves on every shift write** (`SchedulesRepository.touch`), so a UI
  that shows "unpublished changes" must invalidate the schedule query too, not just shifts.
  `version > published_version` is the only correct test for that badge.
- **`react-hooks/purity` rejects `Date.now()`/`new Date()` during render**, even inside
  `useMemo`. When a list needs "now" (upcoming vs past), carry the moment out of the `queryFn`
  with the data instead of reading the clock in the component. `react-hooks/set-state-in-effect`
  also rejects a synchronous `setState` in an effect body: a live timer writes its state from
  the `setInterval` callback and keys it by the row id, so a stale tick cannot label a new punch.
- **Geolocation needs a secure context.** `localhost` counts; a phone on `http://192.168.x.x`
  does not — the browser refuses without ever prompting, which reads as a bug. Clock-in on a real
  handset needs https (mkcert or a tunnel). The same rule applies to `crypto.randomUUID`, which
  is why `newKey()` in the clock card keeps a fallback.
- **Playwright can fake the device:** `context.grantPermissions(["geolocation"], { origin })`
  plus `context.setGeolocation({ latitude, longitude, accuracy })`. A fresh browser context
  denies by default, which is exactly how the "permission refused" path is tested.
- **A `<div>` inside a `<dl>` may only wrap `dt`/`dd` pairs** — put an icon *inside* its `dt`, not
  beside it, or axe fails `definition-list` (use `components/definition-row.tsx`).
- **Routes are `lazy()`:** a new page needs the import at the top of `router.tsx`, and the shell
  that renders it provides the `Suspense` boundary (`OrgLayout` / `EmployeeLayout`), with one more
  around `RouterProvider` in `main.tsx` for the first chunk.
- **`vite preview` does not inherit `server.proxy`**, so the built app on :4173 cannot reach
  `/api` on :4000. Fine for manifest/service-worker checks; use `pnpm dev` for anything that
  needs data.
- **A composite FK needs a matching unique constraint on the target**, even when the PK already
  covers it logically: `time_entries (org_id, shift_id, location_id)` required
  `shifts (org_id, id, location_id)` — added by hand in 0008 next to the existing two-column one.
- **Partial unique indexes enforce "one open X" — but a violation kills the whole request**
  (`time_entries` has one open punch per employee). Postgres aborts the transaction on `23505`,
  so every statement after it answers `25P02`: you cannot re-read to explain yourself, and any
  audit write in the same request fails too. Do **not** catch-and-query. Serialise the contended
  case first with a transaction-scoped advisory lock
  (`select pg_advisory_xact_lock(hashtextextended($employeeId, 0))`), so the second caller
  waits, then *sees* the first row and answers 409 without ever provoking the index. Keep the
  catch as a bare 409 safety net — it must not touch the connection.
- **`Idempotency-Key` is a UUID generated by the client** and stored as `client_event_id`. Never
  derive it server-side (two identical requests are two punches).
- **Playwright waits on two readiness URLs, not one.** `pnpm dev` starts Vite (~1 s) and
  NestJS (~15 s) together, but the specs seed a clinic through the API before the browser
  opens: waiting only on the web app let the seed run while the API was still compiling, which
  is exactly how CI failed with `ECONNREFUSED :4000`. The config now declares one `webServer`
  entry per app (`/health/live` for the API) and CI runs `pnpm build` first, because those two
  processes import the workspace packages from their `dist` folders.
- **`pnpm format:check` is noisy on a CRLF checkout and quiet on CI.** Prettier wants LF, the
  working tree here is CRLF, so ~160 untouched files report a warning locally while the same
  job passes on Linux. Do not "fix" them by rewriting the tree: check only what you changed
  (`git diff --name-only <base>` piped into `npx prettier --check`) — and remember that a file
  edited by a script after formatting is exactly how a slow formatting failure reaches CI.
- **On Windows, Vite listens on `localhost` (IPv6 `::1`) only** while Nest binds `0.0.0.0`:
  `http://127.0.0.1:5173` refuses, `http://localhost:5173` works. Keep `baseURL` on
  `localhost`; the API is reachable on either.
- **Playwright needs a running stack:** `pnpm test:e2e` reuses a local `pnpm dev` and starts one
  in CI. The specs seed their own clinic through the API (the API must be on :4000, Postgres on
  5433); `@types/node` is a dev dependency of `apps/web` **only** so the specs and
  `playwright.config.ts` typecheck.
- **Never stop dev servers with `pkill -f` or `pgrep -f` on a pattern that appears in your own
  command line**: the shell running the command matches too and kills itself (exit 144). Find
  PIDs by port (`ss -ltnp | grep :4000`) or with a bracketed pattern (`ps -eo pid,args | grep
  '[w]orker/dist/main.js'`), then `kill` those.
- **WhatsApp/SMS run on a fake provider locally** (`WHATSAPP_PROVIDER=fake`,
  `FAKE_PROVIDER_FAILURE=transient|permanent|rate_limited` to inject failures). The worker reads
  env at start, so restart `pnpm dev` after changing it. A real retry cycle takes about
  1–2 minutes (5 s, 10 s, 20 s, 40 s ±50%); the Redis integration test uses a 10 ms backoff.
- **A dispatch result can carry `fallbackDeliveryId`**; the delivery worker queues it. Tests that
  assert a skip or failure exactly should use `toMatchObject`, since a fallback id is now added.
- **Delivery reports need the app secret on both sides.** The fake WhatsApp provider posts signed
  Meta webhooks to `FAKE_PROVIDER_REPORT_URL` only when `WHATSAPP_APP_SECRET` is set, and the API
  verifies with the same variable (one `.env` serves both). `FAKE_PROVIDER_FAILURE=undeliverable`
  = accepted, then reported failed → fallback to email a couple of seconds later.
- **Webhook signatures are over the raw bytes.** Both bootstraps (`main.ts`, `test-app.ts`) pass
  `rawBody: true`; `request.rawBody` is what `verifyMetaSignature` hashes. Re-serialising the
  parsed body would not match what Meta signed.
- **Reminders and missed clock-ins come from one repeatable job** (`alerts` queue, job scheduler
  `shift-alerts`, every `ALERT_SCAN_INTERVAL_MS`). Only shifts in the schedule's latest
  publication count: to see a reminder locally, publish a week with a shift starting within 2 h.
- **Logging is pino JSON, never `console`** (W7 D5). In the API use Nest's `Logger` (it writes
  through pino) or let the request line do it; in the worker call `log()` from
  `apps/worker/src/logging.ts`, which returns the current job's logger with `traceId`/`orgId`.
  A new consumer runs its processor inside `inJob(...)`; a job queued from inside another spreads
  `...traced()` into its data, or the trace stops there. Log the route pattern, ids and counts —
  never a URL with its query, an address, a token or a phone number.
- **The request id is the trace id.** `fastifyOptions()` makes Fastify's `genReqId` read
  `traceparent`; `configureApp` opens the trace scope in `onRequest`. `startTestApp({ logger })`
  takes a capturing logger when a test needs to read log lines; otherwise tests log nothing.
- **A data migration on a FORCEd-RLS table reads nothing — and says nothing.** The owner is bound
  by `FORCE ROW LEVEL SECURITY` too, so `INSERT … SELECT * FROM old_table` copies zero rows with no
  error (0026's first draft then dropped the full table). Before moving rows, `ALTER TABLE …
  NO FORCE ROW LEVEL SECURITY` on the source and `SET LOCAL row_security = off`, which turns a
  filtered read into an error; compare counts before any `DROP`. Prove it on a scratch database
  with rows in it — an empty test database passes either way.
- **`audit_events` is partitioned (ADR 021).** Its primary key is `(id, created_at)`. Never grant a
  partition to app_user or query one from app code: a partition read by name skips the parent's
  RLS. New months come from `ensure_audit_partitions()` (worker, daily); don't create them by hand.
- **Drizzle queries are lazy.** `void db.insert(...)` sends nothing: a query runs when it is
  awaited or `.then` is called. Fire-and-forget code must call `.then(ok, fail)` explicitly.
- **The messages E2E needs the worker.** Locally `pnpm dev` runs it; in CI Playwright starts it
  (waits for "worker: relaying"). Mailpit's API (`:8025/api/v1/search?query=to:"…"`) is how a
  spec checks an email arrived.
- **Worker wiring lives in `startPipeline`** (`apps/worker/src/pipeline.ts`): add a queue or
  consumer there, not in `main.ts`, or the end-to-end test stops covering it.
- **`startTestApp({ env, database })`**: extra env (a webhook secret, a `REDIS_URL`) and a shared
  database for a second API instance. Close the sharing apps before the one that owns it.
- `pnpm-workspace.yaml` blocks package versions younger than 7 days; if an install fails on
  that, use the previous version or wait, don't remove the setting.

## Non-negotiable rules

### Coverage and the auto-scheduler

- **A role-less coverage requirement needs its own uniqueness.** `coverage_requirements` has a
  plain unique index on (branch, weekday, start, role) **and** a partial one
  `WHERE job_role_id IS NULL` (`0024`): Postgres treats NULLs as distinct, so the plain index
  alone lets two identical "anyone at the branch" rows through. The same trap as the invite email
  index — prefer a partial index plus a caught `23505` over `ON CONFLICT`.
- **A unique violation here is a 409, not a 500.** `coverage.service.ts` catches `23505` through
  the cause chain (drizzle wraps query errors) and answers `coverage.already_exists`.
- **The solver contract lives in `packages/domain/scheduling/auto`** and is pure: no database, no
  clock. `expandWeek` is the only place `headcount` becomes repetition, and slot ids
  (`requirementId#index`) are stable so a re-run can be compared with the last one.

### The auto-scheduler

- **Postgres `time` comes back as `HH:MM:SS`**, and the domain's `toInstant`/`expandWeek` speak
  `HH:MM`. Trim with `.slice(0, 5)` when building a `ScheduleProblem`; a stray seconds field
  fails with `Expected an HH:MM time`.
- **`solve` is pure and takes its budget as an option**: no database, no ambient clock. The worker
  owns the transaction; the solver owns the thinking. Tests inject `now` to make the budget
  deterministic.
- **A re-run must not double the week.** The handler counts shifts by (local date, local start)
  and skips slots that are already covered — on insert *and* when reporting unfilled. Filtering
  only on insert leaves a successful second run looking like a wall of warnings.
- **Backtracking only undoes "busy"**: moving a shift frees a person; it cannot create a role or
  cancel leave. Blockers other than `already_working`/`min_rest` are left alone.
- **Only one run at a time per week.** The API refuses a second request while one is
  `queued`/`running` (`409 autofill.already_running`) instead of queueing two solvers that would
  both write shifts; the second would report a confusing "nothing to do".
- **The autofill route is throttled per *person*, not per IP** (`getTracker: trackerByUser`): a
  clinic shares one office address, so an IP key would let one busy manager lock out the rest. The
  throttler's tracker signature is `(request, context)`, not `(context)` — the other order makes
  every request 500 inside the guard.
- **Job progress goes over `shiftora:job-events`** (worker publishes, API re-emits to the org
  room). The channel name is duplicated in `apps/worker/src/queues.ts` and
  `apps/api/src/modules/realtime/job-events.service.ts` — change both or the bar stops.

### Claims, requests and idempotency

- **A claim is a conditional UPDATE, never a read-then-write.** `ShiftsRepository.claim` matches
  `status = 'open' AND employee_id IS NULL AND version = <the version you read>`; zero rows means
  someone else won, which is `409 shift.already_taken` — not an internal error and not a retry.
- **`POST /me/open-shifts/:id/claim` requires an `Idempotency-Key`** and must go through
  `IdempotencyService.run`: the reservation row is written before the work, and that row is what
  makes a retry return the first answer instead of a second shift. Do not call
  `OpenShiftsService.claim` directly from a new route.
- **`idempotency_keys` is scoped per organisation, route and key**, and stores the response body
  and status as jsonb. Reusing a key with a different request is refused loudly
  (`idempotency.key_reuse`), because that is a client bug rather than a retry.
- **Swap and drop requests only exist for published weeks** (`shift_request.not_published`);
  an unpublished shift is still a draft a manager edits directly. The web app shows the server's
  sentence instead of pre-hiding the button, so the rule lives in one place.

### Notifications, push and account mail

- **A channel with no sender is never offered, and never retried.** `sendableChannels(adapters)` is
  the policy the fan-out routes with, so a missing WhatsApp/SMS provider (or absent VAPID keys)
  drops that channel out of the ladder and the person still gets email. A delivery that reaches a
  sender-less channel anyway is `skipped` with a reason; `retry` is only for a provider failure a
  second attempt could fix.

- **A cross-tenant read is a switch, a `SELECT` policy on one table, and one query** (ADR 017,
  019): `app.outbox_relay` (outbox), `app.alert_scan` (organizations), `app.provider_report`
  (deliveries). Everything after the lookup runs under the found org's context. Don't add a
  fourth without an ADR.
- **A provider webhook never does tenant work in the request.** Verify the signature, write a
  platform outbox event, return 200; the worker finds and updates the delivery.
- **A platform event is an outbox row with `org_id IS NULL`** (`0014` + ADR 018). Insert it with
  `OutboxService.recordPlatform()`, which runs on its own connection: auth routes have no request
  transaction to join. Never open a tenant path for account mail.
- **`notifications.outbox_id` is `NOT NULL`** — a message always descends from an event. A test
  fixture that inserts a notification directly needs an outbox row first.
- **`psql` as `app_user` sees nothing** for tenant tables without `app.org_id` set — the RLS
  policy returns an empty set, not an error, which reads exactly like "the write did not happen".
  To inspect data by hand, connect as `postgres`: `docker exec shiftora-postgres-1 psql -U postgres -d shiftora`.
- **The service worker only exists in a build.** `vite-plugin-pwa` emits nothing in `dev`, so
  `navigator.serviceWorker.getRegistration()` is `null` there and push cannot work. Test push
  against `pnpm --filter @shiftora/web build` + `npx vite preview` (proxy configured), never `dev`.
- **`web-push` is imported dynamically** in `apps/worker`, so a worker without VAPID keys still
  boots and still sends email.

### Tenancy and security
- Every tenant table has `org_id uuid not null`, **RLS enabled and forced**, and a
  `tenant_isolation` policy on `current_org_id()`. A new table without an RLS policy is a bug
  (`packages/db/src/__tests__/tenancy-rls.int.test.ts` fails if you forget).
- Tenant repositories use `RequestContext.tx` (never the raw `DATABASE` pool) and **always
  filter by `this.context.orgId` explicitly**. RLS is the safety net, not the filter.
- Org routes need `X-Org-Id`; restrict them with `@Roles(...)`. Routes that need a user but
  no org use `@WithoutOrg()`. Changes to tenant data call `AuditService.record()`.
- Never connect as a superuser or a `BYPASSRLS` role from app code. Never disable RLS to make
  a query work.
- DB access goes through the request/job transaction that has `app.org_id` set
  (`set_config(..., true)` = transaction-local). Workers must set it from the job's `orgId`.
- Every new endpoint needs a role decision (`@Roles(...)` or deliberately any member) and an
  integration test proving another org's data is invisible (see
  `apps/api/src/modules/orgs/__tests__/tenancy.int.test.ts` and `src/testing/test-app.ts`).
- Never log secrets, tokens, phone numbers in full, or precise coordinates. That includes
  passwords, refresh cookies and `Authorization` headers.
- Every route requires a valid access token by default (global `JwtAuthGuard`). Use
  `@Public()` only for genuinely public endpoints, and get the caller with `@CurrentUser()`.
- Throw `AppException(status, code, detail)` with a code from `errorCodes`
  (`packages/shared`) for expected errors; the global filter renders RFC 7807. Validate
  bodies with `@Body(new ZodValidationPipe(schema))` using schemas from `packages/shared`.

### Multi-location and plans
- Assume an org has many locations. Location-bound tables carry `location_id` with a
  **same-org foreign key** `(org_id, location_id) → locations (org_id, id)` (FK checks ignore
  RLS). Every endpoint that takes or returns location data checks access through
  `LocationAccess` (`assertAccess` / `scope`), answers 404 outside the caller's scope, and has a
  scoped-manager test.
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
- Realtime events are **hints to refetch**, never data: emit them from the service after the
  write, catch failures (`RealtimeService` already does), and never let a socket problem fail a
  request. HTTP remains the source of truth.

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
- Frontend (`apps/web`): TanStack Query for server state, no global store; call the API only
  through `src/lib/api.ts` (it adds the token and `X-Org-Id` and refreshes single-flight); never
  store the access token in localStorage. UI is built from **shadcn/ui** components and the theme
  tokens (no one-off colours); icons from lucide-react, toasts with sonner, tables with TanStack
  Table, animation with Motion. Every screen needs skeleton, empty and error states, dark mode and
  a phone layout. Validate forms with the shared Zod schemas (react-hook-form for complex forms,
  from the shift editor on). Mobile-first for employee screens.
- Approved UI libraries (no need to ask): shadcn/ui and its Radix deps, lucide-react, sonner,
  cmdk, @tanstack/react-table, react-day-picker, vaul, motion, @dnd-kit/*, recharts,
  @fontsource-variable/inter, react-hook-form, @hookform/resolvers. Anything else: ask.
- Adding a shadcn component: `pnpm dlx shadcn@latest add <name>` from `apps/web`, then
  `pnpm format`. Colours come from the tokens in `src/index.css` (`primary`, `muted`,
  `brand`, `success`, `warning`, `chart-1..5`…); never hard-code a Tailwind palette colour.
  Theme: `useTheme()` from `src/lib/theme.tsx` (not next-themes). Org/location state:
  `useOrg()` from `src/lib/org-context.ts`.
- Naming: tables `snake_case` plural; link tables `<singular>_<plural>` (`employee_locations`);
  enums singular (`member_role`); columns `snake_case` (Drizzle maps to `camelCase` in TS);
  instants end in `_at`, money in `_minor`, durations in `_minutes`; events `entity.past_tense`
  (`schedule.published`).
- Two kinds of "role", never mixed up: `member_role` (owner/manager/employee/kiosk, what a
  user may DO, on `memberships`) and `job_roles` (Nurse, Receptionist…, what an employee IS,
  used by scheduling; referenced as `job_role_id`). Time away from work is `time_off`.
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
