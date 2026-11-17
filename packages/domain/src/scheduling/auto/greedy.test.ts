import { describe, expect, it } from 'vitest';

import type { CoverageRequirement, ScheduleProblem, SchedulableEmployee } from './contract.js';
import { solveGreedy } from './greedy.js';

const WEEK = '2027-03-01'; // Monday

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

describe('solveGreedy', () => {
  it('fills a simple week', () => {
    const solution = solveGreedy(problem());

    expect(solution.assignments).toEqual([{ slotId: 'req#0', employeeId: 'asha' }]);
    expect(solution.unfilled).toEqual([]);
    expect(solution.strategy).toBe('greedy');
    // 8 hours at ₹450 an hour.
    expect(solution.score.costMinor).toBe(8 * 45_000);
  });

  it('gives two needed people two different staff', () => {
    const solution = solveGreedy(
      problem({
        requirements: [requirement({ headcount: 2 })],
        employees: [person(), person({ id: 'rohan', name: 'Rohan' })],
      }),
    );

    expect(solution.assignments.map((a) => a.employeeId).sort()).toEqual(['asha', 'rohan']);
    expect(solution.unfilled).toHaveLength(0);
  });

  it('prefers the cheaper person when both could work', () => {
    const solution = solveGreedy(
      problem({
        employees: [
          person({ id: 'expensive', name: 'Expensive', hourlyRateMinor: 90_000 }),
          person({ id: 'cheap', name: 'Cheap', hourlyRateMinor: 20_000 }),
        ],
      }),
    );

    expect(solution.assignments[0]?.employeeId).toBe('cheap');
  });

  it('spreads the week instead of loading one person', () => {
    const solution = solveGreedy(
      problem({
        requirements: [
          requirement({ id: 'mon', weekday: 1 }),
          requirement({ id: 'tue', weekday: 2 }),
        ],
        employees: [
          person({ id: 'a', name: 'A' }),
          person({ id: 'b', name: 'B', hourlyRateMinor: 60_000 }),
        ],
      }),
    );

    // Same cost on Monday, but fairness pushes Tuesday to the person who has not worked yet.
    const people = solution.assignments.map((assignment) => assignment.employeeId);
    expect(new Set(people).size).toBe(2);
    expect(solution.score.fairnessSpreadMinutes).toBe(0);
  });

  it('respects a weekly hours ceiling and says so', () => {
    const solution = solveGreedy(
      problem({
        requirements: [
          requirement({ id: 'mon', weekday: 1 }),
          requirement({ id: 'tue', weekday: 2 }),
        ],
        employees: [person({ maxWeeklyMinutes: 8 * 60 })],
      }),
    );

    expect(solution.assignments).toHaveLength(1);
    expect(solution.unfilled).toHaveLength(1);
    expect(solution.unfilled[0]?.explanation).toMatch(/1 person over their weekly hours/);
    expect(solution.unfilled[0]?.blockers[0]?.code).toBe('max_hours');
  });

  it('keeps someone on approved leave out of it', () => {
    const solution = solveGreedy(problem({ employees: [person({ timeOff: ['2027-03-01'] })] }));

    expect(solution.assignments).toHaveLength(0);
    expect(solution.unfilled[0]?.blockers.map((b) => b.code)).toContain('time_off');
    expect(solution.unfilled[0]?.explanation).toContain('on approved time off');
  });

  it('refuses to give one person two overlapping shifts', () => {
    const solution = solveGreedy(
      problem({
        requirements: [
          requirement({ id: 'a', startLocal: '09:00', endLocal: '13:00' }),
          requirement({ id: 'b', startLocal: '12:00', endLocal: '16:00' }),
        ],
      }),
    );

    expect(solution.assignments).toHaveLength(1);
    expect(solution.unfilled[0]?.blockers.map((b) => b.code)).toContain('already_working');
  });

  it('honours minimum rest between days', () => {
    const solution = solveGreedy(
      problem({
        requirements: [
          requirement({ id: 'late', weekday: 1, startLocal: '18:00', endLocal: '23:00' }),
          requirement({ id: 'early', weekday: 2, startLocal: '08:00', endLocal: '12:00' }),
        ],
        employees: [person({ minRestMinutes: 11 * 60 })],
      }),
    );

    expect(solution.assignments).toHaveLength(1);
    expect(solution.unfilled[0]?.blockers.map((b) => b.code)).toContain('min_rest');
  });

  it('needs the role when the requirement names one', () => {
    const solution = solveGreedy(
      problem({
        requirements: [requirement({ jobRoleId: 'nurse' })],
        employees: [person({ jobRoleIds: ['reception'] })],
      }),
    );

    expect(solution.assignments).toHaveLength(0);
    expect(solution.unfilled[0]?.blockers[0]?.code).toBe('missing_role');
    expect(solution.unfilled[0]?.explanation).toContain('not qualified for this role');
  });

  it('routes around a hand-placed shift instead of overwriting it', () => {
    const solution = solveGreedy(
      problem({
        locked: [
          { employeeId: 'asha', date: '2027-03-01', startLocal: '09:00', endLocal: '17:00' },
        ],
        employees: [person(), person({ id: 'rohan', name: 'Rohan' })],
      }),
    );

    // Asha is already on that slot by hand, so the requirement goes to the other person.
    expect(solution.assignments[0]?.employeeId).toBe('rohan');
  });

  it('decides the hardest slot first, so a scarce person is not spent early', () => {
    // Only Asha can do the night shift; both can do the day one.
    const solution = solveGreedy(
      problem({
        requirements: [
          requirement({ id: 'day', weekday: 1, startLocal: '09:00', endLocal: '17:00' }),
          requirement({
            id: 'night',
            weekday: 2,
            startLocal: '22:00',
            endLocal: '06:00',
            jobRoleId: 'nurse',
          }),
        ],
        employees: [
          person({ id: 'asha', jobRoleIds: ['nurse'] }),
          person({ id: 'rohan', jobRoleIds: ['reception'] }),
        ],
      }),
    );

    const byId = new Map(solution.assignments.map((a) => [a.slotId, a.employeeId]));
    expect(byId.get('night#0')).toBe('asha');
    expect(byId.get('day#0')).toBe('rohan');
    expect(solution.unfilled).toHaveLength(0);
  });

  it('treats an overnight slot as eight hours, not minus sixteen', () => {
    const solution = solveGreedy(
      problem({
        requirements: [requirement({ startLocal: '22:00', endLocal: '06:00' })],
      }),
    );
    expect(solution.assignments).toHaveLength(1);
    expect(solution.score.costMinor).toBe(8 * 45_000);
  });

  it('is deterministic: the same problem gives the same answer', () => {
    const input = problem({
      requirements: [requirement({ headcount: 2 }), requirement({ id: 'tue', weekday: 2 })],
      employees: [person({ id: 'a', name: 'A' }), person({ id: 'b', name: 'B' })],
    });
    expect(solveGreedy(input).assignments).toEqual(solveGreedy(input).assignments);
  });
});
