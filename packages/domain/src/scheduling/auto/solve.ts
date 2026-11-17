import type {
  Assignment,
  CoverageSlot,
  ScheduleProblem,
  ScheduleSolution,
  SchedulableEmployee,
} from './contract.js';
import { expandWeek } from './contract.js';
import { blockersFor, loadsFor, scoreSolution, solveGreedy, weekdayIndex } from './greedy.js';

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

/** The answer to "could this person take this slot, given what is already assigned?". */
function couldTake(
  problem: ScheduleProblem,
  employees: Map<string, SchedulableEmployee>,
  loads: ReturnType<typeof loadsFor>,
  slot: CoverageSlot,
  employeeId: string,
): boolean {
  const employee = employees.get(employeeId);
  const load = loads.get(employeeId);
  if (!employee || !load) return false;
  return blockersFor(employee, slot, load, weekdayIndex(problem.weekStart, slot.date)).length === 0;
}

/**
 * Solve: greedy first, then try to fill what it left behind by moving one shift at a time.
 *
 * The search is narrow on purpose — for each unfilled slot, look at the people blocked only
 * because they are busy, move that shift to someone else who could take it, and see whether the
 * slot then fills. One level deep, repeated while the budget lasts. That catches "the wrong person
 * got the easy shift" without turning into a solver nobody can reason about.
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
  const assignments: Assignment[] = [...greedy.assignments];
  const unfilled = [...greedy.unfilled];
  let moves = 0;

  let improved = true;
  while (improved && now() < deadline) {
    improved = false;

    for (const blocked of [...unfilled]) {
      if (now() >= deadline) break;
      const slot = slots.get(blocked.id);
      if (!slot) continue;

      // Only "busy" is fixable by moving someone; a missing role or a day of leave is not.
      const busy = blocked.blockers
        .filter((blocker) => blocker.code === 'already_working' || blocker.code === 'min_rest')
        .map((blocker) => blocker.employeeId);

      for (const mover of new Set(busy)) {
        if (now() >= deadline) break;
        const theirs = assignments.find((assignment) => assignment.employeeId === mover);
        if (!theirs) continue;
        const theirSlot = slots.get(theirs.slotId);
        if (!theirSlot) continue;

        for (const alternative of problem.employees) {
          if (now() >= deadline) break;
          if (alternative.id === mover) continue;

          // Would the other person take the shift we are moving, and would the original person
          // then be free for the slot that was blocked? Both, or the move is pointless.
          const withoutTheirs = assignments.filter((assignment) => assignment !== theirs);
          const loadsAfterMove = loadsFor(problem, withoutTheirs);
          if (!couldTake(problem, employees, loadsAfterMove, theirSlot, alternative.id)) continue;
          if (!couldTake(problem, employees, loadsAfterMove, slot, mover)) continue;

          assignments.length = 0;
          assignments.push(
            ...withoutTheirs,
            { slotId: theirSlot.id, employeeId: alternative.id },
            { slotId: slot.id, employeeId: mover },
          );
          unfilled.splice(
            unfilled.findIndex((entry) => entry.id === slot.id),
            1,
          );
          moves += 1;
          improved = true;
          break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  // Re-score what we ended with: the greedy numbers no longer describe this week.
  const score = scoreSolution(problem, assignments, unfilled, loadsFor(problem, assignments));

  return {
    weekStart: problem.weekStart,
    assignments,
    unfilled,
    score,
    strategy: moves === 0 ? 'greedy' : 'greedy+backtracking',
    tookMs: now() - startedAt,
  };
}
