import { Injectable } from '@nestjs/common';
import { errorCodes, idempotencyKeySchema } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { sha256Hex } from '../../common/crypto.js';
import { RequestContext } from '../../database/request-context.js';
import { IdempotencyKeysRepository } from './idempotency-keys.repository.js';

export interface IdempotentRun<T> {
  /** Kept stable when the route changes shape: `POST /me/open-shifts/:id/claim`. */
  route: string;
  /** The client's `Idempotency-Key`. */
  key: string | undefined;
  /** Everything that must not differ between a request and its retry. */
  parts: unknown[];
  run: () => Promise<{ status: number; body: T }>;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  /** True when this answer came from an earlier attempt, not from running `run` again. */
  replayed: boolean;
}

/**
 * Makes a write safe to retry.
 *
 * The reservation is the whole trick: the row is inserted **before** the work, so two requests
 * carrying the same key cannot both do it — the second blocks on the unique index until the first
 * commits, then reads its answer and returns it verbatim. A retry therefore cannot claim two
 * shifts, and a client that lost the response still learns what happened.
 *
 * Everything runs inside the request's own transaction, so a request that fails leaves no
 * reservation behind: the row and the effect commit together, or not at all.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly context: RequestContext,
    private readonly keys: IdempotencyKeysRepository,
  ) {}

  async run<T>(input: IdempotentRun<T>): Promise<IdempotentResult<T>> {
    const key = this.parseKey(input.key);
    const requestHash = sha256Hex(JSON.stringify(input.parts));
    const orgId = this.context.orgId;
    const scope = { orgId, route: input.route, key, requestHash };

    const reserved = await this.keys.reserve(scope);
    if (!reserved) {
      // Somebody holds this key. `find` uses `for update`, so if that request is still running we
      // wait for it to commit and then read its answer — a retry never gets a second effect.
      const existing = await this.keys.find(orgId, input.route, key);
      if (!existing || existing.requestHash !== requestHash) throw reuse();

      if (existing.responseStatus !== null && existing.responseBody !== null) {
        return {
          status: existing.responseStatus,
          body: existing.responseBody as T,
          replayed: true,
        };
      }
      // A reservation with no answer can only mean its transaction was rolled back by a crash
      // rather than a failure. Take it over and do the work.
      await this.keys.takeover(existing.id, requestHash);
    }

    const outcome = await input.run();
    const row = await this.keys.find(orgId, input.route, key);
    // The reservation is in this transaction, so it is visible here; if it is somehow gone, the
    // work is still done and correct — only the replay is lost.
    if (row) await this.keys.store(row.id, outcome);
    return { ...outcome, replayed: false };
  }

  private parseKey(key: string | undefined): string {
    const parsed = idempotencyKeySchema.safeParse(key ?? '');
    if (!parsed.success) {
      throw new AppException(
        400,
        errorCodes.idempotencyKeyRequired,
        'This request needs an Idempotency-Key header, so a retry cannot do it twice.',
      );
    }
    return parsed.data;
  }
}

const reuse = (): AppException =>
  new AppException(
    409,
    errorCodes.idempotencyKeyReuse,
    'That Idempotency-Key was used for a different request. Use a new key.',
  );
