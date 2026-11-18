import { renderResetPassword, renderVerifyEmail } from '@shiftora/domain';

import type { Mailer } from './mailer.js';
import { log } from './logging.js';
import type { NotificationJob } from './queues.js';

interface AccountPayload {
  email?: string;
  name?: string;
  token?: string;
  expiresInHours?: number;
}

/**
 * Account mail — "confirm your address", "choose a new password".
 *
 * It does **not** go through `notifications`/`deliveries`, unlike staff and invite mail: those
 * tables are tenant tables, and a person who cannot log in yet belongs to no tenant. The record
 * that matters here is the token row (it is consumed once, and expiry is enforced there), so the
 * worker renders and sends, and logs the provider's message id.
 */
export async function sendAccountMail(
  mailer: Mailer,
  appUrl: string,
  job: NotificationJob,
): Promise<{ sent: boolean; reason?: string }> {
  const payload = (job.payload ?? {}) as AccountPayload;
  const { email, name, token } = payload;
  if (!email || !name || !token) return { sent: false, reason: 'Incomplete payload' };

  const expiresInHours = payload.expiresInHours ?? (job.topic === 'auth.verify_email' ? 24 : 1);
  const message =
    job.topic === 'auth.verify_email'
      ? renderVerifyEmail({ name, token, appUrl, expiresInHours })
      : renderResetPassword({ name, token, appUrl, expiresInHours });

  try {
    const { messageId } = await mailer.send({
      to: email,
      subject: message.subject,
      body: message.body,
    });
    log().info({ topic: job.topic, messageId }, 'notifications: account email sent');
    return { sent: true };
  } catch (error) {
    // Throwing is what asks the queue for a retry; the message is still in the outbox row.
    throw new Error(`Could not send ${job.topic}`, { cause: error });
  }
}
