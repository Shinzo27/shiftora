import type {
  Assignment,
  Blocker,
  CoverageSlot,
  ScheduleProblem,
  ScheduleSolution,
  SchedulableEmployee,
  SolutionScore,
  UnfilledSlot,
} from './contract.js';
import { expandWeek } from './contract.js';

/**
 * The greedy solver (W7 D2).
 *
 * Fill the hardest slots first, the ones with the fewest people who could take them: a Tuesday
 * night slot that only one nurse can do must not be left until last, when she has already been
 * given three easier days. Within a slot, score the candidates and take the cheapest sensible
 * person; "cheapest" weighs money, fairness, stated availability and the weekend/night load, in
 * that order of importance.
 *
 * This is deliberately not clever. D3 adds bounded backtracking for the cases where greedy paints
 * itself into a corner; everything here stays deterministic and pure so it can be tested without
 * a clock or a database.
 */

const MINUTES_PER_DAY = 24 * 60;

/** "HH:MM" → minutes from midnight. The values come from Postgres `time` and are trusted. */
function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** A slot that ends before it starts runs past midnight: Sunday 22:00–06:00 is eight hours. */
function durationMinutes(slot: { startLocal: string; endLocal: string }): number {
  const start = minutesOf(slot.startLocal);
  const end = minutesOf(slot.endLocal);
  return end > start ? end - start : end + MINUTES_PER_DAY - start;
}

interface Span {
  date: string;
  start: number;
  /** Absolute minute on the slot's own day; can exceed 1440 for an overnight shift. */
  end: number;
}

function spanOf(slot: { date: string; startLocal: string; endLocal: string }): Span {
  const start = minutesOf(slot.startLocal);
  const end = start + durationMinutes(slot);
  return { date: slot.date, start, end };
}

/** Two spans on the same date overlap, or touch across midnight into the next date. */
function overlaps(a: Span, b: Span): boolean {
  if (a.date === b.date) return a.start < b.end && b.start < a.end;
  // Overnight spill: a Monday 22:00–06:00 shift owns Tuesday 00:00–06:00.
  const dayGap = Math.abs(dayIndex(a.date) - dayIndex(b.date));
  if (dayGap !== 1) return false;
  const [earlier, later] = a.date < b.date ? [a, b] : [b, a];
  return earlier.end > MINUTES_PER_DAY && later.start < earlier.end - MINUTES_PER_DAY;
}

