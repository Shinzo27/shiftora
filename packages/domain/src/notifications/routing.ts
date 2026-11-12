/** Where a message can go. */
export const CHANNELS = ['email', 'whatsapp', 'sms', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];

/** What we know about one person, which is all the routing may look at. */
export interface Recipient {
  /** Their own choice on the profile; null means "no preference recorded". */
  preferredChannel: Channel | null;
  email: string | null;
  phone: string | null;
  /** How many browsers/devices this person has subscribed for push. */
  pushSubscriptions: number;
}

/** What the tenant may use. Today an org setting; from week 8 it comes from the plan. */
export interface ChannelPolicy {
  whatsapp: boolean;
  sms: boolean;
  push: boolean;
  email: boolean;
}

export const ALL_CHANNELS: ChannelPolicy = { whatsapp: true, sms: true, push: true, email: true };

/**
 * The channels to try for one person, best first; the first is sent, the rest are the ladder.
 *
 * Two rules, both about not being rude:
 *
 * 1. **Their choice wins, or email.** Someone who asked for WhatsApp gets WhatsApp; someone who
 *    never said gets email — the one address every employee has, because it is their login.
 *    Silence is not consent to a channel the clinic pays for per message.
 * 2. **A preference with no address is not a preference.** A WhatsApp preference with no phone
 *    number falls through to email rather than failing at the provider.
 *
 * After the first channel, email and push are the safety nets: effectively free, and both reach
 * a phone. WhatsApp and SMS are never a fallback — paying for a second channel after a failure
 * is the org's decision (D4), not something routing assumes.
 */
export function routeChannels(recipient: Recipient, policy: ChannelPolicy): Channel[] {
  const chain: Channel[] = [];
  const primary = recipient.preferredChannel ?? 'email';

  const consider = (channel: Channel): void => {
    if (!chain.includes(channel) && policy[channel] && hasAddress(recipient, channel)) {
      chain.push(channel);
    }
  };

  consider(primary);
  if (primary !== 'email') consider('email');
  if (primary !== 'push') consider('push');

  return chain;
}

export function hasAddress(recipient: Recipient, channel: Channel): boolean {
  switch (channel) {
    case 'email':
      return Boolean(recipient.email);
    case 'whatsapp':
    case 'sms':
      return Boolean(recipient.phone);
    case 'push':
      return recipient.pushSubscriptions > 0;
  }
}

/** The address a channel sends to, or null when there is none (Web Push travels by subscription). */
export function addressFor(recipient: Recipient, channel: Channel): string | null {
  switch (channel) {
    case 'email':
      return recipient.email;
    case 'whatsapp':
    case 'sms':
      return recipient.phone;
    case 'push':
      return null;
  }
}
