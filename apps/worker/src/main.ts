import { createDatabaseConnection } from '@shiftora/db';
import { Worker, type Queue } from 'bullmq';

import { parseWorkerEnv } from './env.js';
import { handleNotificationJob } from './handlers.js';
import { createMailer } from './mailer.js';
import { dispatchDelivery, sendableChannels, type Adapters } from './notifications/dispatch.js';
import { createWebPushSender } from './notifications/push.js';
import { relayOnce, type Enqueue } from './outbox-relay.js';
import {
  connectionOptions,
  createRedis,
  DELIVERIES_QUEUE,
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

  // A sender is what makes a channel real. WhatsApp and SMS have none until their providers land
  // (W4 D4), so `sendableChannels` reports them as unusable and routing quietly moves a person who
  // chose WhatsApp down the ladder to email. Queueing a message nobody can send is not honesty,
  // it is silence with extra steps.
  const adapters: Adapters = { mailer, push, whatsapp: null, sms: null };
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

  const sender = new Worker<DeliveryJobData>(
    DELIVERIES_QUEUE,
    async (job) => {
      const result = await dispatchDelivery(connection.db, adapters, job.data);
      // Throwing is the retry signal: BullMQ backs off, and the delivery row keeps the reason.
      if (result.status === 'retry') throw new Error(result.reason);
      return result;
    },
    { connection: options, concurrency: env.WORKER_CONCURRENCY },
  );

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
