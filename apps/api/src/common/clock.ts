import type { Clock } from '@shiftora/domain';

/** Injection token for the current time. Tests provide fixedClock() instead. */
export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };
