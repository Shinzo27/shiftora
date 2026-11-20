import { addDays } from '../../time/zoned.js';
import type {
  CoverageRequirement,
  ScheduleProblem,
  ScheduleSolution,
  SchedulableEmployee,
} from './contract.js';
import { expandWeek } from './contract.js';

/**
 * A large clinic for benchmarking the auto-scheduler (W7 D6): deterministic from a seed, so the
 * README's numbers can be reproduced exactly, and an independent checker that re-verifies every
 * hard rule on the answer — a fast solver that breaks a rule to fill a slot is worse than useless.
 *
 * Not exported from the package: it is a measuring instrument, not product code.
 */

/** mulberry32: a tiny, well-known seeded PRNG. Same seed, same clinic, on every machine. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const BENCH_WEEK = '2026-12-07'; // a Monday
const LOCATION = 'main';

/** Share of the staff in each role, and their hourly rate range in paise. */
const ROLES = [
  { id: 'nurse', share: 0.5, rate: [30_000, 45_000] },
  { id: 'doctor', share: 0.2, rate: [80_000, 120_000] },
  { id: 'reception', share: 0.2, rate: [20_000, 28_000] },
  { id: 'pharmacist', share: 0.1, rate: [40_000, 50_000] },
] as const;

type RoleId = (typeof ROLES)[number]['id'];

/** Per day at 50 staff: three 8-hour shifts, round the clock, by role. */
const SHIFTS: { name: string; start: string; end: string; need: Record<RoleId, number> }[] = [
  {
    name: 'morning',
    start: '07:00',
    end: '15:00',
    need: { nurse: 4, doctor: 2, reception: 2, pharmacist: 1 },
  },
  {
    name: 'evening',
    start: '15:00',
    end: '23:00',
    need: { nurse: 3, doctor: 1, reception: 2, pharmacist: 1 },
  },
  {
    name: 'night',
    start: '23:00',
    end: '07:00',
    need: { nurse: 2, doctor: 1, reception: 0, pharmacist: 0 },
  },
];

export interface ClinicOptions {
  seed: number;
  /** Staff count; coverage scales with it, so 100 staff means twice the slots. */
  employees?: number;
  /**
   * Multiplies every headcount. 1 is a comfortable clinic (about half the staff's hours are
   * needed); 1.6 is a tight one, where rest rules and time off leave slots genuinely unfillable.
   */
  demand?: number;
}

export function largeClinic(options: ClinicOptions): ScheduleProblem {
  const random = seeded(options.seed);
  const staff = options.employees ?? 50;
  const scale = staff / 50;
  const demand = options.demand ?? 1;
  const between = (low: number, high: number) => Math.round(low + random() * (high - low));

  const employees: SchedulableEmployee[] = [];
  for (const role of ROLES) {
    const count = Math.round(staff * role.share);
    for (let i = 0; i < count; i += 1) {
      // Two in every ten receptionists also cover the pharmacy counter.
      const jobRoleIds: string[] =
        role.id === 'reception' && random() < 0.2 ? ['reception', 'pharmacist'] : [role.id];
      // Six in ten state when they like to work: five days, from early morning to late evening.
      const days = [1, 2, 3, 4, 5, 6, 7].sort(() => random() - 0.5).slice(0, 5);
      const availability =
        random() < 0.6
          ? days.map((weekday) => ({ weekday, startLocal: '06:00', endLocal: '23:30' }))
          : [];
      // One in ten has one to three days off this week.
      const timeOff: string[] = [];
      if (random() < 0.1) {
        const first = between(0, 4);
        const length = between(1, 3);
        for (let d = 0; d < length; d += 1) timeOff.push(addDays(BENCH_WEEK, first + d));
      }
      employees.push({
        id: `${role.id}-${i + 1}`,
        name: `${role.id} ${i + 1}`,
        locationIds: [LOCATION],
        jobRoleIds,
        hourlyRateMinor: between(role.rate[0], role.rate[1]),
        maxWeeklyMinutes: random() < 0.2 ? 2_880 : 2_400,
        minRestMinutes: random() < 0.9 ? 660 : null,
        availability,
        timeOff,
      });
    }
  }

  const requirements: CoverageRequirement[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const shift of SHIFTS) {
      for (const role of ROLES) {
        const headcount = Math.round(shift.need[role.id] * scale * demand);
        if (headcount === 0) continue;
        requirements.push({
          id: `${weekday}-${shift.name}-${role.id}`,
          locationId: LOCATION,
          weekday,
          jobRoleId: role.id,
          startLocal: shift.start,
          endLocal: shift.end,
          headcount,
        });
      }
    }
  }
  return { weekStart: BENCH_WEEK, requirements, employees, locked: [] };
}

const minutesOf = (time: string) => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

/**
 * Every hard rule, re-checked from scratch on a solution (deliberately not reusing the solver's
 * own `blockersFor`): branch, role, time off, one person per slot, no two shifts at once, the
 * weekly ceiling and minimum rest. Returns a sentence per breach; an empty list is a valid week.
 */
export function hardRuleBreaches(problem: ScheduleProblem, solution: ScheduleSolution): string[] {
  const slots = new Map(expandWeek(problem).map((slot) => [slot.id, slot]));
  const people = new Map(problem.employees.map((person) => [person.id, person]));
  const breaches: string[] = [];
  const spans = new Map<string, { start: number; end: number; slotId: string }[]>();
  const used = new Set<string>();
  const dayZero = Date.parse(`${problem.weekStart}T00:00:00Z`);

  for (const { slotId, employeeId } of solution.assignments) {
    const slot = slots.get(slotId);
    const person = people.get(employeeId);
    if (!slot || !person) {
      breaches.push(`${slotId}: unknown slot or person`);
      continue;
    }
    if (used.has(slotId)) breaches.push(`${slotId}: filled twice`);
    used.add(slotId);
    if (!person.locationIds.includes(slot.locationId)) {
      breaches.push(`${slotId}: ${employeeId} not at the branch`);
    }
    if (slot.jobRoleId && !person.jobRoleIds.includes(slot.jobRoleId)) {
      breaches.push(`${slotId}: ${employeeId} lacks the role`);
    }
    if (person.timeOff.includes(slot.date))
      breaches.push(`${slotId}: ${employeeId} is on time off`);

    // An absolute minute on the week's timeline; the dates are plain calendar days.
    const day = (Date.parse(`${slot.date}T00:00:00Z`) - dayZero) / 86_400_000;
    const start = day * 1_440 + minutesOf(slot.startLocal);
    let end = day * 1_440 + minutesOf(slot.endLocal);
    if (end <= start) end += 1_440;
    spans.set(employeeId, [...(spans.get(employeeId) ?? []), { start, end, slotId }]);
  }

  for (const [employeeId, list] of spans) {
    const person = people.get(employeeId)!;
    const sorted = [...list].sort((a, b) => a.start - b.start);
    const total = sorted.reduce((sum, span) => sum + (span.end - span.start), 0);
    if (person.maxWeeklyMinutes !== null && total > person.maxWeeklyMinutes) {
      breaches.push(`${employeeId}: ${total} min, over ${person.maxWeeklyMinutes}`);
    }
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i]!.start - sorted[i - 1]!.end;
      if (gap < 0) {
        breaches.push(`${employeeId}: ${sorted[i - 1]!.slotId} overlaps ${sorted[i]!.slotId}`);
      } else if (person.minRestMinutes !== null && gap < person.minRestMinutes) {
        breaches.push(`${employeeId}: ${gap} min rest before ${sorted[i]!.slotId}`);
      }
    }
  }
  return breaches;
}
