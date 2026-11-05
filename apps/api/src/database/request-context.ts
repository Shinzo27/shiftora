import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import type { MemberRole } from '@shiftora/domain';
import { setOrgContext, type Transaction } from '@shiftora/db';

interface RequestStore {
  tx: Transaction;
  userId: string;
  orgId: string | null;
  role: MemberRole | null;
}

/**
 * The current request's database transaction and caller, available anywhere in the call
 * chain without passing them through every function.
 *
 * TenancyInterceptor opens one transaction per authenticated request, sets the RLS context
 * on it (who is calling, which org), and runs the route handler inside `run()`. Node's
 * AsyncLocalStorage then hands the same store to every async function the handler calls,
 * however deep, and to no other request. Repositories read `context.tx`, so every query of
 * a request uses the same transaction: all of it commits together or none of it does.
 */
@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestStore>();

  run<T>(store: RequestStore, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(store, fn);
  }

  private get store(): RequestStore {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error(
        'No request transaction. Tenant data can only be used inside an authenticated request ' +
          '(TenancyInterceptor) or an explicit RequestContext.run().',
      );
    }
    return store;
  }

  get tx(): Transaction {
    return this.store.tx;
  }

  get userId(): string {
    return this.store.userId;
  }

  /** The org this request acts on. Throws on @WithoutOrg() routes that haven't entered one. */
  get orgId(): string {
    const { orgId } = this.store;
    if (!orgId) throw new Error('No organisation selected for this request');
    return orgId;
  }

  /** The caller's role in the selected org (null after enterOrg, e.g. while accepting an invite). */
  get role(): MemberRole | null {
    return this.store.role;
  }

  /**
   * Points the rest of this transaction at another org. Only call this after proving the
   * caller may act there (they're creating it, or they hold a valid invite code for it).
   */
  async enterOrg(orgId: string): Promise<void> {
    await setOrgContext(this.tx, orgId);
    this.store.orgId = orgId;
  }
}
