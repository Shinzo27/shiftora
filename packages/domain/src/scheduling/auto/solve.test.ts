import { describe, expect, it } from 'vitest';

import type { CoverageRequirement, ScheduleProblem, SchedulableEmployee } from './contract.js';
import { solve } from './solve.js';

const WEEK = '2027-03-01';

const requirement = (over: Partial<CoverageRequirement> = {}): CoverageRequirement => ({
  id: 'req',
  locationId: 'loc-1',
  weekday: 1,
  jobRoleId: null,
  startLocal: '09:00',
  endLocal: '17:00',
  headcount: 1,
  ...over,
});

const person = (over: Partial<SchedulableEmployee> = {}): SchedulableEmployee => ({
  id: 'asha',
  name: 'Asha',
  locationIds: ['loc-1'],
  jobRoleIds: [],
  hourlyRateMinor: 45_000,
  maxWeeklyMinutes: null,
  minRestMinutes: null,
  availability: [],
  timeOff: [],
  ...over,
});

const problem = (over: Partial<ScheduleProblem> = {}): ScheduleProblem => ({
  weekStart: WEEK,
  requirements: [requirement()],
  employees: [person()],
  locked: [],
  ...over,
});

describe('solve', () => {
  it('does not back off when greedy already filled the week', () => {
    const solution = solve(problem());
    expect(solution.strategy).toBe('greedy');
    expect(solution.assignments).toHaveLength(1);
  });

  it('undoes a greedy mistake to fill the slot it could not', () => {
    // Monday needs two people; Tuesday nights need a nurse. Only Asha is a nurse, so greedy takes
    // her for Monday (cheapest first) and then has nobody for Tuesday. Backtracking moves Monday
    // to Rohan and gives Asha the night.
    const input = problem({
      requirements: [
        requirement({ id: 'mon-a', weekday: 1, startLocal: '09:00', endLocal: '17:00' }),
        requirement({ id: 'mon-b', weekday: 1, startLocal: '09:00', endLocal: '17:00' }),
        requirement({
          id: 'tue-night',
          weekday: 2,
          startLocal: '22:00',
          endLocal: '06:00',
          jobRoleId: 'nurse',
        }),
      ],
      employees: [
        person({ id: 'asha', name: 'Asha', jobRoleIds: ['nurse'], hourlyRateMinor: 10_000 }),
        person({ id: 'rohan', name: 'Rohan', jobRoleIds: ['reception'], hourlyRateMinor: 20_000 }),
      ],
    });

    const solution = solve(input);

    const byId = new Map(solution.assignments.map((a) => [a.slotId, a.employeeId]));
    expect(solution.unfilled.map((slot) => slot.id)).toEqual([]);
    expect(byId.get('tue-night#0')).toBe('asha');
  });

  it('leaves the slot unfilled, with the same reasons, when no move can help', () => {
    // Everyone is on leave: nothing to move.
    const solution = solve(
      problem({
        employees: [person({ timeOff: [WEEK] })],
      }),
    );

    expect(solution.assignments).toHaveLength(0);
    expect(solution.unfilled).toHaveLength(1);
    expect(solution.unfilled[0]?.explanation).toContain('on approved time off');
    expect(solution.strategy).toBe('greedy');
  });

  it('never returns later than its budget', () => {
    // A clock that jumps a second forward on every read: the search must stop almost at once.
    let calls = 0;
    const solution = solve(
      problem({
        requirements: [requirement({ id: 'a' }), requirement({ id: 'b', weekday: 2 })],
        employees: [person({ maxWeeklyMinutes: 8 * 60 })],
      }),
      {
        budgetMs: 500,
        now: () => (calls += 1) * 1_000,
      },
    );

    expect(solution.tookMs).toBeLessThanOrEqual(2_000);
    // It still answered, and the answer is still coherent.
    expect(solution.assignments.length + solution.unfilled.length).toBe(2);
  });

  it('says "greedy" when hardest-first already avoided the problem', () => {
    const solved = solve(
      problem({
        requirements: [
          requirement({ id: 'mon', weekday: 1 }),
          requirement({ id: 'tue', weekday: 2, jobRoleId: 'nurse' }),
        ],
        employees: [
          person({ id: 'asha', jobRoleIds: ['nurse'], hourlyRateMinor: 10_000 }),
          person({ id: 'rohan', jobRoleIds: ['reception'], hourlyRateMinor: 90_000 }),
        ],
      }),
    );

    // The night shift is decided first because only one person can do it, so greedy never
    // spends Asha on the easy day — no undo needed, and saying so is more useful than a label
    // that always claims the fancy path.
    expect(solved.strategy).toBe('greedy');
    expect(solved.score.unfilledSlots).toBe(0);
  });
});