export function dayIndex(date: string): number {
  // Enough for ordering and adjacency: days since the epoch, in UTC, no clock maths.
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export interface Load {
  spans: Span[];
  minutes: number;
  nights: number;
  weekendDays: number;
}

export const emptyLoad = (): Load => ({ spans: [], minutes: 0, nights: 0, weekendDays: 0 });

function isNight(slot: { startLocal: string; endLocal: string }): boolean {
  const start = minutesOf(slot.startLocal);
  const end = minutesOf(slot.endLocal);
  // Starts at or after 22:00, or ends at or before 06:00 (which includes the overnight case).
  return start >= 22 * 60 || end <= 6 * 60;
}

export function addTo(
  load: Load,
  slot: { date: string; startLocal: string; endLocal: string },
  weekday: number,
): void {
  load.spans.push(spanOf(slot));
  load.minutes += durationMinutes(slot);
  if (isNight(slot)) load.nights += 1;
  if (weekday >= 6) load.weekendDays += 1;
}

/** What stops this person taking this slot, if anything. Empty means they could. */
export function blockersFor(
  employee: SchedulableEmployee,
  slot: CoverageSlot,
  load: Load,
): Blocker[] {
  const blockers: Blocker[] = [];
  const name = employee.name;

  if (!employee.locationIds.includes(slot.locationId)) {
    blockers.push({
      employeeId: employee.id,
      employeeName: name,
      code: 'not_at_location',
      detail: 'not at this branch',
    });
  }
  if (slot.jobRoleId && !employee.jobRoleIds.includes(slot.jobRoleId)) {
    blockers.push({
      employeeId: employee.id,
      employeeName: name,
      code: 'missing_role',
      detail: 'not qualified for this role',
    });
  }
  if (employee.timeOff.includes(slot.date)) {
    blockers.push({
      employeeId: employee.id,
      employeeName: name,
      code: 'time_off',
      detail: 'on approved time off',
    });
  }

  const candidate = spanOf(slot);
  if (load.spans.some((span) => overlaps(span, candidate))) {
    blockers.push({
      employeeId: employee.id,
      employeeName: name,
      code: 'already_working',
      detail: 'already working then',
    });
  }

  if (
    employee.maxWeeklyMinutes !== null &&
    load.minutes + durationMinutes(slot) > employee.maxWeeklyMinutes
  ) {
    blockers.push({
      employeeId: employee.id,
      employeeName: name,
      code: 'max_hours',
      detail: 'over their weekly hours',
    });
  }

  if (employee.minRestMinutes !== null && restBreach(load, candidate, employee.minRestMinutes)) {
    blockers.push({
      employeeId: employee.id,
      employeeName: name,
      code: 'min_rest',
      detail: 'would not get enough rest',
    });
  }

  return blockers;
}

/** Rest is measured to the nearest shift either side, ignoring the day boundary. */
function restBreach(load: Load, candidate: Span, minRest: number): boolean {
  return load.spans.some((span) => {
    const gap = gapMinutes(span, candidate);
    return gap !== null && gap < minRest;
  });
}

/** Minutes between two spans on adjacent days, or null when they are further apart. */
function gapMinutes(a: Span, b: Span): number | null {
  const days = Math.abs(dayIndex(a.date) - dayIndex(b.date));
  if (days > 1) return null;
  const [earlier, later] =
    a.date < b.date || (a.date === b.date && a.start <= b.start) ? [a, b] : [b, a];
  if (earlier.date === later.date) {
    // Same day: the gap is between the end of the first and the start of the second.
    return later.start - earlier.end;
  }
  return later.start + MINUTES_PER_DAY - earlier.end;
}

/**
 * Lower is better, and the four parts are in comparable units so the weights mean something:
 *
 * - **cost** is normalised against the most expensive candidate for this slot (0–1), so a pricey
 *   nurse is not penalised twice on a cheap shift;
 * - **fairness** counts ten hours already assigned as half a unit — enough to outweigh 25% of a
 *   cost difference, which is exactly the trade a manager would make rather than work one person
 *   into the ground;
 * - **preference** is a flat penalty for working outside the person's stated availability: a
 *   preference, not a rule (the contract says so, and the eligibility code already treats it as
 *   advisory);
 * - **balance** penalises piling nights and weekend days onto someone who already has them.
 */
const WEIGHT = { cost: 1, fairness: 0.5, preference: 0.4, balance: 0.3 } as const;

/** One fairness unit: how many minutes of work count as "a fair amount already". */
const FAIRNESS_UNIT_MINUTES = 600;

function normalisedCost(
  employee: SchedulableEmployee,
  slot: CoverageSlot,
  maxCostMinor: number,
): number {
  if (maxCostMinor <= 0) return 0;
  return (employee.hourlyRateMinor * durationMinutes(slot)) / 60 / maxCostMinor;
}

function scoreCandidate(
  employee: SchedulableEmployee,
  slot: CoverageSlot,
  load: Load,
  weekday: number,
  maxCostMinor: number,
): number {
  const cost = WEIGHT.cost * normalisedCost(employee, slot, maxCostMinor);

  // Ten hours already on the rota is half a unit: a light day more than a heavy one.
  const fairness = WEIGHT.fairness * (load.minutes / FAIRNESS_UNIT_MINUTES);

  const preferred = employee.availability.some(
    (window) =>
      window.weekday === weekday &&
      minutesOf(window.startLocal) <= minutesOf(slot.startLocal) &&
      minutesOf(window.endLocal) >= minutesOf(slot.startLocal) + durationMinutes(slot),
  );
  const preference = preferred ? 0 : WEIGHT.preference;

  const unsociable = weekday >= 6 || isNight(slot);
  const balance = unsociable ? WEIGHT.balance * (load.nights + load.weekendDays) : 0;

  return cost + fairness + preference + balance;
}

/** ISO weekday (1–7) of a date inside the week that starts at `weekStart`. */
export function weekdayIndex(weekStart: string, date: string): number {
  return ((((dayIndex(date) - dayIndex(weekStart)) % 7) + 7) % 7) + 1;
}

/**
 * The load each person carries, from hand-placed shifts plus whatever has been assigned. Shared
 * with the backtracking solver so there is one definition of "how busy is this person".
 */
export function loadsFor(problem: ScheduleProblem, assignments: Assignment[]): Map<string, Load> {
  const load = new Map<string, Load>(
    problem.employees.map((employee) => [employee.id, emptyLoad()]),
  );
  const slots = new Map(expandWeek(problem).map((slot) => [slot.id, slot]));

  for (const locked of problem.locked) {
    const owner = load.get(locked.employeeId);
    if (owner) addTo(owner, locked, weekdayIndex(problem.weekStart, locked.date));
  }
  for (const assignment of assignments) {
    const slot = slots.get(assignment.slotId);
    const owner = load.get(assignment.employeeId);
    if (slot && owner) addTo(owner, slot, weekdayIndex(problem.weekStart, slot.date));
  }
  return load;
}

/** One sentence a manager can read without opening anything else. */
export function explain(slot: CoverageSlot, blockers: Blocker[], employees: number): string {
  const when = `${slot.date} ${slot.startLocal}–${slot.endLocal}`;
  if (employees === 0) return `Nobody works at this branch yet, so ${when} has no candidates.`;
  if (blockers.length === 0) return `No one free for ${when}.`;

  const byReason = new Map<string, number>();
  for (const blocker of blockers) {
    byReason.set(blocker.detail, (byReason.get(blocker.detail) ?? 0) + 1);
  }
  const parts = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([detail, count]) => `${count} ${count === 1 ? 'person' : 'people'} ${detail}`);
  return `No one free for ${when} — ${parts.join(', ')}.`;
}

