import { describe, expect, it } from 'vitest';

import { BENCH_WEEK, hardRuleBreaches, largeClinic } from './benchmark.js';
import { expandWeek } from './contract.js';
import { solveGreedy } from './greedy.js';
import { solve } from './solve.js';

/**
 * W7 D6: the benchmark clinic is what the README's numbers come from, so it must be reproducible,
 * and every answer the solver gives on it must keep every hard rule.
 */

describe('the benchmark clinic', () => {
  it('is the same clinic for the same seed: 50 staff, 133 slots a week', () => {
    const a = largeClinic({ seed: 7 });
    expect(largeClinic({ seed: 7 })).toEqual(a);
    expect(largeClinic({ seed: 8 })).not.toEqual(a);
    expect(a.employees).toHaveLength(50);
    expect(expandWeek(a)).toHaveLength(133);
    expect(a.weekStart).toBe(BENCH_WEEK);
  });

  it('scales coverage with the staff', () => {
    expect(expandWeek(largeClinic({ seed: 1, employees: 100 }))).toHaveLength(266);
  });
});

describe('solving it', () => {
  it('fills a comfortable week completely and keeps every hard rule', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const problem = largeClinic({ seed });
      const solution = solve(problem, { budgetMs: 500 });
      expect(hardRuleBreaches(problem, solution), `seed ${seed}`).toEqual([]);
      expect(solution.unfilled, `seed ${seed}`).toHaveLength(0);
    }
  });

  it('on a tight week, leaves slots unfilled with reasons rather than break a rule', () => {
    const problem = largeClinic({ seed: 3, demand: 1.8 });
    const solution = solve(problem, { budgetMs: 300 });
    expect(hardRuleBreaches(problem, solution)).toEqual([]);
    expect(solution.unfilled.length).toBeGreaterThan(0);
    for (const slot of solution.unfilled) expect(slot.explanation).not.toBe('');
    // Backtracking never does worse than greedy alone.
    expect(solution.assignments.length).toBeGreaterThanOrEqual(
      solveGreedy(problem).assignments.length,
    );
  });
});

describe('the budget', () => {
  it('is kept on a tight week, where backtracking has the most to try', () => {
    // Before W7 D6 one backtracking pass could outlast the budget (500 ms ran to 1,205 ms):
    // the deadline was only checked between slots. Allow one move's worth of slack.
    const problem = largeClinic({ seed: 3, demand: 1.8 });
    solve(problem, { budgetMs: 50 }); // warm the JIT
    const started = Date.now();
    solve(problem, { budgetMs: 300 });
    expect(Date.now() - started).toBeLessThan(300 + 250);
  });
});

describe('the checker', () => {
  it('catches an overlap, a missing role, time off, the weekly ceiling and short rest', () => {
    const problem = largeClinic({ seed: 1 });
    const slots = expandWeek(problem);
    const nurse = problem.employees.find((person) => person.id === 'nurse-1')!;
    const morning = slots.filter((slot) => slot.id.includes('-morning-nurse#'));
    const doctorSlot = slots.find((slot) => slot.id.includes('-morning-doctor#'))!;
    const base = { weekStart: BENCH_WEEK, unfilled: [], strategy: 'test', tookMs: 0 };
    const score = {
      costMinor: 0,
      fairnessSpreadMinutes: 0,
      preferenceMatches: 0,
      unfilledSlots: 0,
    };

    const sameTime = morning.filter((slot) => slot.date === BENCH_WEEK).slice(0, 2);
    expect(
      hardRuleBreaches(problem, {
        ...base,
        score,
        assignments: sameTime.map((slot) => ({ slotId: slot.id, employeeId: nurse.id })),
      }).some((breach) => breach.includes('overlaps')),
    ).toBe(true);

    expect(
      hardRuleBreaches(problem, {
        ...base,
        score,
        assignments: [{ slotId: doctorSlot.id, employeeId: nurse.id }],
      }),
    ).toEqual([`${doctorSlot.id}: nurse-1 lacks the role`]);

    // Seven mornings is 56 h: over a 40 h or 48 h ceiling.
    const everyMorning = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      morning.find((slot) => slot.id.startsWith(`${weekday}-`))!,
    );
    expect(
      hardRuleBreaches(problem, {
        ...base,
        score,
        assignments: everyMorning.map((slot) => ({ slotId: slot.id, employeeId: nurse.id })),
      }).some((breach) => breach.includes(', over ')),
    ).toBe(true);

    // An evening then the next morning: 8 h of rest, under the 11 h most staff need.
    const restful = problem.employees.find(
      (person) => person.jobRoleIds.includes('nurse') && person.minRestMinutes === 660,
    )!;
    const evening = slots.find((slot) => slot.id.startsWith('1-evening-nurse#'))!;
    const nextMorning = slots.find((slot) => slot.id.startsWith('2-morning-nurse#'))!;
    expect(
      hardRuleBreaches(problem, {
        ...base,
        score,
        assignments: [evening, nextMorning].map((slot) => ({
          slotId: slot.id,
          employeeId: restful.id,
        })),
      }).some((breach) => breach.includes('min rest')),
    ).toBe(true);

    const away = problem.employees.find((person) => person.timeOff.length > 0);
    if (away) {
      const roleSlot = slots.find(
        (slot) => slot.date === away.timeOff[0] && away.jobRoleIds.includes(slot.jobRoleId ?? ''),
      )!;
      expect(
        hardRuleBreaches(problem, {
          ...base,
          score,
          assignments: [{ slotId: roleSlot.id, employeeId: away.id }],
        }).some((breach) => breach.includes('time off')),
      ).toBe(true);
    }
  });
});
