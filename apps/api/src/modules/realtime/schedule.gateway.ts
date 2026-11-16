import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import { setTenantContext, type DatabaseConnection } from '@shiftora/db';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server, Socket } from 'socket.io';

import { AppConfig } from '../../config/app-config.js';
import { RequestContext } from '../../database/request-context.js';
import { DATABASE } from '../../database/database.module.js';
import { TokenService } from '../auth/token.service.js';
import { OrgsRepository } from '../orgs/orgs.repository.js';
import { orgRoom } from './realtime.events.js';
import { RealtimeService } from './realtime.service.js';

/** The part of a node-redis client this gateway uses (pub and its duplicate type differently). */
interface RedisConnection {
  readonly isReady: boolean;
  readonly isOpen: boolean;
  close(): Promise<void>;
  destroy(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'ready', listener: () => void): unknown;
}

/** What a joined socket carries about who it is (used by future per-user events). */
interface SocketData {
  userId: string;
}

/**
 * The board's live channel.
 *
 * A socket may only join rooms for organisations the token's user really belongs to, so the
 * handshake verifies the access token and reads the memberships **with the RLS context set for
 * that user** — the same rules as an HTTP request, no bypass role. A socket that cannot prove
 * membership is disconnected rather than left connected and silent.
 *
 * CORS origin comes from `WEB_ORIGIN`. Decorators are evaluated before dependency injection
 * exists, so this one setting is read from the environment; everywhere else uses AppConfig.
 */
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true },
})
@Injectable()
export class ScheduleGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduleGateway.name);
  private redisClients: RedisConnection[] = [];

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly config: AppConfig,
    private readonly tokens: TokenService,
    private readonly realtime: RealtimeService,
    private readonly context: RequestContext,
    private readonly orgs: OrgsRepository,
    @Inject(DATABASE) private readonly database: DatabaseConnection,
  ) {}

  async afterInit(server: Server): Promise<void> {
    this.realtime.attach(server);
    await this.useRedisAdapter(server);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token: unknown = socket.handshake.auth?.token;
      const userId = typeof token === 'string' ? await this.tokens.verifyAccessToken(token) : null;
      if (!userId) {
        socket.disconnect(true);
        return;
      }

      for (const orgId of await this.orgIdsFor(userId)) await socket.join(orgRoom(orgId));
      (socket.data as SocketData).userId = userId;
    } catch (error) {
      this.logger.warn(`Rejected a socket: ${(error as Error).message}`);
      socket.disconnect(true);
    }
  }

  /** The user's organisations, read through RLS with the user's own context. */
  private async orgIdsFor(userId: string): Promise<string[]> {
    return this.database.db.transaction(async (tx) => {
      await setTenantContext(tx, { userId });
      return this.context.run({ tx, userId, orgId: null, role: null }, async () => {
        const orgs = await this.orgs.listForUser(userId);
        return orgs.map((org) => org.id);
      });
    });
  }

  /**
   * One API instance needs nothing; several need the Redis adapter so a change made through one
   * process reaches sockets held by another. Without Redis the app still runs — the warning
   * says realtime is single-process, which is the honest description of a single API container.
   */
  private async useRedisAdapter(server: Server): Promise<void> {
    const url = this.config.redisUrl;
    if (!url) {
      this.logger.warn('REDIS_URL is not set: realtime events stay within this process');
      return;
    }
    const pub = createClient({ url });
    const sub = pub.duplicate();
    this.redisClients = [pub, sub];
    // A client with no 'error' listener turns a Redis restart into an uncaught exception that
    // takes the whole API down; logged instead, and node-redis reconnects on its own.
    let warned = false;
    for (const client of this.redisClients) {
      client.on('error', (error: Error) => {
        if (warned) return;
        warned = true;
        this.logger.warn(`Redis (realtime) error: ${error.message}; reconnecting`);
      });
      client.on('ready', () => (warned = false));
    }
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      server.adapter(createAdapter(pub, sub));
      this.logger.log('Socket.IO is using the Redis adapter');
    } catch (error) {
      for (const client of this.redisClients) if (client.isOpen) client.destroy();
      this.redisClients = [];
      this.logger.warn(
        `Redis adapter unavailable (${(error as Error).message}); realtime stays in this process`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.redisClients.map(async (client) => {
        if (client.isReady) await client.close().catch(() => undefined);
        else if (client.isOpen) client.destroy();
      }),
    );
  }
}
