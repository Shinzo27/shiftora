import { z } from 'zod';

/**
 * The worker's configuration.
 *
 * `REDIS_URL` is required here and optional in the API: without Redis the API still serves
 * requests (realtime quietly degrades), but a worker with no queue has nothing to do, so a
 * missing value should stop it at boot rather than leave a process idling.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** How often the relay looks for unpublished events. Cheap: one indexed query. */
  RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  /** Events claimed per tick. Each one is a queue insert, so keep it modest. */
  RELAY_BATCH: z.coerce.number().int().min(1).max(500).default(50),
  /** Jobs one worker process runs at once. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  /** SMTP: Mailpit on :1025 locally; any relay in production. */
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** The web app's public URL: links in emails are built from it. */
  APP_URL: z.url().default('http://localhost:5173'),
  /** What staff see in the From line. */
  MAIL_FROM: z.string().min(3).default('Shiftora <no-reply@shiftora.local>'),
});

export type WorkerEnv = z.output<typeof envSchema>;

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Names and problems only: a configuration error must never print a secret.
    throw new Error(`Invalid worker environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
