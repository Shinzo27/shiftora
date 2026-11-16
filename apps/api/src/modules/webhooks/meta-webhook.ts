import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ProviderReport } from '@shiftora/shared';
import { z } from 'zod';

/**
 * Meta (WhatsApp Cloud API) webhooks: checking the signature, and reading delivery statuses out
 * of the payload. Pure functions, so the controller stays a thin HTTP shell.
 */

/**
 * True when `header` is `sha256=<hex HMAC-SHA256 of the raw body with the app secret>`.
 *
 * The raw bytes, not a re-serialised object: JSON.stringify of the parsed body need not match
 * what Meta signed. Compared in constant time, so the check does not leak how much matched.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Loose on purpose: Meta adds fields, and a webhook we refuse is retried for days. Only what we
// use is checked; everything else passes through and is dropped.
const metaStatus = z.looseObject({
  id: z.string().min(1).max(256),
  status: z.string(),
  timestamp: z.string().regex(/^\d+$/),
  errors: z
    .array(z.looseObject({ code: z.number().optional(), title: z.string().optional() }))
    .optional(),
});

const metaWebhook = z.looseObject({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.looseObject({
      changes: z.array(
        z.looseObject({
          field: z.string(),
          value: z.looseObject({ statuses: z.array(z.unknown()).optional() }),
        }),
      ),
    }),
  ),
});

const KNOWN = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * The delivery statuses in a webhook, normalised. Incoming messages, unknown status kinds
 * (Meta has `deleted`, `warning`…) and malformed entries are skipped, not refused: one odd entry
 * must not lose the others in the same batch. The recipient's phone number, which Meta includes,
 * is never carried forward.
 *
 * Returns null when the body is not a WhatsApp Business webhook at all.
 */
export function readMetaStatuses(body: unknown): ProviderReport[] | null {
  const parsed = metaWebhook.safeParse(body);
  if (!parsed.success) return null;

  const reports: ProviderReport[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      for (const raw of change.value.statuses ?? []) {
        const status = metaStatus.safeParse(raw);
        if (!status.success || !KNOWN.has(status.data.status)) continue;
        const error = status.data.errors?.[0];
        reports.push({
          messageId: status.data.id,
          status: status.data.status as ProviderReport['status'],
          at: new Date(Number(status.data.timestamp) * 1000).toISOString(),
          ...(error?.title
            ? { error: `${error.title}${error.code ? ` (${error.code})` : ''}`.slice(0, 500) }
            : {}),
        });
      }
    }
  }
  return reports;
}
