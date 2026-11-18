import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * The worker's structured logs (W7 D5). Every job runs inside `inJob`, which gives it a child
 * logger tagged with the job's `traceId` (carried from the API request through the outbox row),
 * `orgId`, queue and job id. Code anywhere below calls `log()` and gets that logger; jobs it
 * queues carry the same trace (`traced()`), so the relay, the fan-out and the provider send of
 * one change share one id with the request that caused it.
 */

/** Same rule as the API: these never reach a log line. */
export const REDACT_PATHS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'phone',
  'to',
  '*.password',
  '*.token',
  '*.authorization',
  '*.cookie',
  '*.phone',
  '*.to',
];

export interface LoggerOptions {
  level?: string;
  /** Tests pass an in-memory stream to read what was logged. */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      base: { service: 'worker' },
      level: options.level ?? process.env['LOG_LEVEL'] ?? 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    options.destination,
  );
}

interface JobScope {
  logger: Logger;
  traceId: string;
}

const scopes = new AsyncLocalStorage<JobScope>();
const fallback = createLogger();

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** The current job's logger, or the process logger outside a job. */
export function log(): Logger {
  return scopes.getStore()?.logger ?? fallback;
}

export function currentTraceId(): string | null {
  return scopes.getStore()?.traceId ?? null;
}

/** Spread into the data of a job queued from inside another: the trace continues. */
export function traced(): { traceId?: string } {
  const traceId = currentTraceId();
  return traceId ? { traceId } : {};
}

export interface JobFields {
  /** Absent for work no request caused (a scheduled scan): a fresh trace starts here. */
  traceId?: string | null | undefined;
  orgId?: string | null | undefined;
  queue: string;
  jobId?: string | undefined;
}

/** Runs one job with its trace in scope. */
export function inJob<T>(root: Logger, fields: JobFields, fn: () => Promise<T>): Promise<T> {
  const traceId = fields.traceId ?? newTraceId();
  const logger = root.child({
    traceId,
    ...(fields.orgId ? { orgId: fields.orgId } : {}),
    queue: fields.queue,
    ...(fields.jobId ? { jobId: fields.jobId } : {}),
  });
  return scopes.run({ logger, traceId }, fn);
}
