import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

/** The queue the relay fills and the notification worker drains. */
export const NOTIFICATIONS_QUEUE = 'notifications';
export const DELIVERIES_QUEUE = 'deliveries';
/** Redis pub/sub channel for job progress: the worker publishes, the API forwards to sockets. */
export const JOB_EVENTS_CHANNEL = 'shiftora:job-events';

/** One repeatable job: the shift-reminder / missed clock-in scan. */
export const ALERTS_QUEUE = 'alerts';
export const ALERT_SCAN_SCHEDULER = 'shift-alerts';
/** Daily housekeeping on the same queue: the audit log's monthly partitions. */
export const AUDIT_PARTITIONS_SCHEDULER = 'audit-partitions';

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

export interface DeliveryJobData {
  deliveryId: string;
  orgId: string;
}

export function deliveriesQueue(connection: ConnectionOptions): Queue<DeliveryJobData> {
  return new Queue<DeliveryJobData>(DELIVERIES_QUEUE, {
    connection,
    defaultJobOptions: deliveryJobOptions(),
  });
}

/**
 * The alert scan's queue. A BullMQ job scheduler adds one `scan` job per interval, and only one,
 * however many worker processes are running: the schedule lives in Redis, not in a timer.
 */
export function alertsQueue(connection: ConnectionOptions): Queue {
  return new Queue(ALERTS_QUEUE, {
    connection,
    defaultJobOptions: {
      // A failed scan is not retried: the next one a minute later covers the same window.
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { age: 24 * 60 * 60 },
    },
  });
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
    // Kept for inspection; the dead-letter list itself is `deliveries.dead_lettered_at`.
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  };
}

/**
 * Sends: the same five attempts, but on the delivery worker's own backoff (exponential with
 * jitter, `retryDelayMs`), so a provider outage is not answered by every message at once.
 * After the last attempt the delivery is dead-lettered in the database, where the owner sees it
 * and can replay it — the job itself completes.
 */
export function deliveryJobOptions(): JobsOptions {
  return { ...jobOptions(), backoff: { type: 'custom' } };
}
