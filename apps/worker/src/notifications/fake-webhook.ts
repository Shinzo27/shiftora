import { createHmac } from 'node:crypto';

import type { FakeReport } from './fake-sender.js';

/**
 * The fake provider's delivery reports, sent the way Meta sends them: a signed POST of a
 * WhatsApp Business webhook to the API. With it, the whole round trip — send, report, verify the
 * signature, update the delivery, fall back on a late failure — runs locally with no Meta account.
 *
 * Reports go out after a short delay, like a real phone's, and a report the API refuses is only
 * logged: a lost report leaves a delivery at "sent", which is the truth as far as we know.
 */
export interface FakeWebhookOptions {
  /** The API's webhook URL, e.g. http://localhost:4000/api/v1/webhooks/whatsapp. */
  url: string;
  /** The app secret the API verifies `X-Hub-Signature-256` with. */
  secret: string;
  log?: (line: string) => void;
  /** Milliseconds between "accepted" and the first report; a "read" comes one delay later. */
  delayMs?: number;
}

export function createFakeWebhookReporter(
  options: FakeWebhookOptions,
): (report: FakeReport) => void {
  const { url, secret, log = () => undefined, delayMs = 1_500 } = options;

  return (report) => {
    const wait = delayMs * (report.status === 'read' ? 2 : 1);
    setTimeout(() => {
      const body = JSON.stringify(metaStatusWebhook(report));
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signMetaPayload(body, secret),
        },
        body,
      })
        .then((res) => {
          if (!res.ok) log(`fake webhook: ${report.status} refused (${res.status})`);
        })
        .catch((error: unknown) => {
          log(`fake webhook: ${report.status} not delivered (${(error as Error).message})`);
        });
    }, wait).unref();
  };
}

/** `sha256=<hex HMAC of the raw body>`, the header Meta signs every webhook with. */
export function signMetaPayload(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** A WhatsApp Business Account webhook carrying one status, in Meta's shape. */
export function metaStatusWebhook(report: FakeReport): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'fake-waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '0000000000', phone_number_id: 'fake-phone' },
              statuses: [
                {
                  id: report.messageId,
                  status: report.status,
                  timestamp: String(Math.floor(report.at.getTime() / 1000)),
                  // Meta sends the recipient's number here; the fake never has to.
                  recipient_id: 'fake-recipient',
                  ...(report.error ? { errors: [{ code: 131026, title: report.error }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
