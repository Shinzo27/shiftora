import { and, eq, inArray, schema, sql, type Database } from '@shiftora/db';
import {
  solve,
  toInstant,
  toLocal,
  type CoverageRequirement,
  type ScheduleProblem,
  type SchedulableEmployee,
} from '@shiftora/domain';
import type { UnfilledSlotView } from '@shiftora/shared';

export interface AutofillDeps {
  /** Publishes progress to the API, which forwards it to the manager's socket. */
  announce?: (event: { orgId: string; scheduleId: string; runId: string; status: string }) => void;
  budgetMs?: number;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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

  const prepared = await db.transaction(async (tx) => {
    await setOrg(tx, orgId);
    await tx
      .update(schema.autofillRuns)
      .set({ status: 'running' })
      .where(and(eq(schema.autofillRuns.id, runId), eq(schema.autofillRuns.orgId, orgId)));

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

    const requirements = await tx
      .select()
      .from(schema.coverageRequirements)
      .where(
        and(
          eq(schema.coverageRequirements.orgId, orgId),
          eq(schema.coverageRequirements.locationId, schedule.locationId),
        ),
      );

    const staff = await tx
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
               and el.location_id = ${schedule.locationId}
          )`,
        ),
      );

    const ids = staff.map((person) => person.id);
    const [roles, windows, leave, placed] = await Promise.all([
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
      tx
        .select()
        .from(schema.shifts)
        .where(
          and(
            eq(schema.shifts.orgId, orgId),
            eq(schema.shifts.scheduleId, scheduleId),
            eq(schema.shifts.status, 'assigned'),
          ),
        ),
    ]);

    const weekStart = schedule.weekStart;
    const weekEnd = addDaysString(weekStart, 6);

    const employees: SchedulableEmployee[] = staff.map((person) => ({
      id: person.id,
      name: person.name,
      locationIds: [schedule.locationId],
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

    const problem: ScheduleProblem = {
      weekStart,
      requirements: requirements.map((row): CoverageRequirement => ({
        id: row.id,
        locationId: row.locationId,
        weekday: row.weekday,
        jobRoleId: row.jobRoleId,
        startLocal: row.startLocal.slice(0, 5),
        endLocal: row.endLocal.slice(0, 5),
        headcount: row.headcount,
      })),
      employees,
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
  });

  if (!prepared) return { assigned: 0, unfilled: 0 };

  const solution = solve(prepared.problem, { budgetMs: deps.budgetMs ?? 2_000 });
  deps.announce?.({ orgId, scheduleId, runId, status: 'solving' });

  return db.transaction(async (tx) => {
    await setOrg(tx, orgId);

    // Times already covered in this week, counted: two slots at Monday 09:00 need two shifts,
    // so one existing shift covers one of them and not both.
    const covered = new Map<string, number>();
    for (const row of await tx
      .select({ startsAt: schema.shifts.startsAt })
      .from(schema.shifts)
      .where(and(eq(schema.shifts.orgId, orgId), eq(schema.shifts.scheduleId, scheduleId)))) {
      const local = toLocal(row.startsAt, prepared.zone);
      const key = `${local.date} ${local.time}`;
      covered.set(key, (covered.get(key) ?? 0) + 1);
    }

    const slotOf = new Map<
      string,
      { date: string; startLocal: string; endLocal: string; jobRoleId: string | null }
    >(
      prepared.problem.requirements.flatMap((requirement) =>
        Array.from({ length: requirement.headcount }, (_unused, index) => {
          const date = addDaysString(prepared.problem.weekStart, requirement.weekday - 1);
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

      const start = toInstant(slot.date, slot.startLocal, prepared.zone);
      const end = toInstant(slot.date, slot.endLocal, prepared.zone);
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

    // A slot that already has a shift at its time is not "unfilled" — it is filled, by a manager
    // or by an earlier run. Reporting it would turn a successful re-run into a wall of warnings.
    const stillUnfilled = solution.unfilled.filter((slot) => {
      const key = `${slot.date} ${slot.startLocal}`;
      const alreadyThere = covered.get(key) ?? 0;
      if (alreadyThere === 0) return true;
      covered.set(key, alreadyThere - 1);
      return false;
    });

    const unfilled: UnfilledSlotView[] = stillUnfilled.map((slot) => ({
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
    }));

    await tx
      .update(schema.autofillRuns)
      .set({
        status: 'succeeded',
        strategy: solution.strategy,
        assigned,
        unfilled,
        score: solution.score,
        finishedAt: new Date(),
      })
      .where(and(eq(schema.autofillRuns.id, runId), eq(schema.autofillRuns.orgId, orgId)));

    deps.announce?.({ orgId, scheduleId, runId, status: 'succeeded' });
    return { assigned, unfilled: unfilled.length };
  });
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
