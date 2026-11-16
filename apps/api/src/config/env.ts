import { z } from 'zod';

const DEV_SECRET_PREFIX = 'dev-only';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    JWT_ACCESS_SECRET: z.string().min(32, 'Must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    /** Handed to the browser so it can subscribe; absent disables the push button. */
    VAPID_PUBLIC_KEY: z.string().optional(),
    /**
     * Optional: with it, realtime events reach every API instance and rate limits are shared by
     * all of them; without it, both stay inside one process.
     */
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    /**
     * Meta's app secret: every WhatsApp webhook is signed with it (`X-Hub-Signature-256`).
     * Unset, the webhook answers 404 and accepts nothing.
     */
    WHATSAPP_APP_SECRET: z.string().min(16).optional(),
    /** The token Meta echoes when the webhook URL is registered (the GET handshake). */
    WHATSAPP_VERIFY_TOKEN: z.string().min(8).optional(),
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || !env.JWT_ACCESS_SECRET.startsWith(DEV_SECRET_PREFIX),
    {
      path: ['JWT_ACCESS_SECRET'],
      message: 'The development secret must not be used in production',
    },
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables once at startup, so a missing or malformed value
 * stops the app immediately instead of failing on the first request that needs it.
 * The error lists variable names and problems, never the values (they may be secrets).
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
