import { createDatabaseConnection } from '@shiftora/db';

import { parseWorkerEnv } from './env.js';
import { createLogger, log } from './logging.js';
import { createMailer } from './mailer.js';
import { sendableChannels, type Adapters, type MessageSender } from './notifications/dispatch.js';
import { FakeMessageSender } from './notifications/fake-sender.js';
import { createFakeWebhookReporter } from './notifications/fake-webhook.js';
import { createWebPushSender } from './notifications/push.js';
import { startPipeline } from './pipeline.js';
import { JOB_EVENTS_CHANNEL } from './queues.js';
import { connectionOptions, createRedis } from './queues.js';

/**
 * The worker process: a relay that moves outbox rows onto a queue, and a consumer that turns
 * each event into messages.
 *
 * One tick at a time, and one job per record: the relay is cheap (an indexed query every couple
 * of seconds), the consumer is where the work is.
 */
const logger = createLogger();

async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const connection = createDatabaseConnection(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const options = connectionOptions(redis);
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
  if (!push) logger.warn('worker: Web Push is not configured (no VAPID keys) — push is skipped');

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
          log: (line) => log().warn(line),
        })
      : null;
  const fake = (channel: 'whatsapp' | 'sms'): MessageSender =>
    new FakeMessageSender(
      channel,
      env.FAKE_PROVIDER_FAILURE,
      // Inside a delivery job, so the fake provider's lines carry that job's trace.
      (line) => log().info(line),
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
    logger.warn(
      `worker: no ${missing.join(' or ')} sender configured — staff who chose it are reached by email`,
    );
  }

  // Job events cross the process boundary on Redis: the API subscribes and forwards them to the
  // manager's socket. A publish that fails is a lost progress bar, never a lost run.
  const announce = (event: {
    orgId: string;
    scheduleId: string;
    runId: string;
    status: string;
  }) => {
    void redis.publish(JOB_EVENTS_CHANNEL, JSON.stringify(event)).catch(() => undefined);
  };

  const pipeline = await startPipeline({
    db: connection.db,
    connection: options,
    adapters,
    announce,
    appUrl: env.APP_URL,
    concurrency: env.WORKER_CONCURRENCY,
    relayBatch: env.RELAY_BATCH,
    alertScanIntervalMs: env.ALERT_SCAN_INTERVAL_MS,
    logger,
  });

  let ticking = false;
  let stopping = false;

  const tick = async (): Promise<void> => {
    if (ticking || stopping) return;
    ticking = true;
    try {
      const claimed = await pipeline.relay();
      if (claimed > 0) logger.debug({ claimed }, 'relay: tick');
    } catch (error) {
      // A failed tick is not fatal: the rows are still pending, and the next tick retries.
      logger.error({ err: error }, 'relay: tick failed');
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => void tick(), env.RELAY_INTERVAL_MS);
  logger.info(
    `worker: relaying every ${env.RELAY_INTERVAL_MS} ms (batch ${env.RELAY_BATCH}), consuming with concurrency ${env.WORKER_CONCURRENCY}`,
  );
  await tick();

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    logger.info(`worker: ${signal}, closing`);
    await pipeline.close();
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
  logger.error({ err: error }, 'worker: failed to start');
  process.exit(1);
});
