import type { Env } from './env.js';

/** Typed, validated settings. Inject this instead of reading process.env. */
export class AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;

  constructor(env: Env) {
    this.nodeEnv = env.NODE_ENV;
    this.host = env.HOST;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
  }
}
