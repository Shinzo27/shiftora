import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@shiftora/domain';
import { jwtVerify, SignJWT } from 'jose';

import { CLOCK } from '../../common/clock.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { AppConfig } from '../../config/app-config.js';

const ISSUER = 'shiftora';
const AUDIENCE = 'shiftora-api';

export interface AccessToken {
  token: string;
  /** Seconds until expiry. */
  expiresIn: number;
}

/** SHA-256 hex of a refresh token. Only this is stored, so a DB leak exposes no tokens. */
export const hashRefreshToken = sha256Hex;

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.jwtAccessSecret);
  }

  async signAccessToken(userId: string): Promise<AccessToken> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const expiresIn = this.config.accessTokenTtlSeconds;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .sign(this.key);
    return { token, expiresIn };
  }

  /** Returns the user id, or null for any invalid, expired or tampered token. */
  async verifyAccessToken(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  /** 32 random bytes → 43-character base64url string. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomToken();
    return { token, hash: hashRefreshToken(token) };
  }
}
