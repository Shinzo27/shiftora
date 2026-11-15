import { z } from 'zod';

/**
 * What a browser hands over when someone turns notifications on: the push service's URL and the
 * two keys the payload is encrypted with. `endpoint` is validated as a URL here because a
 * malformed one would otherwise only fail later, inside a worker job, with no request to blame.
 */
export const pushSubscribeRequest = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
});
export type PushSubscribeRequest = z.output<typeof pushSubscribeRequest>;
