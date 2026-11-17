import { and, eq, inArray, schema, sql, type Database } from '@shiftora/db';
import {
  solve,
  toInstant,
  toLocal,
  type CoverageRequirement,
  type ScheduleProblem,
  type ScheduleSolution,
  type SchedulableEmployee,
} from '@shiftora/domain';
import type { UnfilledSlotView } from '@shiftora/shared';

export interface AutofillDeps {
  /** Publishes progress to the API, which forwards it to the manager's socket. */
  announce?: (event: { orgId: string; scheduleId: string; runId: string; status: string }) => void;
  budgetMs?: number;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type StaffRow = Awaited<ReturnType<typeof loadStaff>>[number];

interface Prepared {
  schedule: typeof schema.schedules.$inferSelect;
  zone: string;
  problem: ScheduleProblem;
}

/**
 * Runs the auto-scheduler for one week (W7 D3).
 *
 * The handler does the boring half: read the week's coverage, the people who could work it, their
 * availability and leave, and the shifts a manager already placed by hand. Then it hands a pure
 * `ScheduleProblem` to the solver and writes what comes back as **draft** shifts — nothing is
 * published, because a rota nobody has looked at is not a rota.
 *
 * Running it twice fills gaps rather than duplicating the week: a time already covered in the
 * schedule is skipped.
 */
export async function runAutofill(
  db: Database,
  event: { orgId: string; payload: unknown },
  deps: AutofillDeps = {},
): Promise<{ assigned: number; unfilled: number }> {
  const payload = (event.payload ?? {}) as { runId?: string; scheduleId?: string };
  const { runId, scheduleId } = payload;
  if (!runId || !scheduleId) return { assigned: 0, unfilled: 0 };
  const orgId = event.orgId;

  // Two transactions on purpose: the read ends before the solver starts, so no row stays locked
  // while it thinks, and the write sees whatever a manager changed in the meantime.
  const prepared = await db.transaction(async (tx) => {
    await setOrg(tx, orgId);
    await tx
      .update(schema.autofillRuns)
      .set({ status: 'running' })
      .where(and(eq(schema.autofillRuns.id, runId), eq(schema.autofillRuns.orgId, orgId)));
    return loadProblem(tx, orgId, scheduleId);
  });

  if (!prepared) return { assigned: 0, unfilled: 0 };

  const solution = solve(prepared.problem, { budgetMs: deps.budgetMs ?? 2_000 });
  deps.announce?.({ orgId, scheduleId, runId, status: 'solving' });

  return db.transaction(async (tx) => {
    await setOrg(tx, orgId);
    const result = await applySolution(tx, {
      orgId,
      scheduleId,
      zone: prepared.zone,
      prepared,
      solution,
    });

    await tx
      .update(schema.autofillRuns)
      .set({
        status: 'succeeded',
        strategy: solution.strategy,
        assigned: result.assigned,
        unfilled: result.unfilled,
        score: solution.score,
        finishedAt: new Date(),
      })
      .where(and(eq(schema.autofillRuns.id, runId), eq(schema.autofillRuns.orgId, orgId)));

    deps.announce?.({ orgId, scheduleId, runId, status: 'succeeded' });
    return { assigned: result.assigned, unfilled: result.unfilled.length };
  });
}

/** Reads one week into a `ScheduleProblem`: coverage, people, their limits, what is placed. */
async function loadProblem(tx: Tx, orgId: string, scheduleId: string): Promise<Prepared | null> {
  const [schedule] = await tx
    .select()
    .from(schema.schedules)
    .where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.orgId, orgId)));
  if (!schedule) return null;

  const [location] = await tx
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.id, schedule.locationId));
  const zone = location?.timezone ?? 'Asia/Kolkata';
  const weekStart = schedule.weekStart;
  const weekEnd = addDaysString(weekStart, 6);

  const requirements = await tx
    .select()
    .from(schema.coverageRequirements)
    .where(
      and(
        eq(schema.coverageRequirements.orgId, orgId),
        eq(schema.coverageRequirements.locationId, schedule.locationId),
      ),
    );

  const staff = await loadStaff(tx, orgId, schedule.locationId);
  const ids = staff.map((person) => person.id);
  const [roles, windows, leave] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as (typeof schema.employeeJobRoles.$inferSelect)[])
      : tx
          .select()
          .from(schema.employeeJobRoles)
          .where(inArray(schema.employeeJobRoles.employeeId, ids)),
    ids.length === 0
      ? Promise.resolve([] as (typeof schema.availability.$inferSelect)[])
      : tx.select().from(schema.availability).where(inArray(schema.availability.employeeId, ids)),
    ids.length === 0
      ? Promise.resolve([] as (typeof schema.timeOff.$inferSelect)[])
      : tx.select().from(schema.timeOff).where(inArray(schema.timeOff.employeeId, ids)),
  ]);

  const placed = await tx
    .select()
    .from(schema.shifts)
    .where(
      and(
        eq(schema.shifts.orgId, orgId),
        eq(schema.shifts.scheduleId, scheduleId),
        eq(schema.shifts.status, 'assigned'),
      ),
    );

  const problem: ScheduleProblem = {
    weekStart,
    requirements: requirements.map((row): CoverageRequirement => ({
      id: row.id,
      locationId: row.locationId,
      weekday: row.weekday,
      jobRoleId: row.jobRoleId,
      // Postgres `time` arrives as HH:MM:SS; the domain speaks HH:MM.
      startLocal: row.startLocal.slice(0, 5),
      endLocal: row.endLocal.slice(0, 5),
      headcount: row.headcount,
    })),
    employees: toEmployees({
      staff,
      roles,
      windows,
      leave,
      zone,
      weekStart,
      weekEnd,
      locationId: schedule.locationId,
    }),
    locked: placed.flatMap((shift) => {
      if (!shift.employeeId) return [];
      const start = toLocal(shift.startsAt, zone);
      const end = toLocal(shift.endsAt, zone);
      return [
        {
          employeeId: shift.employeeId,
          date: start.date,
          startLocal: start.time,
          endLocal: end.time,
        },
      ];
    }),
  };

  return { schedule, zone, problem };
}

