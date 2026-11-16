import { z } from 'zod';

import { requestShift } from './shift-requests.js';

/**
 * Open shifts (W5 D3): who could take one, offering it to them, and the list each person sees
 * of shifts they could pick up. Claiming one is W5 D4.
 */

/** One person, and whether they could take the shift (with the reasons when not, or warnings). */
export const eligibleCandidate = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  eligible: z.boolean(),
  /** Why not (blocking), or what a manager should know (availability) — ready to show. */
  reasons: z.array(z.string()),
});
export type EligibleCandidate = z.output<typeof eligibleCandidate>;

export const shiftCandidates = z.object({
  shiftId: z.uuid(),
  candidates: z.array(eligibleCandidate),
});
export type ShiftCandidates = z.output<typeof shiftCandidates>;

export const offerResult = z.object({
  shiftId: z.uuid(),
  offeredAt: z.iso.datetime(),
  /** How many people were told; 0 means nobody can take it as things stand. */
  offeredTo: z.number().int(),
});
export type OfferResult = z.output<typeof offerResult>;

/** An open shift the caller could pick up. */
export const openShift = requestShift.extend({
  endsAt: z.iso.datetime(),
  offeredAt: z.iso.datetime(),
});
export type OpenShift = z.output<typeof openShift>;
