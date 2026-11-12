import type { LocalDate, LocalTime } from '../time/zoned.js';

/**
 * What a manager published: the shape of one shift as it stood when the week was sent out.
 * Only the fields that matter to a person's day are kept — enough to tell "nothing changed"
 * from "the same shift, someone else, or another day".
 */
export interface PublishedShift {
  shiftId: string;
  employeeId: string | null;
  date: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime;
  breakMinutes: number;
  jobRoleId: string | null;
}

export interface PublicationChange {
  before: PublishedShift;
  after: PublishedShift;
}

export interface PublicationDiff {
  /** Shifts that were not in the previous publication. */
  added: PublishedShift[];
  /** Shifts that moved, changed hands or changed times. */
  changed: PublicationChange[];
  /** Shifts that were published before and are gone now. */
  removed: PublishedShift[];
  /**
   * Everyone whose week is different from what they were told: both sides of a re-assignment,
   * the people on new shifts, and the people who lost one. Sorted, unique, never null.
   */
  affectedEmployeeIds: string[];
}

/**
 * The difference between what staff were last told and what is on the board now.
 *
 * Publishing is not "save": a draft can change a hundred times, but a person should only hear
 * about the shifts that actually concern them. Comparing by `shiftId` means an unchanged shift
 * is silent even when it is re-sent, and a shift that changed hands notifies **both** people.
 *
 * Pure: the caller supplies the previous publication and the current week.
 */
export function diffPublication(
  previous: readonly PublishedShift[],
  current: readonly PublishedShift[],
): PublicationDiff {
  const before = new Map(previous.map((shift) => [shift.shiftId, shift]));
  const after = new Map(current.map((shift) => [shift.shiftId, shift]));

  const added: PublishedShift[] = [];
  const changed: PublicationChange[] = [];
  const removed: PublishedShift[] = [];

  for (const shift of sortShifts(current)) {
    const was = before.get(shift.shiftId);
    if (!was) added.push(shift);
    else if (!sameShift(was, shift)) changed.push({ before: was, after: shift });
  }
  for (const shift of sortShifts(previous)) {
    if (!after.has(shift.shiftId)) removed.push(shift);
  }

  const affected = new Set<string>();
  const note = (shift: PublishedShift | null | undefined) => {
    if (shift?.employeeId) affected.add(shift.employeeId);
  };
  added.forEach(note);
  removed.forEach(note);
  for (const change of changed) {
    note(change.before);
    note(change.after);
  }

  return {
    added,
    changed,
    removed,
    affectedEmployeeIds: [...affected].sort(),
  };
}

/** True when the shift is identical for the person who works it. */
function sameShift(a: PublishedShift, b: PublishedShift): boolean {
  return (
    a.employeeId === b.employeeId &&
    a.date === b.date &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.breakMinutes === b.breakMinutes &&
    a.jobRoleId === b.jobRoleId
  );
}

/** Chronological, then by id: the same week always produces the same arrays. */
function sortShifts(shifts: readonly PublishedShift[]): PublishedShift[] {
  return [...shifts].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.shiftId.localeCompare(b.shiftId),
  );
}
