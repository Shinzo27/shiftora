# Shiftora — claim-race results

Measured 2026-11-24 on the local development stack.

## Environment

| | |
|---|---|
| OS / Node | Windows 11 · Node 26.13.1 |
| Services | PostgreSQL 16-alpine, Redis 7.4-alpine (docker compose, `infra/docker-compose.yml`) |
| API | built bundle (`node dist/main.js`), NestJS + Fastify |
| Data | seeded Sunrise Clinic — 2 locations, 3 staff, 1 published week from 2026-11-23 |

## What was tested

Concurrent claims on the **same open shift** by several eligible staff. The question is
not throughput — it is whether two people can end up holding one shift.

Setup the harness performs (re-seed to undo):

- the seed gives each staff member a **different** role and location, so no two people are
  eligible for the same shift; the harness grants all three the Nurse role at Andheri,
  otherwise a "race" would have a single eligible racer and prove nothing;
- it creates open shifts (`employeeId: null`) and offers them (`POST /shifts/:id/offer`) —
  a shift is not claimable until offered.

## Results

| Metric | Value |
|---|---|
| Races run | 10 |
| Concurrent claims per race | 3 |
| Total concurrent claims | 30 |
| Races with **exactly one winner** | **8 / 8** (of races that had an eligible racer) |
| Races with **more than one winner** | **0** |
| Races with no winner | 2 — all three racers were already booked on those slots; the eligibility guard refused everyone, which is correct behaviour |
| HTTP 200 | 8 |
| HTTP 409 | 22 (`shift.already_taken`, `shift_request.not_eligible`) |
| 5xx | 0 |
| Claim latency | p50 **20 ms**, p95 **51 ms**, max 52 ms |

## What this proves

- The optimistic version check on the shift row prevents a lost update: of three
  simultaneous claims, exactly one is persisted as the assignee.
- Idempotency keys are enforced at the route level, so a retry returns the first answer
  instead of creating a second claim.
- Ineligibility (overlapping shift, wrong role, wrong location) is rejected before the
  write, not after.

## Caveats

- **Not a throughput benchmark.** Racer count is capped by the seed's three staff accounts;
  this measures correctness at low concurrency, not capacity.
- Two races had no eligible racer by design of the seed week, so the denominator for
  "exactly one winner" is 8, not 10.
- Database-level verification is implicit: a shift row holds a single `employee_id`, so a
  duplicate assignment would require the lost-update the version check prevents. The
  200-count is the evidence.

## Reproduce

```bash
pnpm infra:up          # postgres + redis, waits for health
pnpm db:migrate
pnpm db:seed
node scripts/claim-race.mjs --rounds 10
```

Raw output: [`metrics/claim-race.json`](./claim-race.json)

---

# Shiftora — HTTP capacity (autocannon)

Measures a different question from the claim race: raw request capacity per endpoint.
Run 2026-11-24 · Windows 11 · 12 cores · 16 GB · Node 26.13.1 · 50 connections · 10 s per endpoint.

| Endpoint | Req/s | p50 | p99 | non-2xx |
|---|---|---|---|---|
| `/health/live` (no DB — framework baseline) | **15,797** | 2 ms | 8 ms | 0 |
| `/schedules` (auth + query) | **916** | 52 ms | 85 ms | 0 |
| `/me/open-shifts` (auth + RLS + eligibility) | **297** | 162 ms | 327 ms | 0 |

Two runs produced 15,134 / 15,797 and 872 / 916 req/s, so the baseline and the schedule
read are stable to within ~5%.

## The finding worth keeping

`/me/open-shifts` is **5× slower than a plain schedule read** despite returning far fewer
rows. It is the only endpoint that computes eligibility per shift — role match, location
scope, overlap, rest and hour limits, time off — so the cost is in assessment, not I/O.
That is the honest bottleneck in this system, and it is the next thing to fix (cache the
assessment per (employee, shift) or precompute at offer time).

Reporting the number without saying that would be the equivalent of quoting a benchmark
you never profiled.

## Reproduce

```bash
node scripts/http-load.mjs --connections 50 --duration 10
```

Raw output: [`metrics/http-load.json`](./http-load.json)

