import type { LocalDate } from '@shiftora/domain';
import type { Shift, ShiftConflict, ShiftWarning } from '@shiftora/shared';

/** What a drop asks for: the same shift on another day and/or someone else's row. */
export interface ShiftMove {
  id: string;
  date: LocalDate;
  employeeId: string | null;
}

/** A move as the API needs it: the version it was dragged from, so a stale drop is refused. */
export interface ShiftMoveRequest extends ShiftMove {
  version: number;
}

/**
 * The week's shifts with one shift moved, for the optimistic update while the API answers.
 * Pure so the rollback path (restore the previous list) is trivially correct.
 */
export function applyShiftMove(shifts: readonly Shift[], move: ShiftMove): Shift[] {
  return shifts.map((shift) =>
    shift.id === move.id
      ? {
          ...shift,
          date: move.date,
          employeeId: move.employeeId,
          status: move.employeeId ? 'assigned' : 'open',
        }
      : shift,
  );
}

/** Conflicts keyed by shift id, which is how the board looks them up per chip. */
export function conflictMap(
  conflicts: readonly ShiftConflict[] | undefined,
): Map<string, ShiftWarning[]> {
  return new Map((conflicts ?? []).map((entry) => [entry.shiftId, entry.warnings]));
}
