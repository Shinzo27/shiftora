import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { setTenantContext, type DatabaseConnection } from '@shiftora/db';
import type { MemberRole } from '@shiftora/domain';
import { errorCodes, ORG_HEADER } from '@shiftora/shared';
import type { FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { z } from 'zod';

import { AppException } from '../../common/app-exception.js';
import { DATABASE } from '../../database/database.module.js';
import { RequestContext } from '../../database/request-context.js';
import { IS_PUBLIC } from '../auth/public.decorator.js';
import { MembershipsRepository } from '../orgs/memberships.repository.js';
import { ROLES, WITHOUT_ORG } from './decorators.js';

const orgIdSchema = z.uuid();

/**
 * Runs every authenticated request inside one database transaction with the RLS context set.
 *
 * Order for a request (after JwtAuthGuard has identified the user):
 *   1. read X-Org-Id (unless the route is @WithoutOrg)
 *   2. BEGIN; set app.user_id and app.org_id (transaction-local)
 *   3. look up the caller's membership in that org: none → 403; role not allowed → 403
 *   4. run the route handler inside RequestContext, so repositories use this transaction
 *   5. COMMIT if the handler succeeded, ROLLBACK if it threw
 *
 * Why an interceptor and not a guard: Nest runs guards before interceptors, and the role
 * check has to happen inside the same transaction as the work (one round trip, and a
 * membership removed a moment ago is already gone). The role is read from the database on
 * every request, not from the token, so removing someone takes effect immediately.
 */
@Injectable()
export class TenancyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: DatabaseConnection,
    private readonly context: RequestContext,
    private readonly memberships: MembershipsRepository,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    if (execution.getType() !== 'http' || this.flag(execution, IS_PUBLIC)) {
      return next.handle(); // public routes (health, login…) touch only platform tables
    }

    const request = execution.switchToHttp().getRequest<FastifyRequest>();
    const user = request.user;
    if (!user) throw new Error('TenancyInterceptor ran before JwtAuthGuard set request.user');

    const orgId = this.flag(execution, WITHOUT_ORG) ? null : readOrgId(request);
    const allowedRoles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES, [
      execution.getHandler(),
      execution.getClass(),
    ]);

    return from(
      this.database.db.transaction(async (tx) => {
        await setTenantContext(tx, { userId: user.id, orgId });

        let role: MemberRole | null = null;
        if (orgId) {
          role = await this.memberships.findRole(tx, orgId, user.id);
          if (!role) {
            // Same answer whether the org doesn't exist or they're not in it.
            throw new AppException(
              403,
              errorCodes.notMember,
              'You are not a member of this organisation.',
            );
          }
          if (allowedRoles && !allowedRoles.includes(role)) {
            throw new AppException(
              403,
              errorCodes.forbidden,
              'Your role does not allow this action.',
            );
          }
          request.member = { userId: user.id, orgId, role };
        }

        return this.context.run({ tx, userId: user.id, orgId, role }, () =>
          lastValueFrom(next.handle(), { defaultValue: undefined }),
        );
      }),
    );
  }

  private flag(execution: ExecutionContext, key: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        execution.getHandler(),
        execution.getClass(),
      ]) === true
    );
  }
}

function readOrgId(request: FastifyRequest): string {
  const raw = request.headers[ORG_HEADER];
  const parsed = orgIdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.success) {
    throw new AppException(
      400,
      errorCodes.orgRequired,
      'Choose an organisation: send its id in the X-Org-Id header.',
    );
  }
  return parsed.data;
}
