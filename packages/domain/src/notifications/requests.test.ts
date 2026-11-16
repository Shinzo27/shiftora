import { describe, expect, it } from 'vitest';

import {
  renderOpenShiftOffered,
  renderRequestForManager,
  renderRequestOutcome,
  renderSwapAsked,
} from './requests.js';

const base = {
  type: 'swap' as const,
  requesterName: 'Asha Mehta',
  colleagueName: 'Rohan Desai',
  shift: { date: '2026-11-30', startTime: '09:00', endTime: '17:00', locationName: 'Andheri' },
  returnShift: null,
  note: 'Family wedding',
  decisionNote: null,
};

describe('request messages', () => {
  it('asks the colleague, says a manager still decides, and quotes the reason', () => {
    const message = renderSwapAsked({ ...base, appUrl: 'http://app/o/x/shifts' });
    expect(message.subject).toBe('Asha Mehta asks you to take a shift · Mon 30 Nov 09:00');
    expect(message.body).toContain('Hi Rohan, Asha Mehta would like you to take this shift:');
    expect(message.body).toContain('Mon 30 Nov · 09:00–17:00 · Andheri');
    expect(message.body).toContain('“Family wedding”');
    expect(message.body).toContain('a manager still has to approve it');
  });

  it('names the shift offered in return', () => {
    const message = renderSwapAsked({
      ...base,
      returnShift: {
        date: '2026-12-01',
        startTime: '14:00',
        endTime: '22:00',
        locationName: 'Andheri',
      },
    });
    expect(message.body).toContain('In return they would take yours: Tue 1 Dec · 14:00–22:00');
  });

  it('tells a manager what is waiting: a drop, or an agreed swap', () => {
    const drop = renderRequestForManager({ ...base, type: 'drop', managerName: 'Priya Nair' });
    expect(drop.subject).toBe('Asha Mehta asks to drop a shift · Mon 30 Nov 09:00');
    const swap = renderRequestForManager({ ...base, managerName: 'Priya Nair' });
    expect(swap.subject).toBe('Swap to approve: Asha Mehta → Rohan Desai · Mon 30 Nov 09:00');
    expect(swap.body).toContain('nothing changes on the rota until you approve');
  });

  it('tells people the outcome, with the manager’s note', () => {
    const approved = renderRequestOutcome({
      ...base,
      outcome: 'approved',
      recipientName: 'Asha Mehta',
      decisionNote: 'Cover sorted',
    });
    expect(approved.subject).toBe('The swap was approved · Mon 30 Nov 09:00');
    expect(approved.body).toContain('Rohan Desai now works this shift.');
    expect(approved.body).toContain('Manager’s note: “Cover sorted”');

    const declined = renderRequestOutcome({
      ...base,
      outcome: 'declined',
      recipientName: 'Asha Mehta',
    });
    expect(declined.subject).toBe('Rohan Desai can’t take your shift · Mon 30 Nov 09:00');

    const dropped = renderRequestOutcome({
      ...base,
      type: 'drop',
      outcome: 'approved',
      recipientName: 'Asha Mehta',
    });
    expect(dropped.body).toContain('open for others to pick up');
  });
});

describe('open shift offers', () => {
  it('says it is first come, first served, with the role', () => {
    const message = renderOpenShiftOffered({
      employeeName: 'Meera Iyer',
      shift: base.shift,
      roleName: 'Nurse',
    });
    expect(message.subject).toBe('Open shift you can take · Mon 30 Nov 09:00–17:00');
    expect(message.body).toContain('Mon 30 Nov · 09:00–17:00 · Andheri · Nurse');
    expect(message.body).toContain('The first person to take it gets it.');
  });
});
