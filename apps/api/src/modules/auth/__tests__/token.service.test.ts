import { fixedClock } from '@shiftora/domain';
import { decodeJwt, SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { AppConfig } from '../../../config/app-config.js';
import { parseEnv } from '../../../config/env.js';
import { hashRefreshToken, TokenService } from '../token.service.js';

const SECRET = 'dev-only-a-secret-that-is-long-enough-123';
const USER_ID = '0193a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';

function service(now = '2026-11-05T10:00:00Z', secret = SECRET): TokenService {
  const config = new AppConfig(
    parseEnv({ DATABASE_URL: 'postgres://u:p@localhost/db', JWT_ACCESS_SECRET: secret }),
  );
  return new TokenService(config, fixedClock(now));
}

async function forge(claims: { iss?: string; aud?: string }, secret = SECRET): Promise<string> {
  const now = Math.floor(new Date('2026-11-05T10:00:00Z').getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER_ID)
    .setIssuer(claims.iss ?? 'shiftora')
    .setAudience(claims.aud ?? 'shiftora-api')
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(new TextEncoder().encode(secret));
}

describe('TokenService access tokens', () => {
  it('signs a token that verifies back to the user id', async () => {
    const tokens = service();
    const { token, expiresIn } = await tokens.signAccessToken(USER_ID);

    expect(expiresIn).toBe(900);
    expect(await tokens.verifyAccessToken(token)).toBe(USER_ID);
  });

  it('puts the expected claims in the token', async () => {
    const { token } = await service().signAccessToken(USER_ID);

    const iat = Date.parse('2026-11-05T10:00:00Z') / 1000;
    expect(decodeJwt(token)).toEqual({
      sub: USER_ID,
      iss: 'shiftora',
      aud: 'shiftora-api',
      iat,
      exp: iat + 900,
    });
  });

  it('rejects a token once it has expired', async () => {
    const { token } = await service('2026-11-05T10:00:00Z').signAccessToken(USER_ID);

    expect(await service('2026-11-05T10:14:59Z').verifyAccessToken(token)).toBe(USER_ID);
    expect(await service('2026-11-05T10:15:01Z').verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const other = await forge({}, 'dev-only-some-other-secret-of-32-chars!!');
    expect(await service().verifyAccessToken(other)).toBeNull();
  });

  it('rejects the wrong issuer or audience', async () => {
    expect(await service().verifyAccessToken(await forge({ iss: 'someone-else' }))).toBeNull();
    expect(await service().verifyAccessToken(await forge({ aud: 'another-api' }))).toBeNull();
  });

  it('rejects an unsigned (alg: none) token', async () => {
    const unsigned = new UnsecuredJWT({})
      .setSubject(USER_ID)
      .setIssuer('shiftora')
      .setAudience('shiftora-api')
      .setExpirationTime('1h')
      .encode();
    expect(await service().verifyAccessToken(unsigned)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await service().verifyAccessToken('not.a.jwt')).toBeNull();
  });
});

describe('TokenService refresh tokens', () => {
  it('generates 43-character base64url tokens with a matching hash', () => {
    const { token, hash } = service().newRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => service().newRefreshToken().token));
    expect(tokens.size).toBe(100);
  });
});
