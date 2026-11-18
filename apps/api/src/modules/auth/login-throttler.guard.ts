import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * Login, signup and the password routes count **per account**, falling back to the address.
 *
 * A password is guessed for one account: that is the resource under attack, so that is the budget
 * that must be tight. Counting by address alone punishes exactly the customer this product is
 * built for — a clinic where twenty people arrive at 09:00 on one internet connection and the
 * twentieth is refused their own, correct password.
 *
 * A missing or unreadable email falls back to the address, so a client cannot dodge the limit by
 * sending nonsense instead of an account.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  // Not `async`: the work is synchronous, and the base class only asks for a promise.
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req['body'] as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email) return Promise.resolve(`account:${email}`);
    const ip = req['ip'];
    return Promise.resolve(`address:${typeof ip === 'string' && ip ? ip : 'anonymous'}`);
  }
}
