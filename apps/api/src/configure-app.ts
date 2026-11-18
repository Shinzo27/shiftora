import fastifyCookie from '@fastify/cookie';
import type { FastifyServerOptions } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';

import { runWithTrace, traceIdFrom } from './common/logging.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';

export const API_PREFIX = 'api/v1';

const TRACE_ID = /^[0-9a-f]{32}$/;

export interface HttpOptions {
  /** Browser origin allowed to call the API with cookies (the web app). */
  webOrigin: string;
}

/**
 * Fastify's own options, shared by main.ts and tests. The request id **is** the trace id (from
 * the caller's `traceparent`, or new), so Fastify's lines, ours and the outbox agree on one value.
 * Fastify's per-request logging is off; `configureApp` writes one line per request instead.
 */
export function fastifyOptions(logger: Logger): FastifyServerOptions {
  return {
    loggerInstance: logger,
    genReqId: (request) => traceIdFrom(request.headers),
    disableRequestLogging: true,
  };
}

/** App-wide HTTP setup, shared by main.ts and tests so they behave the same. */
export async function configureApp(
  app: NestFastifyApplication,
  options: HttpOptions,
): Promise<void> {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  app.enableCors({ origin: options.webOrigin, credentials: true });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.register(fastifyCookie);

  const fastify = app.getHttpAdapter().getInstance();
  const traces = new WeakMap<object, string>();
  // Everything after this hook — guards, the handler, the outbox write — runs inside the trace.
  // The request id is the trace id when the app was built with `fastifyOptions`; an app built
  // without it has Fastify's own ids ("req-1"), which are not trace ids, so one is made here.
  fastify.addHook('onRequest', (request, reply, done) => {
    const traceId = TRACE_ID.test(request.id) ? request.id : traceIdFrom(request.headers);
    traces.set(request, traceId);
    void reply.header('x-trace-id', traceId);
    runWithTrace(traceId, done);
  });
  // One line per request. The route pattern, never the raw URL: a query string can carry a
  // one-time token (email confirmation), and ids add nothing the trace does not.
  fastify.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const line = {
      traceId: traces.get(request) ?? request.id,
      ...(request.member ? { orgId: request.member.orgId } : {}),
      method: request.method,
      route,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    };
    if (route.includes('/health/')) fastify.log.debug(line, 'request');
    else if (reply.statusCode >= 500) fastify.log.error(line, 'request');
    else fastify.log.info(line, 'request');
    done();
  });
}
