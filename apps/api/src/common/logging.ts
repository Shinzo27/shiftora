import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import type { LoggerService } from '@nestjs/common';
import { pino, type DestinationStream, type Level, type Logger } from 'pino';

/**
 * Structured logs (W7 D5): one JSON object per line, each carrying the request's `traceId` and,
 * once the tenancy interceptor knows it, the `orgId`. The trace id is W3C-shaped (32 hex) and is
 * written on every outbox row the request creates, so the worker's lines for the same change
 * share it — one id from the click to the provider.
 */

/**
 * Never in a log line: credentials, cookies, contact details. pino replaces these paths before
 * the line is written, wherever a caller put them (AGENTS.md → never log secrets).
 */
export const REDACT_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'phone',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
  '*.phone',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

interface TraceStore {
  traceId: string;
  orgId?: string;
}

const traces = new AsyncLocalStorage<TraceStore>();

/** Runs `fn` with a trace in scope: everything it logs or writes to the outbox carries the id. */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return traces.run({ traceId }, fn);
}

export function currentTraceId(): string | null {
  return traces.getStore()?.traceId ?? null;
}

/** Adds the organisation once the tenancy interceptor has checked it. */
export function annotateTrace(fields: { orgId: string | null }): void {
  const store = traces.getStore();
  if (store && fields.orgId) store.orgId = fields.orgId;
}

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * The trace id for an incoming request: the caller's, if it sent a valid W3C `traceparent`
 * (a load balancer or a browser with tracing on), otherwise a fresh one. An all-zero id is
 * invalid by the spec and is replaced.
 */
export function traceIdFrom(headers: Record<string, string | string[] | undefined>): string {
  const header = headers['traceparent'];
  const match = typeof header === 'string' ? TRACEPARENT.exec(header.trim()) : null;
  const id = match?.[1];
  return id && !/^0+$/.test(id) ? id : newTraceId();
}

export interface LoggerOptions {
  level?: string;
  /** Tests pass an in-memory stream to read what was logged. */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      base: { service: 'api' },
      level: options.level ?? process.env['LOG_LEVEL'] ?? 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      // Read on every line, so a log written anywhere inside a request is tagged without the
      // caller passing anything along.
      mixin: () => {
        const store = traces.getStore();
        if (!store) return {};
        return store.orgId
          ? { traceId: store.traceId, orgId: store.orgId }
          : { traceId: store.traceId };
      },
    },
    options.destination,
  );
}

/**
 * Nest's `Logger` (used across modules as `new Logger('Auth')`) writing through pino, so its
 * lines are JSON with the same trace fields. Nest passes the context name last and, for errors,
 * the stack before it.
 */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  private write(level: Level, message: unknown, rest: unknown[]): void {
    const params = [...rest];
    const fields: Record<string, unknown> = {};
    if (params.length > 0 && typeof params.at(-1) === 'string') fields['context'] = params.pop();
    if (typeof params[0] === 'string') fields['stack'] = params.shift();

    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message);
    } else if (typeof message === 'object' && message !== null) {
      this.logger[level]({ ...fields, ...(message as Record<string, unknown>) });
    } else {
      this.logger[level](fields, String(message));
    }
  }
}
