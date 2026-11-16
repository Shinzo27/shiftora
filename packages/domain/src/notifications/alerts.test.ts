import { describe, expect, it } from 'vitest';

import { leadLabel, missedClockInWindow, reminderWindow } from './alerts.js';

const now = new Date('2026-11-16T03:30:00Z'); // 09:00 in Asia/Kolkata

describe('reminderWindow', () => {
  it('covers the next two hours, excluding now', () => {
    const window = reminderWindow(now);
    expect(window.after).toEqual(now);
    expect(window.until).toEqual(new Date('2026-11-16T05:30:00Z'));
  });
});

describe('missedClockInWindow', () => {
  it('starts after the grace and looks back four hours, no further', () => {
    const window = missedClockInWindow(now, 5);
    expect(window.until).toEqual(new Date('2026-11-16T03:25:00Z'));
    expect(window.after).toEqual(new Date('2026-11-15T23:30:00Z'));
  });

  it('with no grace, a shift that started this minute is already late', () => {
    expect(missedClockInWindow(now, 0).until).toEqual(now);
  });
});

describe('leadLabel', () => {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it.each([
    [120, 'in 2 hours'],
    [60, 'in 1 hour'],
    [95, 'in 1 hour 35 minutes'],
    [20, 'in 20 minutes'],
    [1, 'in 1 minute'],
  ])('%i minutes reads "%s"', (minutes, label) => {
    expect(leadLabel(at(minutes), now)).toBe(label);
  });

  it('never says "in 0 minutes" for a shift that is about to start', () => {
    expect(leadLabel(at(0.2), now)).toBe('in 1 minute');
  });
});
