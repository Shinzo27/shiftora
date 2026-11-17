import { computePay, type PayResult, type WorkedPeriod } from './compute.js';
import type { PayRulesVersion } from './rules.js';

/**
 * What a week of shifts will cost (W6 D6, the basis for PRD A6): planned shifts priced exactly
 * like punches, with `computePay` — the same overtime, night premium and rules — so a draft's
 * projection and the payroll that follows it agree.
 *
 * Overtime is per person across every location, so a schedule cannot be priced on its own: a
 * nurse already on 36 hours at Bandra makes her Friday at Andheri overtime. Each shift is
 * charged, **in time order**, what it adds to the person's pay for the week: pay(up to and
 * including it) − pay(before it). Overtime therefore lands on the shift where it really happens,
 * and the shares of every schedule add up exactly to what the person is paid — no branch is
 * charged overtime that another branch's shift caused, and nothing is counted twice.
 */
export interface ProjectionPerson {
  employeeId: string;
  hourlyRateMinor: number;
  /** This schedule's shifts for them (with their planned breaks). */
  shifts: WorkedPeriod[];
  /** Their other shifts around the same week, at any location. */
  otherShifts: WorkedPeriod[];
}

export interface PersonCost {
  employeeId: string;
  paidMinutes: number;
  overtimeMinutes: number;
  costMinor: number;
}

export interface ScheduleCost {
  people: PersonCost[];
  paidMinutes: number;
  overtimeMinutes: number;
  costMinor: number;
}

function overtimeOf(result: PayResult): number {
  return result.lines
    .filter((line) => line.category === 'overtime')
    .reduce((sum, line) => sum + line.minutes, 0);
}

export function projectCost(
  people: readonly ProjectionPerson[],
  versions: readonly PayRulesVersion[],
): ScheduleCost {
  const costs = people.map((person): PersonCost => {
    const mine = new Set(person.shifts.map((shift) => shift.id));
    const week = [...person.shifts, ...person.otherShifts].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    const cost: PersonCost = {
      employeeId: person.employeeId,
      paidMinutes: 0,
      overtimeMinutes: 0,
      costMinor: 0,
    };
    let before = computePay({ periods: [], versions, hourlyRateMinor: person.hourlyRateMinor });
    for (let i = 0; i < week.length; i += 1) {
      const upTo = computePay({
        periods: week.slice(0, i + 1),
        versions,
        hourlyRateMinor: person.hourlyRateMinor,
      });
      if (mine.has(week[i]!.id)) {
        cost.paidMinutes += upTo.paidMinutes - before.paidMinutes;
        cost.overtimeMinutes += overtimeOf(upTo) - overtimeOf(before);
        cost.costMinor += upTo.amountMinor - before.amountMinor;
      }
      before = upTo;
    }
    return cost;
  });
  return {
    people: costs,
    paidMinutes: costs.reduce((sum, c) => sum + c.paidMinutes, 0),
    overtimeMinutes: costs.reduce((sum, c) => sum + c.overtimeMinutes, 0),
    costMinor: costs.reduce((sum, c) => sum + c.costMinor, 0),
  };
}
