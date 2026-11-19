import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { createClient } from 'redis';

import { closeRedisClient } from '../redis-client.js';

/** What the guard expects back (the package does not export the record type by name). */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * One fixed window per key, in one round trip: count the hit, start the window on the first one,
 * and block for `blockDuration` once the count passes the limit. Atomic because Redis runs a
 * script without interleaving, so two API instances counting the same login cannot both slip
 * under the limit.
 *
 * Returns { hits, ms until the window resets, blocked (0/1), ms until the block lifts }.
 */
const INCREMENT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])

local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  return { hits, math.max(redis.call('PTTL', hitsKey), 0), 1, blockedFor }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local resetsIn = redis.call('PTTL', hitsKey)

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', block)
  return { hits, resetsIn, 1, block }
end
return { hits, resetsIn, 0, 0 }
`;

/**
 * Rate-limit counters in Redis, so every API instance enforces one shared limit (W4 D5). With the
 * counters in memory, three instances behind a load balancer would each allow ten logins a
 * minute: thirty for an attacker who spreads requests.
 *
 * If Redis is unreachable the guard falls back to this process's own memory, with a warning —
 * still a limit, just per instance — rather than refusing every login while Redis is down.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger('RateLimit');
  private readonly client: ReturnType<typeof createClient>;
  private readonly fallback = new ThrottlerStorageService();
  private warned = false;
  private connecting: Promise<unknown> | null = null;

  constructor(url: string) {
    this.client = createClient({
      url,
      // Fail fast while disconnected (and use the fallback) instead of queueing the request.
      disableOfflineQueue: true,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5_000) },
    });
    this.client.on('error', (error: Error) => this.warnOnce(error));
  }

  /**
   * Waits briefly for Redis before the app takes requests, so the first logins are counted in
   * the shared store and not in this process. Never longer than two seconds: an API whose Redis
   * is down still starts, on the in-memory fallback, and switches over once Redis is back.
   */
  async onModuleInit(): Promise<void> {
    // Nest calls this twice: the instance is our provider and ThrottlerModule's `storage` value.
    this.connecting ??= this.client.connect().catch((error: unknown) => {
      this.warnOnce(error as Error);
    });
    await Promise.race([this.connecting, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.client.isReady) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
    try {
      const prefix = `shiftora:throttle:${throttlerName}:${key}`;
      const [hits, resetsIn, blocked, blockedFor] = (await this.client.eval(INCREMENT, {
        keys: [prefix, `${prefix}:blocked`],
        arguments: [String(ttl), String(limit), String(blockDuration)],
      })) as [number, number, number, number];
      this.warned = false;
      return {
        totalHits: hits,
        // The guard works in seconds, as the in-memory storage does.
        timeToExpire: Math.ceil(resetsIn / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockedFor / 1000),
      };
    } catch (error) {
      this.warnOnce(error as Error);
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.fallback.onApplicationShutdown();
    // Connected: finish what is in flight. Still reconnecting: stop now, or shutdown waits on a
    // Redis that is not there. Never `quit()` — see `common/redis-client.ts`.
    await closeRedisClient(this.client);
  }

  private warnOnce(error: Error): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `Redis unavailable for rate limits (${error.message}); counting in this process`,
    );
  }
}
