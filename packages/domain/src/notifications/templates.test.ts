import { describe, expect, it } from 'vitest';

import {
  dayLabel,
  renderMissedClockIn,
  renderMissedClockInForManager,
  renderSchedulePublished,
  renderShiftReminder,
  weekRange,
} from './templates.js';

const base = {
  employeeName: 'Asha Mehta',
  orgName: 'Sunrise Clinic',
  locationName: 'Andheri',
  weekStart: '2026-11-09',
  changes: { added: 0, changed: 0, removed: 0 },
};

describe('renderSchedulePublished', () => {
  it('leads with the news and lists the week in order', () => {
    const message = renderSchedulePublished({
      ...base,
      shifts: [
        { date: '2026-11-11', startTime: '08:00', endTime: '16:00', roleName: 'Nurse' },
        { date: '2026-11-09', startTime: '08:00', endTime: '16:00', roleName: 'Nurse' },
      ],
      appUrl: 'http://localhost:5173/shifts',
    });

    expect(message.subject).toBe('Your shifts at Andheri · 9–15 Nov');
    expect(message.body).toContain('Hi Asha, your week at Sunrise Clinic — Andheri is published.');
    // Sorted by date, not by insertion order.
    expect(message.body.indexOf('Mon 9 Nov')).toBeLessThan(message.body.indexOf('Wed 11 Nov'));
    expect(message.body).toContain('Mon 9 Nov · 08:00–16:00 (8h) · Nurse');
    expect(message.body).toContain('2 shifts · 16h this week.');
    expect(message.body).toContain('http://localhost:5173/shifts');
  });

  it('explains a week with nothing on it, rather than sending an empty list', () => {
    const message = renderSchedulePublished({ ...base, shifts: [] });
    expect(message.body).toContain('Nothing is rostered for you from 9–15 Nov.');
  });

  it('says what changed when the diff is not empty', () => {
    const message = renderSchedulePublished({
      ...base,
      shifts: [{ date: '2026-11-09', startTime: '08:00', endTime: '16:00' }],
      changes: { added: 1, changed: 0, removed: 2 },
    });
    expect(message.body).toContain('Changed since last week: 1 new, 2 removed.');
  });

  it('stays inside a WhatsApp utility template body', () => {
    const message = renderSchedulePublished({
      ...base,
      shifts: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-11-${String(9 + index).padStart(2, '0')}`,
        startTime: '08:00',
        endTime: '16:00',
        roleName: 'Nurse',
      })),
    });
    // Meta caps utility bodies at 1024 characters; a full week has to fit.
    expect(message.body.length).toBeLessThan(1024);
    expect(message.subject.length).toBeLessThan(60);
  });

  it('uses one friendly line for a one-shift week', () => {
    const message = renderSchedulePublished({
      ...base,
      shifts: [{ date: '2026-11-09', startTime: '08:00', endTime: '12:30' }],
    });
    expect(message.body).toContain('1 shift · 4h 30m this week.');
  });
});

describe('renderShiftReminder', () => {
  it('says when and where, in the smallest number of words', () => {
    const message = renderShiftReminder({
      employeeName: 'Rohan Desai',
      orgName: 'Sunrise Clinic',
      locationName: 'Bandra',
      date: '2026-11-10',
      startTime: '10:00',
      endTime: '18:00',
      lead: 'in 2 hours',
    });
    expect(message.subject).toBe('Shift in 2 hours · Tue 10 Nov 10:00–18:00');
    expect(message.body).toContain('starts in 2 hours');
  });
});

describe('renderMissedClockIn', () => {
  it('asks the person, not the manager', () => {
    const message = renderMissedClockIn({
      employeeName: 'Meera Iyer',
      orgName: 'Sunrise Clinic',
      locationName: 'Bandra',
      date: '2026-11-10',
      startTime: '09:00',
    });
    expect(message.subject).toBe('Did you clock in today? · Tue 10 Nov 09:00');
    expect(message.body).toContain('no clock-in has come through');
  });

  it('gives the manager who, where and since when, and says the person was told', () => {
    const message = renderMissedClockInForManager({
      managerName: 'Priya Shah',
      employeeName: 'Meera Iyer',
      orgName: 'Sunrise Clinic',
      locationName: 'Bandra',
      date: '2026-11-10',
      startTime: '09:00',
      appUrl: 'http://localhost:5173/o/x/timesheets',
    });
    expect(message.subject).toBe('Meera Iyer has not clocked in · Bandra 09:00');
    expect(message.body).toContain(
      "Hi Priya, Meera Iyer's shift at Bandra started at 09:00 on Tue 10 Nov",
    );
    expect(message.body).toContain('Meera has been reminded too.');
    expect(message.body).toContain('Timesheets: http://localhost:5173/o/x/timesheets');
  });
});

describe('dates as a person reads them', () => {
  it('collapses a week inside one month', () => {
    expect(weekRange('2026-11-09')).toBe('9–15 Nov');
  });

  it('names both months when the week straddles one', () => {
    expect(weekRange('2026-10-26')).toBe('26 Oct – 1 Nov');
  });

  it('names the weekday correctly', () => {
    expect(dayLabel('2026-11-09')).toBe('Mon 9 Nov');
    expect(dayLabel('2026-11-15')).toBe('Sun 15 Nov');
  });
});
