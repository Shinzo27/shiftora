import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

import { AppConfig } from '../../config/app-config.js';
import type { AutofillProgressEvent } from './realtime.events.js';
import { RealtimeService } from './realtime.service.js';

/** The channel the worker publishes job progress on. Must match `apps/worker/src/queues.ts`. */
const JOB_EVENTS_CHANNEL = 'shiftora:job-events';

/**
 * Carries the worker's progress into the API's sockets.
 *
 * The auto-scheduler runs in another process, so it cannot emit to a socket directly. Redis
 * pub/sub is the smallest bridge that works: the worker publishes a fact, this subscribes and
 * re-emits it to the organisation's room.
 *
 * Connecting must never delay or fail startup. A Redis that is down leaves the app perfectly
 * usable — requests still work, the page polls the run row — so the connection is opened in the
 * background with a short timeout and bounded retries, and every failure is a log line.
 */
@Injectable()
export class JobEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobEventsService.name);
  private subscriber: RedisClientType | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    if (!this.config.redisUrl) return; // no Redis: the page polls instead

    const client: RedisClientType = createClient({
      url: this.config.redisUrl,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (retries) => (retries > 3 ? false : 250),
      },
    });
    client.on('error', (error: Error) => this.logger.debug(`job events: ${error.message}`));
    this.subscriber = client;

    // Deliberately not awaited: the API boots whether or not Redis is there.
    void client
      .connect()
      .then(() => client.subscribe(JOB_EVENTS_CHANNEL, (message) => this.forward(message)))
      .catch((error: Error) => {
        this.logger.warn(`job events: not subscribed (${error.message})`);
      });
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  private forward(message: string): void {
    try {
      const event = JSON.parse(message) as AutofillProgressEvent;
      if (!event.orgId || !event.scheduleId) return;
      this.realtime.autofillProgress(event);
    } catch {
      this.logger.debug('job events: ignored an unreadable message');
    }
  }
}
