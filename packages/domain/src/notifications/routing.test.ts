import { describe, expect, it } from 'vitest';

import { ALL_CHANNELS, routeChannels, type Recipient } from './routing.js';

const person = (overrides: Partial<Recipient> = {}): Recipient => ({
  preferredChannel: null,
  email: 'asha@sunriseclinic.test',
  phone: null,
  pushSubscriptions: 0,
  ...overrides,
});

describe('routeChannels', () => {
  it('defaults to email when nobody has expressed a preference', () => {
    // Silence is not consent: WhatsApp and SMS cost money per message.
    expect(routeChannels(person(), ALL_CHANNELS)).toEqual(['email']);
  });

  it('honours WhatsApp when the person asked for it and there is a number', () => {
    const channels = routeChannels(
      person({ preferredChannel: 'whatsapp', phone: '+919820000001' }),
      ALL_CHANNELS,
    );
    // WhatsApp first, email as the safety net; no silent SMS, and no push without a subscription.
    expect(channels).toEqual(['whatsapp', 'email']);
  });

  it('falls through to email when the preferred channel has no address', () => {
    expect(routeChannels(person({ preferredChannel: 'whatsapp' }), ALL_CHANNELS)).toEqual([
      'email',
    ]);
  });

  it('respects what the tenant may use', () => {
    const noWhatsApp = { ...ALL_CHANNELS, whatsapp: false };
    expect(
      routeChannels(person({ preferredChannel: 'whatsapp', phone: '+919820000001' }), noWhatsApp),
    ).toEqual(['email']);
  });

  it('puts push first for someone who subscribed, with email behind it', () => {
    expect(
      routeChannels(person({ preferredChannel: 'push', pushSubscriptions: 2 }), ALL_CHANNELS),
    ).toEqual(['push', 'email']);
  });

  it('returns nothing when there is nowhere to send', () => {
    // An employee with no email address and no phone: the fan-out records a skipped delivery.
    expect(routeChannels(person({ email: null }), ALL_CHANNELS)).toEqual([]);
  });

  it('never repeats a channel', () => {
    const channels = routeChannels(
      person({ preferredChannel: 'email', phone: '+919820000001', pushSubscriptions: 1 }),
      ALL_CHANNELS,
    );
    expect(channels).toEqual(['email', 'push']);
    expect(new Set(channels).size).toBe(channels.length);
  });
});
