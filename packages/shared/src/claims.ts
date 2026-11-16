import { z } from 'zod';

import { shift, type Shift } from './shifts.js';

/**
 * Claiming an open shift (W5 D4).
 *
 * The claim is the one write in the product where two people press the same button at the same
 * moment, so the answer says which shift it was: `{ shift }`, the row as it now stands, with its
 * new `version` — a client that loses can refetch and see who has it.
 */
export const claimOpenShiftResult = z.object({ shift });
export type ClaimOpenShiftResult = { shift: Shift };

/** The header that makes a retry safe. Required on a claim, and echoed back in the error. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Long enough to be random, short enough to stay a header. */
export const idempotencyKeySchema = z.string().trim().min(8, 'Too short').max(200);
