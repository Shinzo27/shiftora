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

## Auto-scheduler benchmark

"Fill from coverage" turns a branch's standing coverage into a week of draft shifts: greedy
(hardest slots first, scored on cost, fairness and stated availability) then bounded backtracking
inside a 2-second budget. Measured on a seeded clinic — 50 staff (nurses, doctors, reception,
pharmacy), round-the-clock coverage in three 8-hour shifts, availability, time off, a 40 or 48 h
weekly ceiling and 11 h rest — with every answer re-checked against every hard rule by an
independent checker:

| Week | Slots | Greedy p50 / p95 | `solve()` p50 / p95 | Filled | Backtracking adds | Fairness spread | Hard-rule breaches |
|---|---|---|---|---|---|---|---|
| 50 staff × 7 days | 133 | 78 ms / 194 ms | 96 ms / 245 ms | 100.0% | +0.0 | 22.4 h | 0 |
| 50 staff × 7 days, tight (1.8× demand) | 252 | 68 ms / 153 ms | 2001 ms / 2008 ms | 94.5% | +4.7 | 20.0 h | 0 |
| 100 staff × 7 days | 266 | 84 ms / 122 ms | 85 ms / 161 ms | 100.0% | +0.0 | 23.2 h | 0 |
| 200 staff × 7 days | 532 | 391 ms / 641 ms | 318 ms / 529 ms | 100.0% | +0.0 | 25.6 h | 0 |

Node 26.8, Intel i5-7500 (4 threads), seeds 1–20 (1–10 at 100 staff, 1–5 at 200), after one
warm-up run; the dev stack was running on the same machine, so the small timings jitter by tens of
milliseconds between runs. *Fairness spread* is the gap in hours between the most- and
least-rostered person. *Tight* means more coverage than the staff can legally work: the unfilled
5.5% come back with a reason each, e.g. "No one free for 2026-12-12 07:00–15:00 — 21 people would
not get enough rest, 15 people over their weekly hours, 7 people already working then".

**What the benchmark found.** The first run had tight weeks at **2.3 s p50 / 3.1 s p95 on a 2 s
budget**: the deadline was only checked between slots, and one backtracking step recomputed every
person's hours once per candidate. Computing it once per move, trying every shift a busy person
holds rather than only their first, and checking the deadline inside the loop gave the numbers
above: the budget kept (p95 2008 ms), **+4.7 slots a week from backtracking instead of +1.3**
(93.1% → 94.5% filled), and a fairer week (22.0 h → 20.0 h spread).

Reproduce: `pnpm --filter @shiftora/domain bench`
(`packages/domain/src/scheduling/auto/benchmark.ts`, `scripts/bench-scheduler.mjs`).

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
  worker/    BullMQ worker: outbox relay, notification fan-out, delivery senders
  web/       React + Vite web app (manager dashboard)
packages/
  config/    shared TypeScript and ESLint presets
  shared/    Zod schemas and API types shared by api, worker and web
  db/        Drizzle schema, SQL migrations (incl. RLS), database client
  domain/    pure business logic (time, validation, pay rules, scheduler)
infra/       docker-compose and Postgres role setup for local services
```
