import type { Env } from './env.js';

/** Typed, validated settings. Inject this instead of reading process.env. */
export class AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly jwtAccessSecret: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlDays: number;
  readonly webOrigin: string;
  /** Null when realtime runs in a single process (no Redis configured). */
  readonly redisUrl: string | null;
  /** Null when Web Push is not configured: the staff app then hides its notification button. */
  readonly vapidPublicKey: string | null;
  /** Cookies get the Secure flag only in production, so local http works. */
  readonly secureCookies: boolean;
  /** Null: the WhatsApp webhook is off (404). */
  readonly whatsappAppSecret: string | null;
  readonly whatsappVerifyToken: string | null;

  constructor(env: Env) {
    this.nodeEnv = env.NODE_ENV;
    this.host = env.HOST;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.jwtAccessSecret = env.JWT_ACCESS_SECRET;
    this.accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
    this.refreshTokenTtlDays = env.REFRESH_TOKEN_TTL_DAYS;
    this.webOrigin = env.WEB_ORIGIN;
    this.redisUrl = env.REDIS_URL ?? null;
    this.vapidPublicKey = env.VAPID_PUBLIC_KEY ?? null;
    this.secureCookies = env.NODE_ENV === 'production';
    this.whatsappAppSecret = env.WHATSAPP_APP_SECRET ?? null;
    this.whatsappVerifyToken = env.WHATSAPP_VERIFY_TOKEN ?? null;
  }
}
