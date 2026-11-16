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
  /** VAPID keys for Web Push. Absent means no push channel: the button hides, nothing crashes. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@shiftora.local'),
  /**
   * WhatsApp and SMS providers. `fake` logs instead of sending, so the whole pipeline (quota,
   * retries, dead letters, fallback) runs locally; `none` takes the channel out of routing.
   * Meta's adapter becomes a third value.
   */
  WHATSAPP_PROVIDER: z.enum(['none', 'fake']).default('none'),
  SMS_PROVIDER: z.enum(['none', 'fake']).default('none'),
  /**
   * Failure injection for the fake providers: every send fails this way. `undeliverable` is
   * accepted first and reported failed a moment later (needs the report URL below).
   */
  FAKE_PROVIDER_FAILURE: z
    .enum(['none', 'transient', 'permanent', 'rate_limited', 'undeliverable'])
    .default('none'),
  /**
   * Where the fake WhatsApp provider posts its delivery reports, signed like Meta's: the API's
   * webhook (http://localhost:4000/api/v1/webhooks/whatsapp). Unset, no reports are sent.
   */
  FAKE_PROVIDER_REPORT_URL: z.url().optional(),
  /** Meta's app secret: signs (fake) and verifies (API) `X-Hub-Signature-256`. */
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  /** How often the shift-reminder / missed clock-in scan runs. */
  ALERT_SCAN_INTERVAL_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
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
