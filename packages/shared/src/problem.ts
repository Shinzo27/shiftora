/** Stable, machine-readable error codes. Clients branch on these, never on messages. */
export const errorCodes = {
  validationFailed: 'validation_failed',
  notFound: 'not_found',
  rateLimited: 'rate_limited',
  internal: 'internal_error',
  unauthenticated: 'auth.unauthenticated',
  emailTaken: 'auth.email_taken',
  invalidCredentials: 'auth.invalid_credentials',
  invalidRefreshToken: 'auth.invalid_refresh_token',
  /** A one-time link that is unknown, expired or already used — the same answer for all three. */
  invalidToken: 'auth.invalid_token',
  /** The address is already confirmed, so there is nothing to do. */
  alreadyVerified: 'auth.already_verified',
  forbidden: 'auth.forbidden',
  orgRequired: 'org.required',
  notMember: 'org.not_member',
  memberNotFound: 'org.member_not_found',
  lastOwner: 'org.last_owner',
  inviteInvalid: 'invite.invalid',
  inviteEmailMismatch: 'invite.email_mismatch',
  alreadyMember: 'invite.already_member',
  nameTaken: 'conflict.name_taken',
  locationNotFound: 'location.not_found',
  locationReadOnly: 'location.read_only',
  ownerUnrestricted: 'location.owner_unrestricted',
  departmentNotFound: 'department.not_found',
  jobRoleNotFound: 'job_role.not_found',
  duplicate: 'conflict.duplicate',
  employeeNotFound: 'employee.not_found',
  employeeArchived: 'employee.archived',
  timeOffNotFound: 'time_off.not_found',
  shiftTemplateNotFound: 'shift_template.not_found',
  scheduleNotFound: 'schedule.not_found',
  shiftNotFound: 'shift.not_found',
  /** The employee is already working at that time (also enforced by the database). */
  shiftOverlap: 'shift.overlap',
  /** Someone else changed the shift since this version was read. */
  shiftVersionConflict: 'shift.version_conflict',
  /** The punch was made outside the location's radius and the org refuses those. */
  attendanceOutsideGeofence: 'attendance.outside_geofence',
  /** Clocking out without an open punch. */
  attendanceNoOpenEntry: 'attendance.no_open_entry',
  /** Already clocked in: one open punch per person (also a unique index). */
  attendanceAlreadyClockedIn: 'attendance.already_clocked_in',
  /** The login has no staff profile, so there is nothing to clock in as. */
  attendanceNotLinked: 'attendance.not_linked',
  /** A punch that does not exist (or is not in the caller's scope). */
  timeEntryNotFound: 'time_entry.not_found',
  deliveryNotFound: 'delivery.not_found',
  deliveryNotDeadLettered: 'delivery.not_dead_lettered',
  shiftRequestNotFound: 'shift_request.not_found',
  /** This action does not apply to the request now (already decided, or not yours to take). */
  shiftRequestInvalidTransition: 'shift_request.invalid_transition',
  /** The shift (or the one given in return) already has a request waiting. */
  shiftRequestAlreadyOpen: 'shift_request.already_open',
  /** Only shifts staff were told about (in the latest publication) can be swapped or dropped. */
  shiftRequestNotPublished: 'shift_request.not_published',
  /** The shift has started: it is too late to swap or drop it. */
  shiftRequestExpired: 'shift_request.expired',
  /** Approving would break a rule nobody can overrule (location, job role, overlap). */
  shiftRequestNotEligible: 'shift_request.not_eligible',
  /** Approving would break a rule a manager may overrule: say so with acknowledgeWarnings. */
  shiftRequestNeedsAcknowledgement: 'shift_request.needs_acknowledgement',
  /** The caller has no staff profile in this organisation, so has no shifts to request about. */
  staffProfileRequired: 'employee.profile_required',
  /** A provider webhook whose signature does not match the shared secret. */
  webhookBadSignature: 'webhook.bad_signature',
  /** The provider's webhook is not configured here (no secret), so nothing is accepted. */
  webhookNotConfigured: 'webhook.not_configured',
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes] | (string & {});

export interface FieldError {
  /** Dot path of the invalid field, e.g. "email" or "shifts.0.startsAt". */
  path: string;
  message: string;
}

/** RFC 7807 "problem details" body, plus our stable `code`. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: FieldError[];
}
