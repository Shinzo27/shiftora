import { z } from 'zod';

import { localTime } from './employees.js';
import { localDate, schedule } from './scheduling.js';

/**
 * What one shift looked like when the week was published: the fields that change a person's
 * day. Instants are not needed — the wall clock at the location is what staff were told.
 */
export const publishedShift = z.object({
  shiftId: z.uuid(),
  employeeId: z.uuid().nullable(),
  date: localDate,
  startTime: localTime,
  endTime: localTime,
  breakMinutes: z.number().int(),
  jobRoleId: z.uuid().nullable(),
});
export type PublishedShift = z.output<typeof publishedShift>;

/** The difference between the last publication and the board, as the manager sees it. */
export const publicationDiff = z.object({
  added: z.array(publishedShift),
  changed: z.array(z.object({ before: publishedShift, after: publishedShift })),
  removed: z.array(publishedShift),
  /** Everyone whose week differs from what they were told (both sides of a re-assignment). */
  affectedEmployeeIds: z.array(z.uuid()),
});
export type PublicationDiff = z.output<typeof publicationDiff>;

export const publication = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  version: z.number().int(),
  publishedAt: z.iso.datetime(),
  publishedBy: z.uuid().nullable(),
  /** Who this told, and what changed — carried from the publish that created it. */
  diff: publicationDiff,
});
export type Publication = z.output<typeof publication>;

/** What the Publish dialog asks for before the manager commits. */
export const publishPreview = z.object({
  scheduleId: z.uuid(),
  /** The version the last publication sent; null when the week has never been published. */
  publishedVersion: z.number().int().nullable(),
  /** True when the diff has anything in it (an empty week publishes nothing). */
  hasChanges: z.boolean(),
  diff: publicationDiff,
});
export type PublishPreview = z.output<typeof publishPreview>;

export const publishResult = z.object({ schedule, publication });
export type PublishResult = z.output<typeof publishResult>;
