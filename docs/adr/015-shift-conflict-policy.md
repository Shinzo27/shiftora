# ADR 015: Overlap blocks a shift; availability, time off, hours and rest only warn

- Status: Accepted
- Date: 2026-11-06

## Context

Placing a shift on a week can clash with an employee in five ways: they are already working at
that time, they are outside their recorded availability, they have time off booked, the week
would exceed their maximum hours, or too little rest surrounds the shift.

Two of these are facts about the world (one person cannot be in two places), the rest are
policies the business sets — and small clinics routinely break their own policies on purpose
(a nurse covering a colleague's leave, a receptionist doing a double before a holiday).

PRD F3 asks for "warnings for availability conflicts, overlap, max-hours and min-rest
violations", and the board shows conflicts as badges (W2 D4). The question was which of them
the API should refuse.

## Decision

- **Overlap is refused**: the database enforces it with
  `EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status = 'assigned'`,
  and the service checks first so the manager gets a message naming the shift in the way
  (`409 shift.overlap`) instead of a constraint error.
- **Availability, time off, max weekly hours and min rest are warnings**: pure functions in
  `packages/domain/src/scheduling/validation.ts` return
  `{ code, message, shiftId? }[]`, and the shift write returns `{ shift, warnings }`. Nothing
  is stored: warnings are recomputed from the employee's current rules every time.

## Alternatives considered

- **Block everything.** Safest on paper, but the manager's real workflow is "I know she's over
  her hours this week, the clinic is short-staffed" — a block would push them back to a
  spreadsheet, which is the product's whole problem.
- **Warn about overlap too.** Then the only guarantee is the database constraint, and a
  manager with two browser tabs would get an unfriendly 500-style failure. Keeping the
  service pre-check gives a useful message and still leaves the constraint as the last word.
- **Store warnings on the shift row.** They would go stale the moment availability, time off
  or another shift changes; recomputing is cheap (a handful of indexed queries per write).

## Consequences

- Overlap is guaranteed by the database, so two managers, a retried request or a future
  auto-scheduler cannot double-book even if the service layer is bypassed.
- Warnings are advisory: a schedule can be published with them (the manager sees the badge,
  the audit log records the change). W2 D5's publish diff and W7's coverage report can
  surface them again.
- Consumers must read warnings from the write response; `GET /shifts` returns shifts without
  them for now (revisit in W2 D4 if the board needs badges on load).
- Messages are phrased in the location's wall clock ("Not available Tue 18:00–22:00"),
  because that is what the manager sees on the board.
