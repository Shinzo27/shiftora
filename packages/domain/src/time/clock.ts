/**
 * The source of "now". Domain code receives a Clock instead of calling Date.now(),
 * so tests can control time (AGENTS.md → Time). The real system clock is created
 * in the apps, keeping this package free of side effects.
 */
export interface Clock {
  now(): Date;
}

/** A clock frozen at one instant, for tests. */
export function fixedClock(instant: Date | string): Clock {
  const ms = new Date(instant).getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid instant: ${String(instant)}`);
  }
  // A fresh Date per call, so a caller mutating the result can't change "now" for others.
  return { now: () => new Date(ms) };
}
