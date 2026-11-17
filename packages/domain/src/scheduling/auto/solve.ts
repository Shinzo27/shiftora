import type {
  Assignment,
  CoverageSlot,
  ScheduleProblem,
  ScheduleSolution,
  SchedulableEmployee,
  UnfilledSlot,
} from './contract.js';
import { expandWeek } from './contract.js';
import { blockersFor, loadsFor, scoreSolution, solveGreedy } from './greedy.js';

/**
 * Greedy, then a bounded amount of undoing (W7 D3).
 *
 * Greedy cannot see past the slot in front of it: it may spend the only nurse who can work Friday
 * night on an easy Thursday, and then nothing can fill Friday. Backtracking fixes exactly that by
 * moving an earlier assignment to somebody else so the blocked slot can have the person it needs.
 *
 * The budget is wall-clock, not a depth limit, because the contract with the caller is "this
 * returns": a pathological week must not hold a manager's screen hostage.
 */

export interface SolveOptions {
  /** Milliseconds of searching after which it stops optimising. Default 2000. */
  budgetMs?: number;
  /** Injected for tests, so a budget can be made deterministic. */
  now?: () => number;
}

/** What one improvement pass works on. Replaced wholesale, never mutated. */
interface State {
  assignments: Assignment[];
  unfilled: UnfilledSlot[];
}

/** The answer to "could this person take this slot, given what is already assigned?". */
function couldTake(
  employee: SchedulableEmployee | undefined,
  loads: ReturnType<typeof loadsFor>,
  slot: CoverageSlot,
  employeeId: string,
): boolean {
  const load = loads.get(employeeId);
  if (!employee || !load) return false;
  return blockersFor(employee, slot, load).length === 0;
}

/**
 * Solves a week: greedy first, then narrow backtracking on whatever it could not fill.
 *
 * The search tries one move at a time — move the shift of somebody who is only *busy*, and see
 * whether the blocked slot can then take them. One level deep, repeated while the budget lasts.
 * That catches "the wrong person got the easy shift" without becoming a solver nobody can reason
 * about.
 */
export function solve(problem: ScheduleProblem, options: SolveOptions = {}): ScheduleSolution {
  const startedAt = Date.now();
  const now = options.now ?? (() => Date.now());
  const deadline = now() + (options.budgetMs ?? 2_000);

  const greedy = solveGreedy(problem);
  if (greedy.unfilled.length === 0) {
    return { ...greedy, strategy: 'greedy', tookMs: now() - startedAt };
  }

  const slots = new Map(expandWeek(problem).map((slot) => [slot.id, slot]));
  const employees = new Map(problem.employees.map((employee) => [employee.id, employee]));

  let state: State = { assignments: [...greedy.assignments], unfilled: [...greedy.unfilled] };
  let moves = 0;
  let improved = true;

  while (improved && now() < deadline) {
    improved = false;

    for (const blocked of state.unfilled) {
      if (now() >= deadline) break;
      const slot = slots.get(blocked.id);
      if (!slot) continue;

      // Only "busy" is fixable by moving somebody; a missing role or a day of leave is not.
      const busy = new Set(
        blocked.blockers
          .filter((blocker) => blocker.code === 'already_working' || blocker.code === 'min_rest')
          .map((blocker) => blocker.employeeId),
      );

      const next = attemptSwap(problem, employees, slots, state, slot, busy);
      if (!next) continue;

      state = next;
      moves += 1;
      improved = true;
      break;
    }
  }

  // Re-score what we ended with: the greedy numbers no longer describe this week.
  const score = scoreSolution(
    problem,
    state.assignments,
    state.unfilled,
    loadsFor(problem, state.assignments),
  );

  return {
    weekStart: problem.weekStart,
    assignments: state.assignments,
    unfilled: state.unfilled,
    score,
    strategy: moves === 0 ? 'greedy' : 'greedy+backtracking',
    tookMs: now() - startedAt,
  };
}

/**
 * One attempt: can the blocked slot be filled by moving somebody else's shift to a third person?
 * Returns the next state or null — a new value, so nothing already computed is mutated.
 */
function attemptSwap(
  problem: ScheduleProblem,
  employees: Map<string, SchedulableEmployee>,
  slots: Map<string, CoverageSlot>,
  state: State,
  slot: CoverageSlot,
  busy: Set<string>,
): State | null {
  for (const mover of busy) {
    const theirs = state.assignments.find((assignment) => assignment.employeeId === mover);
    if (!theirs) continue;
    const theirSlot = slots.get(theirs.slotId);
    if (!theirSlot) continue;

    for (const alternative of problem.employees) {
      if (alternative.id === mover) continue;

      const withoutTheirs = state.assignments.filter((assignment) => assignment !== theirs);
      const loadsAfterMove = loadsFor(problem, withoutTheirs);

      if (!couldTake(employees.get(alternative.id), loadsAfterMove, theirSlot, alternative.id)) {
        continue;
      }
      if (!couldTake(employees.get(mover), loadsAfterMove, slot, mover)) continue;

      return {
        assignments: [
          ...withoutTheirs,
          { slotId: theirSlot.id, employeeId: alternative.id },
          { slotId: slot.id, employeeId: mover },
        ],
        unfilled: state.unfilled.filter((entry) => entry.id !== slot.id),
      };
    }
  }
  return null;
}
