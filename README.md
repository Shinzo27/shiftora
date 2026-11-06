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

Requirements: Node 26, pnpm 12, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # Postgres on :5433, Redis on :6379, Mailpit UI on :8025
pnpm db:migrate
pnpm dev           # web on http://localhost:5173 (proxies /api), API on :4000
                   # auth: POST /api/v1/auth/{signup,login,refresh,logout}, GET /api/v1/auth/me
pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build
```

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
