import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const valid = { DATABASE_URL: 'postgres://app_user:secret@localhost:5433/shiftora' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv(valid)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
    });
  });

  it('coerces PORT to a number', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('does not echo secret values in the error', () => {
    let message = '';
    try {
      parseEnv({ DATABASE_URL: 'not a url with s3cr3t' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('s3cr3t');
  });
});
