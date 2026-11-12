# Shiftora

Shift scheduling and attendance for small businesses, clinics first: weekly schedules,
WhatsApp notifications, geofenced/QR clock-in from a PWA, shift swaps and payroll-ready
timesheets.

> Work in progress. Start with [PROJECT_PLAN.md](PROJECT_PLAN.md) (full context, status and
> day-by-day plan). Details: [PRD.md](PRD.md) for the product, [ARCHITECTURE.md](ARCHITECTURE.md)
> for the design and [AGENTS.md](AGENTS.md) for contribution rules.

## Stack

TypeScript monorepo (pnpm + Turborepo): NestJS API, BullMQ worker, React + Vite PWA,
PostgreSQL 16 with Row-Level Security, Drizzle ORM, Redis.

## Local setup

Requirements: **Node 26** (`.nvmrc`; native `Temporal`), pnpm 12, Docker.

Node 26 is not optional. On Node 22 the Nest watcher dies with
`ERR_REQUIRE_CYCLE_MODULE: Cannot require() ES Module ora … in a cycle`, which looks like a
broken dependency and is not one — so `scripts/require-node.mjs` runs before `dev`, `build`,
`test`, `db:migrate` and `db:seed` and says what is wrong in one sentence.

```bash
node -v            # v26.x — otherwise: nvm use / fnm use / volta install node@26
pnpm install
cp .env.example .env
pnpm infra:up      # Postgres on :5433, Redis on :6380, Mailpit UI on :8025
pnpm db:migrate
pnpm db:seed       # optional: the demo clinic (see below)
pnpm dev           # web on http://localhost:5173 (proxies /api), API on :4000
                   # auth: POST /api/v1/auth/{signup,login,refresh,logout}, GET /api/v1/auth/me
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build
```

**The demo clinic.** `pnpm db:seed` inserts Sunrise Clinic — two branches, four logins, three
staff, availability, a published week and a day of punches (one on time, one late, one outside the
fence). Sign in as `priya@sunriseclinic.test` / `demo-clinic-2026` (owner);
`asha@sunriseclinic.test` and `rohan@sunriseclinic.test` are staff logins for the clock card.
Re-running it replaces the demo org, so it is safe to repeat.

If port 5173 is already taken, Vite quietly moves to 5174 and the API's CORS origin no longer
matches — find the old server (`netstat -ano | findstr :5173` on Windows) and stop it rather than
testing against the wrong page.

## Continuing with an AI coding agent

Any agent (Claude Code, OpenCode, Codex, Cursor…) can pick up where the last session left
off. After cloning, give it:

> Read AGENTS.md and follow "Start of every session" to collect the context. Then do the
> next day marked ⏭ in PROJECT_PLAN.md §14, following "How to work a day". Don't commit;
> give me a summary and a commit message at the end, and update the handoff note.

## Repository layout

```
apps/
  api/       NestJS 12 (Fastify) HTTP API
  web/       React + Vite web app (manager dashboard)
packages/
  config/    shared TypeScript and ESLint presets
  shared/    Zod schemas and API types shared by api, worker and web
  db/        Drizzle schema, SQL migrations (incl. RLS), database client
  domain/    pure business logic (time, validation, pay rules, scheduler)
infra/       docker-compose and Postgres role setup for local services
```
