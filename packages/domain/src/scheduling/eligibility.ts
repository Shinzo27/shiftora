import type { ShiftWarning } from './validation.js';

/**
 * Can this person take this shift? One answer for both places that ask it: approving a swap or
 * drop (W5 D2) and offering an open shift (W5 D3).
 *
 * Two kinds of problem, as with a manager placing a shift by hand:
 * - **blocking**: nobody can talk past these — the person is archived, does not work at the
 *   location, lacks the shift's job role, or would be in two places at once;
 * - **advisories**: the `validateShift` warnings a manager may knowingly overrule (time off,
 *   availability, weekly hours, rest).
 *
 * `validateShift` produces the warnings (overlap included); this adds the facts about the
 * person and sorts the lot.
 */

export type BlockingReason = 'archived' | 'not_at_location' | 'missing_role' | 'overlap';

export interface Blocker {
  reason: BlockingReason;
  message: string;
}

export interface EligibilityInput {
  employee: {
    status: 'active' | 'archived';
    locationIds: readonly string[];
    jobRoleIds: readonly string[];
  };
  shift: { locationId: string; jobRoleId: string | null };
  /** `validateShift` for this person and this shift (their other shifts, time off…). */
  warnings: readonly ShiftWarning[];
}

export interface Assessment {
  blocking: Blocker[];
  advisories: ShiftWarning[];
}

export function assessAssignment(input: EligibilityInput): Assessment {
  const blocking: Blocker[] = [];
  if (input.employee.status === 'archived') {
    blocking.push({ reason: 'archived', message: 'Archived' });
  }
  if (!input.employee.locationIds.includes(input.shift.locationId)) {
    blocking.push({ reason: 'not_at_location', message: 'Does not work at this location' });
  }
  if (input.shift.jobRoleId && !input.employee.jobRoleIds.includes(input.shift.jobRoleId)) {
    blocking.push({ reason: 'missing_role', message: 'Does not have this shift’s job role' });
  }
  for (const warning of input.warnings) {
    if (warning.code === 'overlap') blocking.push({ reason: 'overlap', message: warning.message });
  }
  return {
    blocking,
    advisories: input.warnings.filter((warning) => warning.code !== 'overlap'),
  };
}

/**
 * Who is offered an open shift: nothing blocking, and nothing a manager would have to overrule
 * — except availability, which is a preference. Offering a shift that breaks someone's rest or
 * weekly hours would invite them to take something the manager then has to refuse.
 */
export function canTakeOpenShift(assessment: Assessment): boolean {
  return (
    assessment.blocking.length === 0 &&
    assessment.advisories.every((warning) => warning.code === 'unavailable')
  );
}

/** A manager approving a swap or drop must say "yes, anyway" to these (none are silent). */
export function needsAcknowledgement(assessment: Assessment): boolean {
  return assessment.advisories.length > 0;
}
