import { describe, expect, it } from 'vitest';

import {
  annotateTrace,
  createLogger,
  currentTraceId,
  PinoNestLogger,
  runWithTrace,
  traceIdFrom,
} from './logging.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'trace',
    destination: {
      write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>),
    },
  });
  return { logger, lines };
}

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('traceIdFrom', () => {
  it("keeps the caller's W3C trace id", () => {
    expect(traceIdFrom({ traceparent: `00-${TRACE}-00f067aa0ba902b7-01` })).toBe(TRACE);
  });

  it('makes a new one when the header is missing, malformed or all zeros', () => {
    for (const traceparent of [
      undefined,
      'nonsense',
      `00-${TRACE.toUpperCase()}-00f067aa0ba902b7-01`,
      `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
    ]) {
      const id = traceIdFrom(traceparent ? { traceparent } : {});
      expect(id, String(traceparent)).toMatch(/^[0-9a-f]{32}$/);
      expect(id).not.toBe(TRACE);
      expect(id).not.toBe('0'.repeat(32));
    }
  });
});

describe('createLogger', () => {
  it('tags every line inside a trace with the trace and, once known, the organisation', () => {
    const { logger, lines } = capture();
    logger.info('outside');
    runWithTrace(TRACE, () => {
      logger.info('before the org is known');
      annotateTrace({ orgId: 'org-1' });
      logger.info('after');
      expect(currentTraceId()).toBe(TRACE);
    });
    expect(lines.map((l) => [l['msg'], l['traceId'], l['orgId']])).toEqual([
      ['outside', undefined, undefined],
      ['before the org is known', TRACE, undefined],
      ['after', TRACE, 'org-1'],
    ]);
    expect(currentTraceId()).toBeNull();
  });

  it('never writes credentials, cookies or phone numbers', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        password: 'correct horse',
        phone: '+919820000001',
        user: { token: 'abc', refreshToken: 'def', phone: '+919820000002' },
        req: { headers: { authorization: 'Bearer secret', cookie: 'refresh=x' } },
      },
      'careless',
    );
    const text = JSON.stringify(lines);
    for (const secret of ['correct horse', '+9198', 'abc', 'def', 'Bearer secret', 'refresh=x']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(lines[0]).toMatchObject({ password: '[redacted]', user: { token: '[redacted]' } });
  });
});

describe('PinoNestLogger', () => {
  it("maps Nest's (message, stack, context) onto JSON fields", () => {
    const { logger, lines } = capture();
    const nest = new PinoNestLogger(logger);
    nest.log('started', 'Bootstrap');
    nest.error('boom', 'Error: boom\n    at x', 'Errors');
    nest.warn({ event: 'slow', ms: 900 }, 'Db');

    expect(lines[0]).toMatchObject({ level: 30, msg: 'started', context: 'Bootstrap' });
    expect(lines[1]).toMatchObject({ level: 50, msg: 'boom', context: 'Errors' });
    expect(lines[1]!['stack']).toContain('at x');
    expect(lines[2]).toMatchObject({ level: 40, event: 'slow', ms: 900, context: 'Db' });
  });
});
