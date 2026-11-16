import { createDatabaseConnection } from '@shiftora/db';
import { Worker, type Queue } from 'bullmq';

import { scanShiftAlerts } from './alerts/scan.js';
import { parseWorkerEnv } from './env.js';
import { handleNotificationJob } from './handlers.js';
import { createMailer } from './mailer.js';
import { createDeliveryWorker } from './delivery-worker.js';
import { sendableChannels, type Adapters, type MessageSender } from './notifications/dispatch.js';
import { FakeMessageSender } from './notifications/fake-sender.js';
import { createFakeWebhookReporter } from './notifications/fake-webhook.js';
import { createWebPushSender } from './notifications/push.js';
import { relayOnce, type Enqueue } from './outbox-relay.js';
import {
  ALERT_SCAN_SCHEDULER,
  ALERTS_QUEUE,
  alertsQueue,
  connectionOptions,
  createRedis,
  deliveriesQueue,
  NOTIFICATIONS_QUEUE,
  notificationsQueue,
  type DeliveryJobData,
  type NotificationJob,
} from './queues.js';

/**
 * The worker process: a relay that moves outbox rows onto a queue, and a consumer that turns
 * each event into messages.
 *
 * One tick at a time, and one job per record: the relay is cheap (an indexed query every couple
 * of seconds), the consumer is where the work is.
 */
async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const connection = createDatabaseConnection(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const options = connectionOptions(redis);
  const queue: Queue<NotificationJob> = notificationsQueue(options);
  const deliveryQueue: Queue<DeliveryJobData> = deliveriesQueue(options);
  const mailer = createMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    from: env.MAIL_FROM,
    ...(env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : {}),
  });

  // No keys, no push channel: the daily job of a small clinic still runs on email and WhatsApp.
  const push =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? await createWebPushSender({
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        })
      : null;
  if (!push) console.warn('worker: Web Push is not configured (no VAPID keys) — push is skipped');

  // A sender is what makes a channel real. With `none`, `sendableChannels` reports the channel as
  // unusable and routing quietly moves a person who chose WhatsApp down the ladder to email.
  // `fake` logs instead of sending, so quota, retries and dead letters run end to end locally;
  // the Meta adapter is the next value of WHATSAPP_PROVIDER.
  // With a report URL and the app secret, the fake WhatsApp provider also posts signed delivery
  // reports to the API's webhook, as Meta does, so "delivered", "read" and a late failure all
  // run end to end. SMS reports come with a real SMS provider.
  const reporter =
    env.FAKE_PROVIDER_REPORT_URL && env.WHATSAPP_APP_SECRET
      ? createFakeWebhookReporter({
          url: env.FAKE_PROVIDER_REPORT_URL,
          secret: env.WHATSAPP_APP_SECRET,
          log: (line) => console.warn(line),
        })
      : null;
  const fake = (channel: 'whatsapp' | 'sms'): MessageSender =>
    new FakeMessageSender(
      channel,
      env.FAKE_PROVIDER_FAILURE,
      (line) => console.info(line),
      channel === 'whatsapp' ? reporter : null,
    );
  const adapters: Adapters = {
    mailer,
    push,
    whatsapp: env.WHATSAPP_PROVIDER === 'fake' ? fake('whatsapp') : null,
    sms: env.SMS_PROVIDER === 'fake' ? fake('sms') : null,
  };
  const usable = sendableChannels(adapters);
  const missing = (['whatsapp', 'sms'] as const).filter((channel) => !usable[channel]);
  if (missing.length > 0) {
    console.warn(
      `worker: no ${missing.join(' or ')} sender configured — staff who chose it are reached by email`,
    );
  }

  const enqueue: Enqueue = async (event) => {
    await queue.add(
      event.topic,
      {
        outboxId: event.id,
        orgId: event.orgId,
        topic: event.topic,
        payload: event.payload,
      },
      // The outbox row id as the job id: re-relaying after a crash cannot double-send.
      { jobId: event.id },
    );
  };

  const worker = new Worker<NotificationJob>(
    NOTIFICATIONS_QUEUE,
    async (job) =>
      handleNotificationJob(
        connection.db,
        { deliveries: deliveryQueue, appUrl: env.APP_URL, mailer, usable },
        job.data,
      ),
    { connection: options, concurrency: env.WORKER_CONCURRENCY },
  );

  const sender = createDeliveryWorker({
    db: connection.db,
    adapters,
    queue: deliveryQueue,
    connection: options,
    concurrency: env.WORKER_CONCURRENCY,
  });

  // Shift reminders and missed clock-ins: one repeatable scan job, scheduled in Redis so that
  // several worker processes still run it once per interval. Upserting on every boot keeps the
  // interval in step with ALERT_SCAN_INTERVAL_MS.
  const alerts = alertsQueue(options);
  await alerts.upsertJobScheduler(
    ALERT_SCAN_SCHEDULER,
    { every: env.ALERT_SCAN_INTERVAL_MS },
    { name: 'scan' },
  );
  const scanner = new Worker(
    ALERTS_QUEUE,
    async () => {
      const result = await scanShiftAlerts(connection.db);
      if (result.reminders + result.missed > 0) {
        console.info(
          `alerts: ${result.reminders} reminder(s), ${result.missed} missed clock-in(s) raised`,
        );
      }
      return result;
    },
    { connection: options, concurrency: 1 },
  );
  scanner.on('failed', (_job, error) => {
    console.error('alerts: scan failed', error.message);
  });

  sender.on('failed', (job, error) => {
    console.error(`deliveries: job ${job?.id ?? '?'} failed`, error.message);
  });

  worker.on('failed', (job, error) => {
    console.error(`notifications: job ${job?.id ?? '?'} failed`, error.message);
  });

  let ticking = false;
  let stopping = false;

  const tick = async (): Promise<void> => {
    if (ticking || stopping) return;
    ticking = true;
    try {
      const claimed = await relayOnce({ db: connection.db, enqueue, batch: env.RELAY_BATCH });
      if (claimed > 0) console.info(`relay: queued ${claimed} event(s)`);
    } catch (error) {
      // A failed tick is not fatal: the rows are still pending, and the next tick retries.
      console.error('relay: tick failed', error);
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => void tick(), env.RELAY_INTERVAL_MS);
  console.info(
    `worker: relaying every ${env.RELAY_INTERVAL_MS} ms (batch ${env.RELAY_BATCH}), consuming with concurrency ${env.WORKER_CONCURRENCY}`,
  );
  await tick();

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    console.info(`worker: ${signal}, closing`);
    await worker.close();
    await sender.close();
    await scanner.close();
    await alerts.close();
    await queue.close();
    await deliveryQueue.close();
    mailer.close();
    await redis.quit();
    await connection.close();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((error: unknown) => {
  console.error('worker: failed to start', error);
  process.exit(1);
});
