import { randomUUID } from 'node:crypto';

import type { MessageSender } from './dispatch.js';
import { SendError, type SendFailureKind } from './send-error.js';

/**
 * How every send fails. `undeliverable` is the late kind: the provider accepts the message, and
 * its delivery report says "failed" a moment later (a number that is not on WhatsApp).
 */
export type FakeFailure = 'none' | SendFailureKind | 'undeliverable';

/** What the fake provider reports about a message it accepted, as a real one's webhook would. */
export interface FakeReport {
  messageId: string;
  status: 'delivered' | 'read' | 'failed';
  at: Date;
  error?: string;
}

export interface FakeMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * A WhatsApp or SMS "provider" that sends nothing: it logs, remembers what it was given, and
 * fails on demand. The whole pipeline (quota, retries, dead letters, fallback, replay) is built
 * and tested against it, and the Meta adapter replaces it behind the same `MessageSender` shape.
 *
 * `failure` fails every send of that kind; `failNext(kind, n)` fails only the next n — which is
 * how a test makes a provider recover after two bad attempts. With `report`, every accepted
 * message is followed by delivery reports (delivered, and read for WhatsApp; or failed when
 * `undeliverable`), which main.ts posts to the API's webhook like Meta would.
 */
export class FakeMessageSender implements MessageSender {
  readonly sent: FakeMessage[] = [];
  private queued: SendFailureKind[] = [];

  constructor(
    readonly channel: 'whatsapp' | 'sms',
    private failure: FakeFailure = 'none',
    private readonly log: (line: string) => void = () => undefined,
    private readonly report: ((report: FakeReport) => void) | null = null,
  ) {}

  failNext(kind: SendFailureKind, times = 1): void {
    this.queued.push(...Array<SendFailureKind>(times).fill(kind));
  }

  failAlways(kind: FakeFailure): void {
    this.failure = kind;
  }

  send(message: FakeMessage): Promise<{ messageId: string }> {
    const failure =
      this.queued.shift() ??
      (this.failure === 'none' || this.failure === 'undeliverable' ? null : this.failure);
    if (failure) return Promise.reject(fakeError(this.channel, failure));

    this.sent.push(message);
    // Unique across restarts: a delivery report finds its row by this id.
    const messageId = `fake-${this.channel}-${randomUUID()}`;
    // Never the full number in a log (AGENTS.md): the last three digits are enough to follow it.
    this.log(`fake ${this.channel}: → …${message.to.slice(-3)} "${message.subject}"`);

    if (this.report) {
      const at = new Date();
      if (this.failure === 'undeliverable') {
        this.report({ messageId, status: 'failed', at, error: 'Message undeliverable' });
      } else {
        this.report({ messageId, status: 'delivered', at });
        // SMS has no read receipts.
        if (this.channel === 'whatsapp') this.report({ messageId, status: 'read', at });
      }
    }
    return Promise.resolve({ messageId });
  }
}

function fakeError(channel: string, kind: SendFailureKind): SendError {
  switch (kind) {
    case 'permanent':
      return new SendError(`Fake ${channel}: the number cannot receive messages`, 'permanent');
    case 'rate_limited':
      return new SendError(`Fake ${channel}: too many requests`, 'rate_limited', 1_000);
    case 'transient':
      return new SendError(`Fake ${channel}: provider unavailable (503)`, 'transient');
  }
}
