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
  /** Cookies get the Secure flag only in production, so local http works. */
  readonly secureCookies: boolean;

  constructor(env: Env) {
    this.nodeEnv = env.NODE_ENV;
    this.host = env.HOST;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.jwtAccessSecret = env.JWT_ACCESS_SECRET;
    this.accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
    this.refreshTokenTtlDays = env.REFRESH_TOKEN_TTL_DAYS;
    this.webOrigin = env.WEB_ORIGIN;
    this.secureCookies = env.NODE_ENV === 'production';
  }
}
