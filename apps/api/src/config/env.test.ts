import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://app_user:secret@localhost:5433/shiftora',
  JWT_ACCESS_SECRET: 'dev-only-a-secret-that-is-long-enough-123',
};

function errorMessage(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv(valid)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
      JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      WEB_ORIGIN: 'http://localhost:5173',
    });
  });

  it('coerces numbers', () => {
    const env = parseEnv({ ...valid, PORT: '8080', ACCESS_TOKEN_TTL_SECONDS: '600' });
    expect([env.PORT, env.ACCESS_TOKEN_TTL_SECONDS]).toEqual([8080, 600]);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(errorMessage({ ...valid, DATABASE_URL: undefined })).toContain('DATABASE_URL');
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(errorMessage({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toContain(
      'DATABASE_URL',
    );
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(errorMessage({ ...valid, JWT_ACCESS_SECRET: 'short' })).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects the development JWT secret in production', () => {
    expect(errorMessage({ ...valid, NODE_ENV: 'production' })).toContain('JWT_ACCESS_SECRET');
  });

  it('does not echo secret values in the error', () => {
    const message = errorMessage({
      DATABASE_URL: 'not a url with s3cr3t',
      JWT_ACCESS_SECRET: 's3cr3t',
    });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('s3cr3t');
  });
});
