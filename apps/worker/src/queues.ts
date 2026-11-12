import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

/** The queue the relay fills and the notification worker drains. */
export const NOTIFICATIONS_QUEUE = 'notifications';

export interface NotificationJob {
  /** The outbox row this job came from — also the job id, which is what makes it idempotent. */
  outboxId: string;
  orgId: string;
  topic: string;
  payload: unknown;
}

/**
 * One Redis connection per process, in the shape BullMQ wants.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ workers (a blocking command must be able
 * to wait), and `enableReadyCheck: false` keeps reconnect noise out of the logs when Redis is
 * restarted under a running worker.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export function connectionOptions(redis: Redis): ConnectionOptions {
  return redis;
}

export function notificationsQueue(connection: ConnectionOptions): Queue<NotificationJob> {
  return new Queue<NotificationJob>(NOTIFICATIONS_QUEUE, {
    connection,
    defaultJobOptions: jobOptions(),
  });
}

/**
 * Retries are the point of a queue: a WhatsApp provider having a bad minute should not lose
 * "you are working tomorrow". Exponential backoff keeps an outage from becoming a thundering
 * herd, and the failed set is the dead-letter list an operator can read.
 */
export function jobOptions(): JobsOptions {
  return {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
    // Keep failures: they are the DLQ until D4 adds a real one with a reason.
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  };
}
