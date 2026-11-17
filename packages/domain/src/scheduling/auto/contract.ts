import { addDays, startOfWeek, type LocalDate, type LocalTime } from '../../time/zoned.js';

/**
 * The auto-scheduler's contract (W7 D1).
 *
 * Pure types and one pure expansion, shared by the greedy solver (D2), the backtracking solver
 * (D3) and the worker that runs them. Nothing here touches a database: the API turns rows into a
 * `ScheduleProblem`, the solver answers with a `ScheduleSolution`, and the caller writes shifts.
 * That is what makes the hard part testable with fixtures instead of Postgres.
 */

/** A requirement's row, as the solver sees it: no ids of parents it does not need. */
export interface CoverageRequirement {
  id: string;
  locationId: string;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  jobRoleId: string | null;
  startLocal: LocalTime;
  endLocal: LocalTime;
  headcount: number;
}

/** One person needed, at one time, on one date. A requirement with headcount 2 makes two. */
export interface CoverageSlot {
  /** Stable across a run: `${requirementId}#${index}`, so an assignment can be traced back. */
  id: string;
  requirementId: string;
  locationId: string;
  date: LocalDate;
  startLocal: LocalTime;
  endLocal: LocalTime;
  jobRoleId: string | null;
}

/** A member of staff as the solver may treat them. */
export interface SchedulableEmployee {
  id: string;
  name: string;
  /** Branches they may work at, and roles they may work in. */
  locationIds: string[];
  jobRoleIds: string[];
  hourlyRateMinor: number;
  /** Null means no limit, which is what most small clinics actually have. */
  maxWeeklyMinutes: number | null;
  minRestMinutes: number | null;
  /** Their preferred weekly pattern. A preference: the solver weighs it, never obeys it. */
  availability: { weekday: number; startLocal: LocalTime; endLocal: LocalTime }[];
  /** Approved time off, by date. Hard: someone on leave is not a candidate. */
  timeOff: LocalDate[];
}

/** A shift the manager placed by hand. The solver must leave it, and route around it. */
export interface LockedShift {
  employeeId: string;
  date: LocalDate;
  startLocal: LocalTime;
  endLocal: LocalTime;
}

export interface ScheduleProblem {
  /** Monday of the week being filled, in the location's own calendar. */
  weekStart: LocalDate;
  requirements: CoverageRequirement[];
  employees: SchedulableEmployee[];
  locked: LockedShift[];
}

export interface Assignment {
  slotId: string;
  employeeId: string;
}

/** Why one person was not a candidate — the vocabulary of the explanations in D3. */
export type BlockerCode =
  'not_at_location' | 'missing_role' | 'time_off' | 'already_working' | 'max_hours' | 'min_rest';

export interface Blocker {
  employeeId: string;
  employeeName: string;
  code: BlockerCode;
  /** Ready to show: "over their weekly hours", "resting until 10:00". */
  detail: string;
}

/**
 * A slot nobody could take, with the reasons. Kept in the solution rather than thrown, because
 * "we could not fill Tuesday night" is the answer a manager needs most.
 */
export interface UnfilledSlot extends Omit<CoverageSlot, 'id'> {
  id: string;
  blockers: Blocker[];
  /** One sentence, built from the blockers: "No one free for Tue 22:00 — 2 over max hours." */
  explanation: string;
}

export interface SolutionScore {
  /** Estimated cost of the assigned slots at each person's hourly rate. */
  costMinor: number;
  /** How evenly the week is spread: 0 is perfectly even, higher is more lopsided. */
  fairnessSpreadMinutes: number;
  /** How many assignments match the person's stated availability. */
  preferenceMatches: number;
  /** Unfilled slots, weighted: the solver's most important number. */
  unfilledSlots: number;
}

export interface ScheduleSolution {
  weekStart: LocalDate;
  assignments: Assignment[];
  unfilled: UnfilledSlot[];
  score: SolutionScore;
  /** What the solver did, for the log and the UI: "greedy", "greedy+backtracking". */
  strategy: string;
  /** Wall-clock milliseconds it took, useful when the same week is re-run. */
  tookMs: number;
}

/** Monday of the week a date falls in, so a slot's date is always inside `[weekStart, +6]`. */
export function weekStartFor(date: LocalDate): LocalDate {
  return startOfWeek(date);
}

/** The date of `weekday` (1 = Monday) inside the week that starts at `weekStart`. */
export function dateOfWeekday(weekStart: LocalDate, weekday: number): LocalDate {
  return addDays(weekStart, weekday - 1);
}

/**
 * Requirements → the slots a week needs. Pure, and the one place `headcount` becomes repetition:
 * a requirement for two nurses is two slots that the solver fills independently, because it may
 * well be two different people.
 */
export function expandWeek(
  problem: Pick<ScheduleProblem, 'weekStart' | 'requirements'>,
): CoverageSlot[] {
  const { weekStart, requirements } = problem;
  return requirements.flatMap((requirement) => {
    const date = dateOfWeekday(weekStart, requirement.weekday);
    return Array.from({ length: requirement.headcount }, (_unused, index) => ({
      id: `${requirement.id}#${index}`,
      requirementId: requirement.id,
      locationId: requirement.locationId,
      date,
      startLocal: requirement.startLocal,
      endLocal: requirement.endLocal,
      jobRoleId: requirement.jobRoleId,
    }));
  });
}
