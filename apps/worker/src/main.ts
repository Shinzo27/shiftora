import { createDatabaseConnection } from '@shiftora/db';
import type { Queue } from 'bullmq';

import { parseWorkerEnv } from './env.js';
import { relayOnce, type Enqueue } from './outbox-relay.js';
import { connectionOptions, createRedis, notificationsQueue } from './queues.js';

/**
 * The worker process.
 *
 * Week 4 D1 is the **relay**: it reads the outbox and puts each pending event on the
 * `notifications` queue. Delivery itself (who gets a message, on which channel, with what
 * retry) is D2 onwards — the consumer lands with the notification module, so nothing here
 * quietly acknowledges an event it does not understand.
 *
 * One tick at a time: a slow tick must not overlap the next one and claim the same rows twice
 * (the database would stop that, but the process would waste a connection doing it).
 */
async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const connection = createDatabaseConnection(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const queue: Queue = notificationsQueue(connectionOptions(redis));

  const enqueue: Enqueue = async (event) => {
    await queue.add(
      event.topic,
      {
        outboxId: event.id,
        orgId: event.orgId,
        topic: event.topic,
        payload: event.payload,
      },
      {
        // The outbox row id as the job id: re-relaying after a crash cannot double-send.
        jobId: event.id,
      },
    );
  };

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
    `worker: relaying every ${env.RELAY_INTERVAL_MS} ms, up to ${env.RELAY_BATCH} event(s) per tick`,
  );
  await tick();

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    console.info(`worker: ${signal}, closing`);
    await queue.close();
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
