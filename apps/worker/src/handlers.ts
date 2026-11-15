import type { Database } from '@shiftora/db';
import type { ChannelPolicy } from '@shiftora/domain';
import type { Queue } from 'bullmq';

import type { Mailer } from './mailer.js';
import { fanOutSchedulePublished, type FanOutResult } from './notifications/fan-out.js';
import { handleInviteCreated } from './notifications/invite.js';
import { sendAccountMail } from './platform-mail.js';
import type { DeliveryJobData, NotificationJob } from './queues.js';

/**
 * What to do with one queued event.
 *
 * Two steps, deliberately separate: fan out (who gets what, written in one transaction), then
 * queue one send per delivery. Sending inside the fan-out transaction would hold a database
 * connection open across an SMTP call, and would still fail after the commit — so the rows are
 * committed first and each send is its own job with its own retries.
 *
 * Topics are the outbox's vocabulary, and an unknown one is a **loud** no: the job is
 * acknowledged (so it does not retry forever on something that will never be understood) but the
 * warning names it, because a typo in an outbox insert is a bug to see in the logs, not something
 * to discover by asking staff who never got a message.
 */
export interface NotificationHandlerDeps {
  deliveries: Queue<DeliveryJobData>;
  appUrl: string;
  mailer: Mailer;
  /** Channels this worker can actually send on, so routing never offers one it cannot deliver. */
  usable: ChannelPolicy;
}

export async function handleNotificationJob(
  db: Database,
  deps: NotificationHandlerDeps,
  job: NotificationJob,
): Promise<FanOutResult> {
  switch (job.topic) {
    case 'schedule.published': {
      const result = await fanOutSchedulePublished(
        db,
        {
          id: job.outboxId,
          orgId: job.orgId,
          topic: job.topic,
          payload: job.payload,
        },
        deps.usable,
      );

      // Idempotent by job id: a replayed event re-queues the same ids, which BullMQ drops.
      for (const deliveryId of result.deliveryIds) {
        await deps.deliveries.add(
          'delivery',
          { deliveryId, orgId: job.orgId },
          { jobId: deliveryId },
        );
      }

      if (result.notifications > 0) {
        console.info(
          `notifications: ${job.topic} → ${result.notifications} message(s), ${result.deliveries} delivery(ies) queued`,
        );
      }
      return result;
    }
    case 'invite.created': {
      const result = await handleInviteCreated(
        db,
        {
          id: job.outboxId,
          orgId: job.orgId,
          topic: job.topic,
          payload: job.payload,
        },
        deps.appUrl,
      );

      for (const deliveryId of result.deliveryIds) {
        await deps.deliveries.add(
          'delivery',
          { deliveryId, orgId: job.orgId },
          { jobId: deliveryId },
        );
      }
      if (result.notifications > 0) {
        console.info(`notifications: invite.created → emailed ${result.deliveries} invite(s)`);
      }
      return result;
    }
    // Platform mail: no tenant, so no notification rows — the handler sends it directly.
    case 'auth.verify_email':
    case 'auth.reset_password': {
      const result = await sendAccountMail(deps.mailer, deps.appUrl, job);
      return {
        notifications: 0,
        deliveries: result.sent ? 1 : 0,
        deliveryIds: [],
      };
    }
    default:
      console.warn(`notifications: no handler for topic '${job.topic}' (job ${job.outboxId})`);
      return { notifications: 0, deliveries: 0, deliveryIds: [] };
  }
}
