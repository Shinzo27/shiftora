import { z } from 'zod';

/**
 * The owner's view of outgoing messages (W4 D4): what could not be delivered, and how much of
 * the month's paid quota has been used.
 */

export const messageChannel = z.enum(['email', 'whatsapp', 'sms', 'push']);
export type MessageChannel = z.output<typeof messageChannel>;

/** A delivery the queue gave up on after every retry. */
export const deadLetter = z.object({
  id: z.uuid(),
  channel: messageChannel,
  /** The staff member's name, or the email address for a message to someone not yet staff. */
  recipient: z.string(),
  /** Recognisable, not copyable: "…001", "a•••@clinic.in". */
  address: z.string().nullable(),
  subject: z.string(),
  reason: z.string().nullable(),
  attempts: z.number().int(),
  replays: z.number().int(),
  deadLetteredAt: z.iso.datetime(),
  /** The channel the message moved on to, and how that went, if there was a fallback. */
  fallback: z.object({ channel: messageChannel, status: z.string() }).nullable(),
});
export type DeadLetter = z.output<typeof deadLetter>;

export const replayResult = z.object({
  id: z.uuid(),
  status: z.literal('queued'),
  replays: z.number().int(),
});
export type ReplayResult = z.output<typeof replayResult>;

export const channelUsage = z.object({
  channel: z.enum(['whatsapp', 'sms']),
  used: z.number().int(),
  limit: z.number().int(),
});

/** This month's paid messages against the quota (1,000 WhatsApp + 200 SMS per location). */
export const messageUsage = z.object({
  /** "YYYY-MM" on the billing calendar (Asia/Kolkata). */
  month: z.string(),
  channels: z.array(channelUsage),
});
export type MessageUsage = z.output<typeof messageUsage>;

/**
 * One provider delivery report, normalised (W4 D5). The API turns a verified webhook into a
 * `delivery.reported` platform event carrying a list of these; the worker applies them. Never the
 * phone number: the message id is all the worker needs to find the delivery.
 */
export const providerReport = z.object({
  messageId: z.string().min(1).max(256),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  at: z.iso.datetime(),
  /** The provider's reason for a failure, e.g. "Message undeliverable (131026)". */
  error: z.string().max(500).optional(),
});
export type ProviderReport = z.output<typeof providerReport>;

export const deliveryReportedEvent = z.object({
  channel: z.enum(['whatsapp', 'sms']),
  reports: z.array(providerReport).min(1),
});
export type DeliveryReportedEvent = z.output<typeof deliveryReportedEvent>;