/** The people who could work this branch at all; which shifts they can take is the solver's job. */
async function loadStaff(tx: Tx, orgId: string, locationId: string) {
  return tx
    .select({
      id: schema.employees.id,
      name: schema.employees.name,
      hourlyRateMinor: schema.employees.hourlyRateMinor,
      maxWeeklyMinutes: schema.employees.maxWeeklyMinutes,
      minRestMinutes: schema.employees.minRestMinutes,
    })
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.orgId, orgId),
        eq(schema.employees.status, 'active'),
        sql`exists (
          select 1 from employee_locations el
           where el.org_id = ${orgId}
             and el.employee_id = ${schema.employees.id}
             and el.location_id = ${locationId}
        )`,
      ),
    );
}

function toEmployees(input: {
  staff: StaffRow[];
  roles: (typeof schema.employeeJobRoles.$inferSelect)[];
  windows: (typeof schema.availability.$inferSelect)[];
  leave: (typeof schema.timeOff.$inferSelect)[];
  zone: string;
  weekStart: string;
  weekEnd: string;
  locationId: string;
}): SchedulableEmployee[] {
  const { staff, roles, windows, leave, zone, weekStart, weekEnd, locationId } = input;

  return staff.map((person) => ({
    id: person.id,
    name: person.name,
    // Everyone here was selected *for this branch*, so the list is one entry long by construction.
    locationIds: [locationId],
    jobRoleIds: roles.filter((row) => row.employeeId === person.id).map((row) => row.jobRoleId),
    hourlyRateMinor: person.hourlyRateMinor,
    maxWeeklyMinutes: person.maxWeeklyMinutes,
    minRestMinutes: person.minRestMinutes,
    availability: windows
      .filter((row) => row.employeeId === person.id)
      .map((row) => ({
        weekday: row.weekday,
        startLocal: row.startLocal.slice(0, 5),
        endLocal: row.endLocal.slice(0, 5),
      })),
    timeOff: leave
      .filter((row) => row.employeeId === person.id)
      .map((row) => toLocal(row.startsAt, zone).date)
      .filter((date) => date >= weekStart && date <= weekEnd),
  }));
}

