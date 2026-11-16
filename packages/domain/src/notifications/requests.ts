import type { LocalDate, LocalTime } from '../time/zoned.js';
import { dayLabel, type RenderedMessage } from './templates.js';

/**
 * Messages about swap and drop requests (W5 D2): to the colleague who is asked, to the managers
 * who decide, and to the people the decision affects. Plain text, first line carries the news.
 */

export interface RequestShiftLine {
  date: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime;
  locationName: string;
}

export interface RequestMessageContext {
  type: 'swap' | 'drop';
  requesterName: string;
  colleagueName: string | null;
  shift: RequestShiftLine;
  /** The colleague's shift the requester takes in return, if the swap names one. */
  returnShift: RequestShiftLine | null;
  note: string | null;
  decisionNote: string | null;
  appUrl?: string;
}

const line = (shift: RequestShiftLine) =>
  `${dayLabel(shift.date)} · ${shift.startTime}–${shift.endTime} · ${shift.locationName}`;

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** To the named colleague: "will you take my shift?" */
export function renderSwapAsked(context: RequestMessageContext): RenderedMessage {
  const { requesterName, colleagueName, shift, returnShift, note, appUrl } = context;
  return {
    subject: `${requesterName} asks you to take a shift · ${dayLabel(shift.date)} ${shift.startTime}`,
    body: [
      `Hi ${first(colleagueName ?? '')}, ${requesterName} would like you to take this shift:`,
      '',
      line(shift),
      ...(returnShift ? ['', `In return they would take yours: ${line(returnShift)}`] : []),
      ...(note ? ['', `“${note}”`] : []),
      '',
      'If you accept, a manager still has to approve it.',
      ...(appUrl ? ['', `Answer in the app: ${appUrl}`] : []),
    ].join('\n'),
  };
}

/** To the managers of the location: a drop to decide, or a swap both sides agreed to. */
export function renderRequestForManager(
  context: RequestMessageContext & { managerName: string },
): RenderedMessage {
  const { type, requesterName, colleagueName, shift, returnShift, note, appUrl } = context;
  const colleague = colleagueName ?? 'a colleague';
  const subject =
    type === 'drop'
      ? `${requesterName} asks to drop a shift · ${dayLabel(shift.date)} ${shift.startTime}`
      : `Swap to approve: ${requesterName} → ${colleague} · ${dayLabel(shift.date)} ${shift.startTime}`;
  return {
    subject,
    body: [
      `Hi ${first(context.managerName)},`,
      '',
      type === 'drop'
        ? `${requesterName} asks to give up this shift:`
        : `${requesterName} and ${colleague} agreed to swap. ${colleague} would take:`,
      line(shift),
      ...(returnShift ? [`and ${requesterName} would take: ${line(returnShift)}`] : []),
      ...(note ? ['', `Reason: “${note}”`] : []),
      '',
      'It waits for your decision; nothing changes on the rota until you approve.',
      ...(appUrl ? ['', `Decide: ${appUrl}`] : []),
    ].join('\n'),
  };
}

export type RequestOutcome = 'approved' | 'rejected' | 'declined' | 'cancelled';

/** To someone the outcome affects: the requester, or the colleague. */
export function renderRequestOutcome(
  context: RequestMessageContext & { outcome: RequestOutcome; recipientName: string },
): RenderedMessage {
  const { type, outcome, requesterName, colleagueName, shift, decisionNote, appUrl } = context;
  const what = type === 'drop' ? 'drop' : 'swap';
  const when = `${dayLabel(shift.date)} ${shift.startTime}`;
  const subject = {
    approved: `The ${what} was approved · ${when}`,
    rejected: `The ${what} was not approved · ${when}`,
    declined: `${colleagueName ?? 'Your colleague'} can’t take your shift · ${when}`,
    cancelled: `${requesterName} withdrew the swap · ${when}`,
  }[outcome];

  const news = {
    approved:
      type === 'drop'
        ? 'the shift is no longer yours; it is open for others to pick up.'
        : `${colleagueName ?? 'your colleague'} now works this shift.`,
    rejected: 'the rota stays as it was.',
    declined: 'the shift is still yours. You can ask someone else.',
    cancelled: 'nothing to do: the request was withdrawn.',
  }[outcome];

  return {
    subject,
    body: [
      `Hi ${first(context.recipientName)}, ${news}`,
      '',
      line(shift),
      ...(decisionNote ? ['', `Manager’s note: “${decisionNote}”`] : []),
      ...(appUrl ? ['', `See your shifts: ${appUrl}`] : []),
    ].join('\n'),
  };
}

/**
 * To someone who could take an open shift (W5 D3). Says plainly that it is first come, first
 * served, so nobody reads it as an assignment.
 */
export function renderOpenShiftOffered(context: {
  employeeName: string;
  shift: RequestShiftLine;
  roleName: string | null;
  appUrl?: string;
}): RenderedMessage {
  const { employeeName, shift, roleName, appUrl } = context;
  return {
    subject: `Open shift you can take · ${dayLabel(shift.date)} ${shift.startTime}–${shift.endTime}`,
    body: [
      `Hi ${first(employeeName)}, a shift is open and you are free to take it:`,
      '',
      `${line(shift)}${roleName ? ` · ${roleName}` : ''}`,
      '',
      'The first person to take it gets it.',
      ...(appUrl ? ['', `Take it in the app: ${appUrl}`] : []),
    ].join('\n'),
  };
}
