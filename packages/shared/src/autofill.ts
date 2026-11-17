import { z } from 'zod';

/**
 * The auto-scheduler as the client sees it (W7 D3): start a run, then watch it.
 *
 * A run is a record, not a request: the solver can take a second or two, and a page that reloads
 * mid-run must still be able to ask what happened.
 */

export const autofillStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);
export type AutofillStatus = z.output<typeof autofillStatus>;

export const autofillBlocker = z.object({
  employeeName: z.string(),
  detail: z.string(),
});

/** A slot the solver could not fill, in the manager's language. */
export const unfilledSlotView = z.object({
  id: z.string(),
  date: z.string(),
  startLocal: z.string(),
  endLocal: z.string(),
  jobRoleId: z.uuid().nullable(),
  explanation: z.string(),
  blockers: z.array(autofillBlocker),
});
export type UnfilledSlotView = z.output<typeof unfilledSlotView>;

export const autofillRunView = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  status: autofillStatus,
  strategy: z.string().nullable(),
  assigned: z.number().int(),
  unfilled: z.array(unfilledSlotView),
  score: z
    .object({
      costMinor: z.number(),
      fairnessSpreadMinutes: z.number(),
      preferenceMatches: z.number(),
      unfilledSlots: z.number(),
    })
    .nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type AutofillRunView = z.output<typeof autofillRunView>;

/** Starting a run answers immediately: the work happens in the worker. */
export const autofillRequestResult = z.object({
  runId: z.uuid(),
  status: autofillStatus,
});
export type AutofillRequestResult = z.output<typeof autofillRequestResult>;
