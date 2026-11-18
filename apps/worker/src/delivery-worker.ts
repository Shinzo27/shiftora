import type { Database } from '@shiftora/db';
import { retryDelayMs } from '@shiftora/domain';
import { Worker, type ConnectionOptions, type Job, type Queue } from 'bullmq';
import type { Logger } from 'pino';

import { createLogger, inJob, log } from './logging.js';
import { dispatchDelivery, type Adapters, type DispatchResult } from './notifications/dispatch.js';
import { DELIVERIES_QUEUE, type DeliveryJobData } from './queues.js';

export interface DeliveryWorkerDeps {
  db: Database;
  adapters: Adapters;
  /** Where fallbacks are queued: the same queue this worker drains. */
  queue: Queue<DeliveryJobData>;
  connection: ConnectionOptions;
  concurrency: number;
  /** Retry delay; injected so a test can make retries fast. Defaults to jittered exponential. */
  backoff?: (attemptsMade: number) => number;
  /** Where the sends are logged, each under its job's trace. */
  logger?: Logger;
}

/**
 * The consumer of the `deliveries` queue: one job per delivery row, retried with jittered
 * exponential backoff.
 *
 * Three translations between `dispatchDelivery`'s answer and BullMQ:
 * - the last attempt is told so (`finalAttempt`), which turns a transient failure into a dead
 *   letter plus a fallback instead of a retry that will never run;
 * - a fallback delivery is queued here, with its own id as the job id (idempotent);
 * - "the provider asked us to slow down" pauses the whole queue for that long and re-runs the
 *   job without spending one of its attempts (`Worker.RateLimitError`), because a 429 says
 *   nothing about this message.
 */
export function createDeliveryWorker(deps: DeliveryWorkerDeps): Worker<DeliveryJobData> {
  const root = deps.logger ?? createLogger();
  const worker: Worker<DeliveryJobData> = new Worker<DeliveryJobData>(
    DELIVERIES_QUEUE,
    async (job: Job<DeliveryJobData>): Promise<DispatchResult> =>
      inJob(
        root,
        {
          traceId: job.data.traceId,
          orgId: job.data.orgId,
          queue: DELIVERIES_QUEUE,
          jobId: job.id,
        },
        () => send(job),
      ),
    {
      connection: deps.connection,
      concurrency: deps.concurrency,
      settings: { backoffStrategy: deps.backoff ?? ((attemptsMade) => retryDelayMs(attemptsMade)) },
    },
  );

  async function send(job: Job<DeliveryJobData>): Promise<DispatchResult> {
    const attempts = job.opts.attempts ?? 1;
    const result = await dispatchDelivery(deps.db, deps.adapters, {
      ...job.data,
      finalAttempt: job.attemptsMade + 1 >= attempts,
    });

    if ('fallbackDeliveryId' in result && result.fallbackDeliveryId) {
      const fallbackId = result.fallbackDeliveryId;
      await deps.queue.add(
        'delivery',
        {
          deliveryId: fallbackId,
          orgId: job.data.orgId,
          ...(job.data.traceId ? { traceId: job.data.traceId } : {}),
        },
        { jobId: fallbackId },
      );
    }

    // The provider step of the trace: which delivery, what happened — never the address.
    log().info(
      {
        deliveryId: job.data.deliveryId,
        attempt: job.attemptsMade + 1,
        status: result.status,
        ...('reason' in result ? { reason: result.reason } : {}),
      },
      `delivery: ${result.status}`,
    );

    if (result.status === 'retry') {
      if (result.retryAfterMs !== undefined) {
        await worker.rateLimit(result.retryAfterMs);
        throw Worker.RateLimitError();
      }
      // Throwing is the retry signal: BullMQ backs off; the delivery row keeps the reason.
      throw new Error(result.reason);
    }
    return result;
  }
  return worker;
}