/**
 * Writes the solution as draft shifts, and reports what could not be placed.
 *
 * Times already covered in this week are counted, not deduplicated: two slots at Monday 09:00
 * need two shifts, so one existing shift covers one of them. The count is consumed twice — while
 * inserting, so a re-run does not duplicate the week, and while filtering `unfilled`, so a re-run
 * that filled everything reads as "done" rather than as a wall of warnings.
 */
async function applySolution(
  tx: Tx,
  input: {
    orgId: string;
    scheduleId: string;
    zone: string;
    prepared: Prepared;
    solution: ScheduleSolution;
  },
): Promise<{ assigned: number; unfilled: UnfilledSlotView[] }> {
  const { orgId, scheduleId, zone, prepared, solution } = input;

  const covered = new Map<string, number>();
  for (const row of await tx
    .select({ startsAt: schema.shifts.startsAt })
    .from(schema.shifts)
    .where(and(eq(schema.shifts.orgId, orgId), eq(schema.shifts.scheduleId, scheduleId)))) {
    const local = toLocal(row.startsAt, zone);
    const key = `${local.date} ${local.time}`;
    covered.set(key, (covered.get(key) ?? 0) + 1);
  }

  const slotOf = indexSlots(prepared.problem);
  let assigned = 0;

  for (const assignment of solution.assignments) {
    const slot = slotOf.get(assignment.slotId);
    if (!slot) continue;

    const key = `${slot.date} ${slot.startLocal}`;
    const alreadyThere = covered.get(key) ?? 0;
    if (alreadyThere > 0) {
      covered.set(key, alreadyThere - 1);
      continue;
    }

    const start = toInstant(slot.date, slot.startLocal, zone);
    const end = toInstant(slot.date, slot.endLocal, zone);
    await tx.insert(schema.shifts).values({
      orgId,
      scheduleId,
      locationId: prepared.schedule.locationId,
      jobRoleId: slot.jobRoleId,
      employeeId: assignment.employeeId,
      startsAt: start,
      // An end at or before the start is an overnight shift: it belongs to the next morning.
      endsAt: end > start ? end : addDaysDate(end, 1),
      breakMinutes: 0,
      status: 'assigned',
    });
    assigned += 1;
  }

  if (assigned > 0) {
    // The board's version moves with its shifts, so an open tab refetches.
    await tx
      .update(schema.schedules)
      .set({ version: sql`${schema.schedules.version} + 1` })
      .where(eq(schema.schedules.id, scheduleId));
  }

  const unfilled: UnfilledSlotView[] = [];
  for (const slot of solution.unfilled) {
    const key = `${slot.date} ${slot.startLocal}`;
    const alreadyThere = covered.get(key) ?? 0;
    if (alreadyThere > 0) {
      covered.set(key, alreadyThere - 1);
      continue;
    }
    unfilled.push({
      id: slot.id,
      date: slot.date,
      startLocal: slot.startLocal,
      endLocal: slot.endLocal,
      jobRoleId: slot.jobRoleId,
      explanation: slot.explanation,
      blockers: slot.blockers.map((blocker) => ({
        employeeName: blocker.employeeName,
        detail: blocker.detail,
      })),
    });
  }

  return { assigned, unfilled };
}

/** What a slot means for the insert: the day it lands on, its hours, and the role it wants. */
interface SlotView {
  date: string;
  startLocal: string;
  endLocal: string;
  jobRoleId: string | null;
}

/** Slot id → what has to be written for it. Headcount repeats a requirement into N slots. */
function indexSlots(problem: ScheduleProblem): Map<string, SlotView> {
  return new Map<string, SlotView>(
    problem.requirements.flatMap((requirement) =>
      Array.from({ length: requirement.headcount }, (_unused, index) => {
        const date = addDaysString(problem.weekStart, requirement.weekday - 1);
        return [
          `${requirement.id}#${index}`,
          {
            date,
            startLocal: requirement.startLocal,
            endLocal: requirement.endLocal,
            jobRoleId: requirement.jobRoleId,
          },
        ] as const;
      }),
    ),
  );
}

async function setOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
}

function addDaysString(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function addDaysDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
