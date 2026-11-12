/**
 * Matching a punch to the shift it belongs to — pure, so the rules are testable and the API and
 * the timesheet can never disagree about what "late" means.
 *
 * A punch usually carries its shift id from the app (it knows which shift is on screen), but not
 * always: someone clocks in from the lock screen, or a manager enters a punch by hand. Then the
 * server decides, and the rule is deliberately boring — the employee's shift whose start is
 * nearest to the punch, if the punch falls inside that shift with a couple of hours of slack.
 */

export interface PlannableShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

export type PunchState = 'on_time' | 'early' | 'late' | 'unscheduled';

export interface ShiftMatch {
  shift: PlannableShift | null;
  /** Minutes late against the shift start, beyond the grace — 0 when on time or unmatched. */
  lateMinutes: number;
  /** Minutes early against the shift start, beyond the grace. */
  earlyMinutes: number;
  state: PunchState;
}

/** How far outside a shift a punch may fall and still be considered for it. */
const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

const MINUTE = 60_000;

/**
 * Clocks may be a little out, and people arrive a little early: inside the grace, a punch counts
 * as on time. Beyond it, the time is reported — never blocked, because the punch has happened.
 */
export function matchShift(
  punchAt: Date,
  shifts: PlannableShift[],
  graceMinutes: number,
): ShiftMatch {
  const windowed = shifts.filter(
    (shift) =>
      punchAt.getTime() >= shift.startsAt.getTime() - MATCH_WINDOW_MS &&
      punchAt.getTime() <= shift.endsAt.getTime() + MATCH_WINDOW_MS,
  );

  if (windowed.length === 0) {
    return { shift: null, lateMinutes: 0, earlyMinutes: 0, state: 'unscheduled' };
  }

  // Nearest start wins: an overnight shift and the morning one it runs into must not be
  // ambiguous, and "which one was starting around then" is exactly that question.
  const shift = windowed.reduce((best, candidate) =>
    Math.abs(candidate.startsAt.getTime() - punchAt.getTime()) <
    Math.abs(best.startsAt.getTime() - punchAt.getTime())
      ? candidate
      : best,
  );

  const deltaMinutes = Math.floor((punchAt.getTime() - shift.startsAt.getTime()) / MINUTE);
  const grace = Math.max(0, graceMinutes);

  if (deltaMinutes > grace) {
    return { shift, lateMinutes: deltaMinutes - grace, earlyMinutes: 0, state: 'late' };
  }
  if (deltaMinutes < -grace) {
    return { shift, lateMinutes: 0, earlyMinutes: -deltaMinutes - grace, state: 'early' };
  }
  return { shift, lateMinutes: 0, earlyMinutes: 0, state: 'on_time' };
}

/** Paid-against-planned for a closed punch, in minutes; null while it is still open. */
export function workedMinutes(clockInAt: Date, clockOutAt: Date | null): number {
  if (!clockOutAt) return 0;
  return Math.max(0, Math.round((clockOutAt.getTime() - clockInAt.getTime()) / MINUTE));
}
