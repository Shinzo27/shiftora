import type { MessageSender } from './dispatch.js';
import { SendError, type SendFailureKind } from './send-error.js';

export type FakeFailure = 'none' | SendFailureKind;

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
 * how a test makes a provider recover after two bad attempts.
 */
export class FakeMessageSender implements MessageSender {
  readonly sent: FakeMessage[] = [];
  private queued: SendFailureKind[] = [];

  constructor(
    readonly channel: 'whatsapp' | 'sms',
    private failure: FakeFailure = 'none',
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  failNext(kind: SendFailureKind, times = 1): void {
    this.queued.push(...Array<SendFailureKind>(times).fill(kind));
  }

  failAlways(kind: FakeFailure): void {
    this.failure = kind;
  }

  send(message: FakeMessage): Promise<{ messageId: string }> {
    const failure = this.queued.shift() ?? (this.failure === 'none' ? null : this.failure);
    if (failure) return Promise.reject(fakeError(this.channel, failure));

    this.sent.push(message);
    // Never the full number in a log (AGENTS.md): the last three digits are enough to follow it.
    this.log(`fake ${this.channel}: → …${message.to.slice(-3)} "${message.subject}"`);
    return Promise.resolve({ messageId: `fake-${this.channel}-${this.sent.length}` });
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
