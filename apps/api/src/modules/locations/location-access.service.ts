import { Injectable } from '@nestjs/common';
import type { Transaction } from '@shiftora/db';
import { errorCodes } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { RequestContext } from '../../database/request-context.js';
import { LocationsRepository, type LocationRecord } from './locations.repository.js';
import { MembershipLocationsRepository } from './membership-locations.repository.js';

/** Which locations the caller may use in the current org. */
export type LocationScope = { kind: 'all' } | { kind: 'some'; ids: ReadonlySet<string> };

/**
 * The single place that decides location access:
 *   owners          → every location
 *   everyone else   → their membership_locations rows, or every location if they have none
 * Every location-bound read or write goes through `assertAccess` (or filters by `scope`).
 */
@Injectable()
export class LocationAccess {
  // One lookup per request: the cache key is the request's transaction object.
  private readonly cache = new WeakMap<Transaction, Promise<LocationScope>>();

  constructor(
    private readonly context: RequestContext,
    private readonly locations: LocationsRepository,
    private readonly scopes: MembershipLocationsRepository,
  ) {}

  scope(): Promise<LocationScope> {
    const tx = this.context.tx;
    let scope = this.cache.get(tx);
    if (!scope) {
      scope = this.loadScope();
      this.cache.set(tx, scope);
    }
    return scope;
  }

  /**
   * Returns the location if the caller may use it. Otherwise 404, the same answer as for an
   * id that doesn't exist, so a scoped manager can't probe the org's other locations.
   */
  async assertAccess(locationId: string): Promise<LocationRecord> {
    const scope = await this.scope();
    const location =
      scope.kind === 'all' || scope.ids.has(locationId)
        ? await this.locations.findById(locationId)
        : null;
    if (!location) {
      throw new AppException(404, errorCodes.locationNotFound, 'No such location.');
    }
    return location;
  }

  /** Read-only locations keep their history but take no new changes. */
  assertWritable(location: LocationRecord): void {
    if (location.status === 'read_only') {
      throw new AppException(
        409,
        errorCodes.locationReadOnly,
        'This location is read-only. An owner can make it active again.',
      );
    }
  }

  private async loadScope(): Promise<LocationScope> {
    if (this.context.role === 'owner') return { kind: 'all' };
    const ids = await this.scopes.locationIdsFor(this.context.userId);
    return ids.length === 0 ? { kind: 'all' } : { kind: 'some', ids: new Set(ids) };
  }
}
