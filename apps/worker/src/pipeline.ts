import type { Database } from '@shiftora/db';
import { Worker, type ConnectionOptions, type Queue } from 'bullmq';

import { scanShiftAlerts, type ScanResult } from './alerts/scan.js';
import { createDeliveryWorker } from './delivery-worker.js';
import { handleNotificationJob } from './handlers.js';
import { ensureAuditPartitions } from './maintenance/audit-partitions.js';
import { sendableChannels, type Adapters } from './notifications/dispatch.js';
import { relayOnce, type Enqueue } from './outbox-relay.js';
import {
  ALERT_SCAN_SCHEDULER,
  ALERTS_QUEUE,
  AUDIT_PARTITIONS_SCHEDULER,
  alertsQueue,
  deliveriesQueue,
  NOTIFICATIONS_QUEUE,
  notificationsQueue,
  type DeliveryJobData,
  type NotificationJob,
} from './queues.js';

export interface PipelineOptions {
  db: Database;
  connection: ConnectionOptions;
  adapters: Adapters;
  appUrl: string;
  concurrency: number;
  relayBatch: number;
  /** The alert scan's interval; null leaves the scheduler off (a test runs scans itself). */
  alertScanIntervalMs: number | null;
  /** Retry delay for sends; tests pass a fast one. Defaults to the jittered production backoff. */
  /** Tells the API about long jobs (the auto-scheduler); the API forwards it to sockets. */
  announce?: (event: { orgId: string; scheduleId: string; runId: string; status: string }) => void;
  backoff?: (attemptsMade: number) => number;
  log?: Pick<Console, 'info' | 'error'>;
}

export interface Pipeline {
  /** One relay pass: claims pending outbox rows and queues them. Returns how many. */
  relay(): Promise<number>;
  /** One alert scan, outside the scheduler. */
  scan(now?: Date): Promise<ScanResult>;
  notifications: Queue<NotificationJob>;
  deliveries: Queue<DeliveryJobData>;
  close(): Promise<void>;
}

/**
 * Everything the worker process runs, wired together: the outbox relay, the `notifications`
 * consumer (events → messages), the `deliveries` consumer (messages → providers, with retries,
 * dead letters and fallback), and the alert scan on a Redis-held schedule.
 *
 * main.ts adds configuration, a timer for the relay and signal handling; the end-to-end test
 * starts exactly this, so what it proves is what production runs.
 */
export async function startPipeline(options: PipelineOptions): Promise<Pipeline> {
  const { db, connection, adapters, log = console } = options;
  const notifications = notificationsQueue(connection);
  const deliveries = deliveriesQueue(connection);
  const usable = sendableChannels(adapters);

  const enqueue: Enqueue = async (event) => {
    await notifications.add(
      event.topic,
      { outboxId: event.id, orgId: event.orgId, topic: event.topic, payload: event.payload },
      // The outbox row id as the job id: re-relaying after a crash cannot double-send.
      { jobId: event.id },
    );
  };

  const consumer = new Worker<NotificationJob>(
    NOTIFICATIONS_QUEUE,
    async (job) =>
      handleNotificationJob(
        db,
        {
          deliveries,
          appUrl: options.appUrl,
          mailer: adapters.mailer,
          usable,
          ...(options.announce ? { announce: options.announce } : {}),
        },
        job.data,
      ),
    { connection, concurrency: options.concurrency },
  );
  consumer.on('failed', (job, error) => {
    log.error(`notifications: job ${job?.id ?? '?'} failed`, error.message);
  });

  const sender = createDeliveryWorker({
    db,
    adapters,
    queue: deliveries,
    connection,
    concurrency: options.concurrency,
    ...(options.backoff ? { backoff: options.backoff } : {}),
  });
  sender.on('failed', (job, error) => {
    log.error(`deliveries: job ${job?.id ?? '?'} failed`, error.message);
  });

  // Shift reminders and missed clock-ins: one repeatable scan job, scheduled in Redis so that
  // several worker processes still run it once per interval. Upserting on every boot keeps the
  // interval in step with the configuration.
  const alerts = alertsQueue(connection);

  // The audit log's monthly partitions (W7 D4): checked once on boot, so a fresh deploy never
  // waits a day for next month's table, then daily on the same Redis-held schedule.
  const created = await ensureAuditPartitions(db);
  if (created > 0) log.info(`audit: created ${created} monthly partition(s)`);

  let scanner: Worker | null = null;
  if (options.alertScanIntervalMs !== null) {
    await alerts.upsertJobScheduler(
      ALERT_SCAN_SCHEDULER,
      { every: options.alertScanIntervalMs },
      { name: 'scan' },
    );
    await alerts.upsertJobScheduler(
      AUDIT_PARTITIONS_SCHEDULER,
      { every: 24 * 60 * 60 * 1000 },
      { name: 'audit-partitions' },
    );
    scanner = new Worker(
      ALERTS_QUEUE,
      async (job) => {
        if (job.name === 'audit-partitions') {
          const made = await ensureAuditPartitions(db);
          if (made > 0) log.info(`audit: created ${made} monthly partition(s)`);
          return { created: made };
        }
        const result = await scanShiftAlerts(db);
        if (result.reminders + result.missed + result.expired > 0) {
          log.info(
            `alerts: ${result.reminders} reminder(s), ${result.missed} missed clock-in(s) raised, ${result.expired} request(s) expired`,
          );
        }
        return result;
      },
      { connection, concurrency: 1 },
    );
    scanner.on('failed', (job, error) => {
      log.error(`alerts: ${job?.name ?? 'job'} failed`, error.message);
    });
  }

  return {
    relay: () => relayOnce({ db, enqueue, batch: options.relayBatch }),
    scan: (now) => scanShiftAlerts(db, now),
    notifications,
    deliveries,
    close: async () => {
      await consumer.close();
      await sender.close();
      await scanner?.close();
      await Promise.all([notifications.close(), deliveries.close(), alerts.close()]);
    },
  };
}
