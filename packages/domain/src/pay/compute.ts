import { localDayBounds, startOfWeek, toInstant, toLocal, type LocalDate } from '../time/zoned.js';
import {
  rulesInForce,
  toBasisPoints,
  type BreakRule,
  type NightPremium,
  type PayRulesVersion,
  type RoundingRule,
} from './rules.js';

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
 *   5. cut at the night window's edges, so a minute is either night or not;
 *   6. classify each minute — regular, daily overtime or weekly overtime, **never two** — and
 *      price it, premiums adding on base (owner's decision: 1 + 0.5 + 0.25 = 1.75×);
 *   7. add it all up per day and rate.
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
 * Prices worked time: every paid minute once, as regular or overtime, with the night premium on
 * top where it applies. Which rules a minute follows:
 *   - rounding and breaks: the rules of the day its stretch **started** (a stretch is one unit);
 *   - night window, daily overtime and multipliers: the rules of the day the minute falls on;
 *   - weekly overtime: the rules in force on that week's Monday (one threshold per week).
 */
export function computePay(input: PayInput): PayResult {
  const { pieces, workedMinutes, breakMinutes } = paidPieces(input);
  const atoms = pieces.flatMap((piece) => splitAtNight(piece, input.versions));
  const priced = classify(atoms, input.versions);
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

/** A piece that is wholly inside or wholly outside the night window. */
export interface Atom extends Piece {
  night: boolean;
}

/**
 * Step 5: cuts a piece at the night window's edges, using the window of the piece's own day. A
 * window that wraps (22:00–06:00) is two stretches of the day: its small hours and its late
 * evening — the next morning's small hours belong to the next day's piece.
 */
export function splitAtNight(piece: Piece, versions: readonly PayRulesVersion[]): Atom[] {
  const night = rulesInForce(versions, piece.date).nightPremium;
  if (!night) return [{ ...piece, night: false }];

  const windows = nightWindows(piece.date, piece.timezone, night);
  const cuts = new Set<number>([piece.start.getTime(), piece.end.getTime()]);
  for (const window of windows) {
    for (const edge of [window.start.getTime(), window.end.getTime()]) {
      if (edge > piece.start.getTime() && edge < piece.end.getTime()) cuts.add(edge);
    }
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const atoms: Atom[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = new Date(edges[i]!);
    const end = new Date(edges[i + 1]!);
    atoms.push({
      ...piece,
      start,
      end,
      night: windows.some(
        (window) =>
          start.getTime() >= window.start.getTime() && end.getTime() <= window.end.getTime(),
      ),
    });
  }
  return atoms;
}

/** The parts of a local day that are inside the night window, as instants. */
function nightWindows(
  date: LocalDate,
  timezone: string,
  night: NightPremium,
): { start: Date; end: Date }[] {
  const day = localDayBounds(date, timezone);
  const from = toInstant(date, night.startLocal, timezone);
  const to = toInstant(date, night.endLocal, timezone);
  return night.startLocal < night.endLocal
    ? [{ start: from, end: to }]
    : [
        { start: day.start, end: to },
        { start: from, end: day.end },
      ];
}

/**
 * Step 6: regular or overtime, minute by minute in time order, with **no double counting**:
 *   - minutes beyond the daily threshold on a local day are daily overtime;
 *   - the weekly threshold counts only the minutes that were *not* daily overtime, and those
 *     beyond it are weekly overtime.
 * So a minute is overtime once at most, under one rule. (Six 10-hour days at 9 h/day and
 * 48 h/week: 6 h daily overtime, and the 54 regular hours exceed 48 by 6 more — 12 h, not 16.)
 */
export function classify(
  atoms: readonly Atom[],
  versions: readonly PayRulesVersion[],
): PricedMinutes[] {
  const dayTotals = new Map<LocalDate, number>();
  const weekRegular = new Map<LocalDate, number>();
  const priced: PricedMinutes[] = [];

  for (const atom of atoms) {
    const minutes = minutesOf(atom);
    if (minutes <= 0) continue;
    const rules = rulesInForce(versions, atom.date);
    const week = startOfWeek(atom.date);
    const daily = rules.overtime.find((rule) => rule.period === 'day');
    const weekly = rulesInForce(versions, week).overtime.find((rule) => rule.period === 'week');

    const dayBefore = dayTotals.get(atom.date) ?? 0;
    dayTotals.set(atom.date, dayBefore + minutes);
    const underDay = daily
      ? Math.max(0, Math.min(minutes, daily.thresholdMinutes - dayBefore))
      : minutes;
    const dailyOvertime = minutes - underDay;

    const weekBefore = weekRegular.get(week) ?? 0;
    const regular = weekly
      ? Math.max(0, Math.min(underDay, weekly.thresholdMinutes - weekBefore))
      : underDay;
    const weeklyOvertime = underDay - regular;
    weekRegular.set(week, weekBefore + regular);

    const nightExtra =
      atom.night && rules.nightPremium ? toBasisPoints(rules.nightPremium.multiplier) - BASE_BP : 0;
    const base = { date: atom.date, night: atom.night && nightExtra > 0 };
    priced.push({
      ...base,
      category: 'regular',
      minutes: regular,
      multiplierBp: BASE_BP + nightExtra,
    });
    if (weekly && weeklyOvertime > 0) {
      priced.push({
        ...base,
        category: 'overtime',
        minutes: weeklyOvertime,
        multiplierBp: toBasisPoints(weekly.multiplier) + nightExtra,
      });
    }
    if (daily && dailyOvertime > 0) {
      priced.push({
        ...base,
        category: 'overtime',
        minutes: dailyOvertime,
        multiplierBp: toBasisPoints(daily.multiplier) + nightExtra,
      });
    }
  }
  return priced;
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
