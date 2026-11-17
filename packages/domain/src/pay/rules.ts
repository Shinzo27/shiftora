import type { LocalDate, LocalTime } from '../time/zoned.js';

/**
 * An organisation's pay rules, as data (PRD A4, ARCHITECTURE §7.8). Owner's decisions (W6):
 * one rule set per organisation (no per-location override yet); a new organisation has **none**
 * — plain hourly pay — until the owner writes some, because Shiftora does not assume a labour-law
 * rule on a clinic's behalf; and premiums **add** (overtime 1.5× in the night window at 1.25× is
 * 1 + 0.5 + 0.25 = 1.75× base).
 *
 * Multipliers are decimals with at most two places (1.5, 1.25, 2); the engine works in basis
 * points (15 000 = 1.5×) so money is never multiplied by a float.
 */
export interface OvertimeRule {
  /** `day`: beyond N minutes on one local date; `week`: beyond N minutes Monday to Sunday. */
  period: 'day' | 'week';
  thresholdMinutes: number;
  multiplier: number;
}

export interface NightPremium {
  /** Local wall-clock window; an end not after the start wraps past midnight (22:00–06:00). */
  startLocal: LocalTime;
  endLocal: LocalTime;
  multiplier: number;
}

export interface BreakRule {
  /** A stretch of work longer than this… */
  afterMinutes: number;
  /** …has this many unpaid minutes taken out of it. */
  deductMinutes: number;
}

/** The rounding grids a clinic can choose: 1 (no rounding), 5, 6, 10, 15 or 30 minutes. */
export type RoundingGrid = 1 | 5 | 6 | 10 | 15 | 30;

export interface RoundingRule {
  /** Punches are rounded to this grid. */
  toMinutes: RoundingGrid;
  mode: 'nearest' | 'up' | 'down';
}

export interface PayRules {
  overtime: OvertimeRule[];
  nightPremium: NightPremium | null;
  breaks: BreakRule[];
  rounding: RoundingRule | null;
}

/** What an organisation with no rule set is paid by: hours × rate, nothing else. */
export const NO_PAY_RULES: PayRules = {
  overtime: [],
  nightPremium: null,
  breaks: [],
  rounding: null,
};

/** One saved version. Versions never change; a new one starts on its `effectiveFrom`. */
export interface PayRulesVersion {
  version: number;
  effectiveFrom: LocalDate;
  rules: PayRules;
}

/**
 * The rules in force on a local date: the latest version whose `effectiveFrom` is on or before
 * it. So recalculating an old period uses the rules of that time, whatever has changed since.
 * Before the first version (or with none) the organisation is on plain hourly pay.
 */
export function rulesInForce(versions: readonly PayRulesVersion[], date: LocalDate): PayRules {
  let found: PayRulesVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom <= date && (!found || version.effectiveFrom > found.effectiveFrom)) {
      found = version;
    }
  }
  return found?.rules ?? NO_PAY_RULES;
}

/** 1.5 → 15 000. Multipliers have at most two decimals, so this is exact. */
export function toBasisPoints(multiplier: number): number {
  return Math.round(multiplier * 10_000);
}