export interface GreedyOptions {
  /** Injected so the caller can stop early (D3) and so tests are deterministic. */
  shouldStop?: () => boolean;
}

/**
 * Fills the week, hardest slots first. Returns the solution even when it is incomplete: the
 * unfilled slots carry the reasons, which is the useful half of the answer.
 */
export function solveGreedy(
  problem: ScheduleProblem,
  options: GreedyOptions = {},
): ScheduleSolution {
  const startedAt = Date.now();
  const slots = expandWeek(problem);
  const employees = problem.employees;
  const load = new Map<string, Load>(employees.map((employee) => [employee.id, emptyLoad()]));

  // Locked shifts are already on the rota: they consume hours, create overlaps and count for rest.
  for (const locked of problem.locked) {
    const owner = load.get(locked.employeeId);
    if (!owner) continue;
    const weekday = ((((dayIndex(locked.date) - dayIndex(problem.weekStart)) % 7) + 7) % 7) + 1;
    addTo(owner, locked, weekday);
  }

  const weekdayOf = (date: string) =>
    ((((dayIndex(date) - dayIndex(problem.weekStart)) % 7) + 7) % 7) + 1;

  // Hardest first: the slots with the fewest possible people are decided while everyone is free.
  const order = slots
    .map((slot) => ({
      slot,
      candidates: employees.filter(
        (employee) => blockersFor(employee, slot, load.get(employee.id)!).length === 0,
      ).length,
    }))
    .sort(
      (a, b) =>
        a.candidates - b.candidates ||
        a.slot.date.localeCompare(b.slot.date) ||
        a.slot.id.localeCompare(b.slot.id),
    );

  const assignments: Assignment[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const { slot } of order) {
    if (options.shouldStop?.()) {
      unfilled.push({
        ...slot,
        blockers: [],
        explanation: 'The solver ran out of time before it reached this slot.',
      });
      continue;
    }

    const weekday = weekdayOf(slot.date);
    let best: { employee: SchedulableEmployee; score: number } | null = null;
    const blockers: Blocker[] = [];
    // Cost is scored relative to the priciest candidate for this slot, so the weights hold.
    const maxCostMinor = Math.max(
      0,
      ...employees.map((employee) => (employee.hourlyRateMinor * durationMinutes(slot)) / 60),
    );

    for (const employee of employees) {
      const personLoad = load.get(employee.id)!;
      const reasons = blockersFor(employee, slot, personLoad);
      if (reasons.length > 0) {
        blockers.push(...reasons);
        continue;
      }
      const score = scoreCandidate(employee, slot, personLoad, weekday, maxCostMinor);
      if (best === null || score < best.score) best = { employee, score };
    }

    if (best) {
      assignments.push({ slotId: slot.id, employeeId: best.employee.id });
      addTo(load.get(best.employee.id)!, slot, weekday);
    } else {
      unfilled.push({ ...slot, blockers, explanation: explain(slot, blockers, employees.length) });
    }
  }

  return {
    weekStart: problem.weekStart,
    assignments,
    unfilled,
    score: scoreSolution(problem, assignments, unfilled, load),
    strategy: 'greedy',
    tookMs: Date.now() - startedAt,
  };
}

export function scoreSolution(
  problem: ScheduleProblem,
  assignments: Assignment[],
  unfilled: UnfilledSlot[],
  load: Map<string, Load>,
): SolutionScore {
  const slots = new Map(expandWeek(problem).map((slot) => [slot.id, slot]));
  const byId = new Map(problem.employees.map((employee) => [employee.id, employee]));

  let costMinor = 0;
  let preferenceMatches = 0;
  for (const assignment of assignments) {
    const slot = slots.get(assignment.slotId);
    const employee = byId.get(assignment.employeeId);
    if (!slot || !employee) continue;
    costMinor += Math.round((employee.hourlyRateMinor * durationMinutes(slot)) / 60);

    const weekday = ((((dayIndex(slot.date) - dayIndex(problem.weekStart)) % 7) + 7) % 7) + 1;
    const preferred = employee.availability.some(
      (window) =>
        window.weekday === weekday &&
        minutesOf(window.startLocal) <= minutesOf(slot.startLocal) &&
        minutesOf(window.endLocal) >= minutesOf(slot.startLocal) + durationMinutes(slot),
    );
    if (preferred) preferenceMatches += 1;
  }

  const minutes = [...load.values()].map((entry) => entry.minutes);
  const fairnessSpreadMinutes =
    minutes.length === 0 ? 0 : Math.max(...minutes) - Math.min(...minutes);

  return {
    costMinor,
    fairnessSpreadMinutes,
    preferenceMatches,
    unfilledSlots: unfilled.length,
  };
}
