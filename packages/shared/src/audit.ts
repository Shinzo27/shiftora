import { z } from 'zod';

/**
 * The owner's audit log (W7 D4): who changed what, newest first, filtered by what was changed.
 *
 * `entity` is the kind of thing (`shift`, `employee`, …) and `entityId` one particular row — the
 * screen links each entry to "everything that ever happened to this one". Paging is by cursor
 * (the last row's position), so a page stays correct while new entries arrive at the top.
 */

/** The kinds of thing the API audits today, in the order the filter lists them. */
export const auditEntities = [
  'shift',
  'schedule',
  'shift_template',
  'shift_request',
  'coverage_requirement',
  'employee',
  'time_off',
  'time_entry',
  'pay_period',
  'pay_rules',
  'location',
  'department',
  'job_role',
  'membership',
  'invite',
  'organization',
  'delivery',
] as const;
export type AuditEntity = (typeof auditEntities)[number];

const instant = z.iso.datetime({ offset: true });

export const auditQuery = z
  .object({
    entity: z.enum(auditEntities).optional(),
    entityId: z.uuid().optional(),
    /** The member's user id: "what did Ravi change?" */
    actorUserId: z.uuid().optional(),
    /** Inclusive start and exclusive end; the client sends local-day boundaries. */
    from: instant.optional(),
    to: instant.optional(),
    /** Opaque: the `nextCursor` of the previous page. */
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((query) => !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to), {
    path: ['to'],
    message: 'The end of the range must be after the start',
  });
export type AuditQuery = z.output<typeof auditQuery>;

export const auditEventView = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  /** `entity.past_tense`, e.g. `shift.updated`. */
  action: z.string(),
  entity: z.string(),
  entityId: z.uuid(),
  /** Who did it; null for the system (a job, a provider report). */
  actor: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEventView = z.output<typeof auditEventView>;

export const auditPage = z.object({
  items: z.array(auditEventView),
  /** Pass back as `cursor` for the next (older) page; null when this was the last. */
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.output<typeof auditPage>;
