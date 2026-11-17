import type { Database } from '@shiftora/db';
import type { ChannelPolicy } from '@shiftora/domain';
import { deliveryReportedEvent } from '@shiftora/shared';
import type { Queue } from 'bullmq';

import { handleMissedClockIn, handleShiftReminder } from './alerts/handlers.js';
import { calculatePayroll } from './payroll/calculate.js';
import type { Mailer } from './mailer.js';
import { fanOutSchedulePublished, type FanOutResult } from './notifications/fan-out.js';
import { handleInviteCreated } from './notifications/invite.js';
import { applyDeliveryReports } from './notifications/reports.js';
import { handleShiftClaimed } from './notifications/claims.js';
import { handleShiftOffered, handleShiftRequestEvent } from './notifications/shift-requests.js';
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
    // Raised by the minute-by-minute scan (alerts/scan.ts); the messages are written here, like
    // any other event's, so they get the same routing, quota, retries and fallback.
    case 'shift.reminder':
    case 'attendance.missed': {
      const event = { id: job.outboxId, orgId: job.orgId, topic: job.topic, payload: job.payload };
      const alertDeps = { usable: deps.usable, appUrl: deps.appUrl };
      const result =
        job.topic === 'shift.reminder'
          ? await handleShiftReminder(db, event, alertDeps)
          : await handleMissedClockIn(db, event, alertDeps);
      await queueDeliveries(deps.deliveries, job.orgId, result.deliveryIds);
      if (result.notifications > 0) {
        console.info(`notifications: ${job.topic} → ${result.deliveries} delivery(ies) queued`);
      }
      return result;
    }
    // Swaps and drops (W5 D2): the colleague, the managers, or the people the decision affects.
    case 'shift_request.created':
    case 'shift_request.accepted':
    case 'shift_request.declined':
    case 'shift_request.approved':
    case 'shift_request.rejected':
    case 'shift_request.cancelled': {
      const result = await handleShiftRequestEvent(
        db,
        { id: job.outboxId, orgId: job.orgId, topic: job.topic, payload: job.payload },
        { usable: deps.usable, appUrl: deps.appUrl },
      );
      await queueDeliveries(deps.deliveries, job.orgId, result.deliveryIds);
      if (result.notifications > 0) {
        console.info(`notifications: ${job.topic} → ${result.deliveries} delivery(ies) queued`);
      }
      return result;
    }
    // Someone took an open shift (W5 D4): the managers hear about it; the claimer already knows.
    case 'shift.claimed': {
      const result = await handleShiftClaimed(
        db,
        { id: job.outboxId, orgId: job.orgId, topic: job.topic, payload: job.payload },
        { appUrl: deps.appUrl },
      );
      await queueDeliveries(deps.deliveries, job.orgId, result.deliveryIds);
      if (result.notifications > 0) {
        console.info(`notifications: shift.claimed → ${result.deliveries} delivery(ies) queued`);
      }
      return result;
    }
    // An open shift offered to the staff who could take it (W5 D3).
    case 'shift.offered': {
      const result = await handleShiftOffered(
        db,
        { id: job.outboxId, orgId: job.orgId, topic: job.topic, payload: job.payload },
        { usable: deps.usable, appUrl: deps.appUrl },
      );
      await queueDeliveries(deps.deliveries, job.orgId, result.deliveryIds);
      if (result.notifications > 0) {
        console.info(`notifications: shift.offered → ${result.deliveries} delivery(ies) queued`);
      }
      return result;
    }
    // An owner approved a pay period (W6 D4): compute and store its lines.
    case 'pay_period.approved': {
      const result = await calculatePayroll(db, {
        id: job.outboxId,
        orgId: job.orgId,
        topic: job.topic,
        payload: job.payload,
      });
      if (result.calculated) {
        console.info(
          `payroll: ${result.employees} employee(s), ${result.lines} line(s) calculated`,
        );
      }
      return { notifications: 0, deliveries: 0, deliveryIds: [] };
    }
    // A provider's delivery reports, verified by the API's webhook and written as a platform
    // event (no org: the report only names the provider's message id). A late failure falls
    // back down the ladder, and that fallback is queued here.
    case 'delivery.reported': {
      const parsed = deliveryReportedEvent.safeParse(job.payload);
      if (!parsed.success) {
        console.warn(`notifications: malformed delivery.reported (job ${job.outboxId})`);
        return { notifications: 0, deliveries: 0, deliveryIds: [] };
      }
      const outcome = await applyDeliveryReports(db, parsed.data, deps.usable);
      for (const fallback of outcome.fallbacks) {
        await queueDeliveries(deps.deliveries, fallback.orgId, [fallback.deliveryId]);
      }
      console.info(
        `notifications: ${parsed.data.channel} reports → ${outcome.applied} applied, ${outcome.ignored} ignored, ${outcome.unknown} unknown`,
      );
      // A report can beat the worker's own write of the provider's message id (a fast provider,
      // a slow database). Throwing asks BullMQ to run the batch again on its backoff (~75 s over
      // five attempts); the reports already applied are no-ops the second time. An id that is
      // still unknown after that was never ours, and the job ends in the failed set.
      if (outcome.unknown > 0) {
        throw new Error(`${outcome.unknown} report(s) for messages not recorded yet; retrying`);
      }
      return {
        notifications: 0,
        deliveries: outcome.fallbacks.length,
        deliveryIds: outcome.fallbacks.map((fallback) => fallback.deliveryId),
      };
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
    // An owner replayed a dead letter (POST /deliveries/:id/replay). The API reset the row and
    // wrote this event in the same transaction; queueing is the worker's job. The replay number
    // is part of the job id, so each replay is a new job and a re-relayed event is not.
    case 'delivery.replay': {
      const payload = (job.payload ?? {}) as { deliveryId?: string; replays?: number };
      if (!payload.deliveryId) return { notifications: 0, deliveries: 0, deliveryIds: [] };
      await deps.deliveries.add(
        'delivery',
        { deliveryId: payload.deliveryId, orgId: job.orgId },
        { jobId: `${payload.deliveryId}-replay-${payload.replays ?? 0}` },
      );
      console.info(`notifications: replaying delivery ${payload.deliveryId}`);
      return { notifications: 0, deliveries: 1, deliveryIds: [] };
    }
    default:
      console.warn(`notifications: no handler for topic '${job.topic}' (job ${job.outboxId})`);
      return { notifications: 0, deliveries: 0, deliveryIds: [] };
  }
}

/** One send job per delivery; the delivery id is the job id, so a replayed event adds nothing. */
async function queueDeliveries(
  queue: Queue<DeliveryJobData>,
  orgId: string,
  deliveryIds: string[],
): Promise<void> {
  for (const deliveryId of deliveryIds) {
    await queue.add('delivery', { deliveryId, orgId }, { jobId: deliveryId });
  }
}
