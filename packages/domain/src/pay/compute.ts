import { localDayBounds, toLocal, type LocalDate } from '../time/zoned.js';
import { rulesInForce, type BreakRule, type PayRulesVersion, type RoundingRule } from './rules.js';

/**
 * `computePay` — worked time in, priced line items out (ARCHITECTURE §7.8). Pure and
 * deterministic: no clock, no database, no time-zone lookups of its own. The same inputs always
 * produce the same lines, so a past period recalculates exactly.
 *
 * The pipeline, one step per function below:
 *   1. pick the rules in force on the day the work started (`rulesInForce`);
 *   2. round the punches to the rule's grid, on the location's wall clock;
 *   3. take the unpaid break out of the middle of a long stretch;
 *   4. cut what is left at local midnight, so every minute belongs to one calendar day;
 *   5. classify and price the minutes, and add them up per day.
 *
 * Money is integer minor units (paise) and multipliers are basis points: nothing is ever a float.
 */

/** One stretch of work: a clock-in to a clock-out, at a location in `timezone`. */
export interface WorkedPeriod {
  id: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

export interface PayInput {
  periods: readonly WorkedPeriod[];
  versions: readonly PayRulesVersion[];
  /** The employee's base rate, minor units per hour. */
  hourlyRateMinor: number;
}

export type PayCategory = 'regular' | 'overtime';

/** Minutes of one kind on one local day, and what they cost. */
export interface PayLine {
  date: LocalDate;
  category: PayCategory;
  /** Inside the night-premium window. */
  night: boolean;
  minutes: number;
  /** The rate for these minutes in basis points of base: 10 000 = 1×, 17 500 = 1.75×. */
  multiplierBp: number;
  amountMinor: number;
}

export interface PayResult {
  lines: PayLine[];
  /** Clock-in to clock-out after rounding, before breaks. */
  workedMinutes: number;
  /** Unpaid breaks taken out. */
  breakMinutes: number;
  /** What is paid for: worked − breaks. Always the sum of the lines' minutes. */
  paidMinutes: number;
  amountMinor: number;
}

const MINUTE = 60_000;
export const BASE_BP = 10_000;

/** A piece of paid time that lies within one local day. */
export interface Piece {
  date: LocalDate;
  start: Date;
  end: Date;
  timezone: string;
}

/** Steps 1–4: the paid pieces of every period, in time order, plus the totals so far. */
export function paidPieces(input: PayInput): {
  pieces: Piece[];
  workedMinutes: number;
  breakMinutes: number;
} {
  const pieces: Piece[] = [];
  let workedMinutes = 0;
  let breakMinutes = 0;

  const periods = [...input.periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const period of periods) {
    const rules = rulesInForce(input.versions, toLocal(period.startsAt, period.timezone).date);
    const start = roundPunch(period.startsAt, period.timezone, rules.rounding);
    const end = roundPunch(period.endsAt, period.timezone, rules.rounding);
    if (end.getTime() <= start.getTime()) continue;

    const minutes = (end.getTime() - start.getTime()) / MINUTE;
    const deducted = breakFor(minutes, rules.breaks);
    workedMinutes += minutes;
    breakMinutes += deducted;

    for (const stretch of withoutBreak(start, end, deducted)) {
      pieces.push(...splitAtLocalMidnight(stretch.start, stretch.end, period.timezone));
    }
  }
  return { pieces, workedMinutes, breakMinutes };
}

/**
 * Prices worked time. D2: every paid minute at base rate, per local day. Overtime and the night
 * premium (W6 D3) refine the same pieces.
 */
export function computePay(input: PayInput): PayResult {
  const { pieces, workedMinutes, breakMinutes } = paidPieces(input);
  const priced = pieces.map((piece) => ({
    date: piece.date,
    category: 'regular' as const,
    night: false,
    minutes: minutesOf(piece),
    multiplierBp: BASE_BP,
  }));
  return summarise(priced, input.hourlyRateMinor, workedMinutes, breakMinutes);
}

// ------------------------------------------------------------------------------- steps

/**
 * Rounds a punch to the rule's grid **on the location's wall clock** — a 30-minute grid in India
 * (UTC+05:30) is :00 and :30 local, not UTC. Without a rule, punches round to the nearest whole
 * minute, so every later step works in whole minutes.
 */
export function roundPunch(instant: Date, timezone: string, rule: RoundingRule | null): Date {
  const grid = (rule?.toMinutes ?? 1) * MINUTE;
  const mode = rule?.mode ?? 'nearest';
  const { time } = toLocal(instant, timezone);
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const seconds = ((instant.getTime() % MINUTE) + MINUTE) % MINUTE;
  const exact = (hour * 60 + minute) * MINUTE + seconds;
  const steps = exact / grid;
  const rounded =
    (mode === 'up' ? Math.ceil(steps) : mode === 'down' ? Math.floor(steps) : Math.round(steps)) *
    grid;
  return new Date(instant.getTime() + (rounded - exact));
}

/**
 * The unpaid break for a stretch of `minutes`: the rule with the longest `afterMinutes` that the
 * stretch is longer than (with 6 h → 30 min and 9 h → 45 min, a 10-hour stretch loses 45).
 */
export function breakFor(minutes: number, rules: readonly BreakRule[]): number {
  let chosen: BreakRule | null = null;
  for (const rule of rules) {
    if (minutes > rule.afterMinutes && (!chosen || rule.afterMinutes > chosen.afterMinutes)) {
      chosen = rule;
    }
  }
  return chosen ? Math.min(chosen.deductMinutes, minutes) : 0;
}

/**
 * Takes `breakMinutes` out of the **middle** of the stretch, as a mid-shift break would be: the
 * first and last hours stay paid exactly as worked, so a night shift's early-morning premium
 * minutes are not the ones lost to the break.
 */
export function withoutBreak(
  start: Date,
  end: Date,
  breakMinutes: number,
): { start: Date; end: Date }[] {
  if (breakMinutes <= 0) return [{ start, end }];
  const total = (end.getTime() - start.getTime()) / MINUTE;
  const before = Math.floor((total - breakMinutes) / 2);
  const breakStart = new Date(start.getTime() + before * MINUTE);
  const breakEnd = new Date(breakStart.getTime() + breakMinutes * MINUTE);
  return [
    { start, end: breakStart },
    { start: breakEnd, end },
  ].filter((stretch) => stretch.end.getTime() > stretch.start.getTime());
}

/** Cuts a stretch at each local midnight it crosses; a DST day is 23 or 25 hours long. */
export function splitAtLocalMidnight(start: Date, end: Date, timezone: string): Piece[] {
  const pieces: Piece[] = [];
  let from = start;
  while (from.getTime() < end.getTime()) {
    const date = toLocal(from, timezone).date;
    const midnight = localDayBounds(date, timezone).end;
    const to = midnight.getTime() < end.getTime() ? midnight : end;
    pieces.push({ date, start: from, end: to, timezone });
    from = to;
  }
  return pieces;
}

export function minutesOf(piece: { start: Date; end: Date }): number {
  return Math.round((piece.end.getTime() - piece.start.getTime()) / MINUTE);
}

// ------------------------------------------------------------------------------- pricing

export interface PricedMinutes {
  date: LocalDate;
  category: PayCategory;
  night: boolean;
  minutes: number;
  multiplierBp: number;
}

/**
 * Adds priced minutes up per day, kind and rate, and prices each line once — rounding money per
 * line, not per minute, so splitting the same work differently cannot drift by a paisa a piece.
 */
export function summarise(
  priced: readonly PricedMinutes[],
  hourlyRateMinor: number,
  workedMinutes: number,
  breakMinutes: number,
): PayResult {
  const byKey = new Map<string, PricedMinutes>();
  for (const item of priced) {
    if (item.minutes <= 0) continue;
    const key = `${item.date}|${item.category}|${item.night}|${item.multiplierBp}`;
    const line = byKey.get(key);
    if (line) line.minutes += item.minutes;
    else byKey.set(key, { ...item });
  }

  const lines: PayLine[] = [...byKey.values()]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(a.category === 'overtime') - Number(b.category === 'overtime') ||
        Number(a.night) - Number(b.night) ||
        a.multiplierBp - b.multiplierBp,
    )
    .map((line) => ({
      ...line,
      amountMinor: price(line.minutes, hourlyRateMinor, line.multiplierBp),
    }));

  return {
    lines,
    workedMinutes,
    breakMinutes,
    paidMinutes: lines.reduce((sum, line) => sum + line.minutes, 0),
    amountMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
  };
}

/** minutes × rate/hour × multiplier, in minor units, rounded half up. Integers throughout. */
export function price(minutes: number, hourlyRateMinor: number, multiplierBp: number): number {
  return Math.round((minutes * hourlyRateMinor * multiplierBp) / (60 * BASE_BP));
}
