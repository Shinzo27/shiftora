import { Injectable } from '@nestjs/common';
import { errorCodes, type MemberLocations } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { AuditService } from '../audit/audit.service.js';
import { MembershipsRepository } from '../orgs/memberships.repository.js';
import { LocationsRepository } from './locations.repository.js';
import { MembershipLocationsRepository } from './membership-locations.repository.js';

@Injectable()
export class MemberLocationsService {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly scopes: MembershipLocationsRepository,
    private readonly locations: LocationsRepository,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<MemberLocations> {
    const member = await this.memberships.find(userId);
    if (!member) throw memberNotFound();
    const locationIds = member.role === 'owner' ? [] : await this.scopes.locationIdsFor(userId);
    return { userId, restricted: locationIds.length > 0, locationIds };
  }

  /** Owner-only route. An empty list lifts the restriction (all locations). */
  async set(userId: string, requested: string[]): Promise<MemberLocations> {
    const member = await this.memberships.find(userId);
    if (!member) throw memberNotFound();
    if (member.role === 'owner') {
      throw new AppException(
        400,
        errorCodes.ownerUnrestricted,
        'Owners always have access to every location.',
      );
    }

    const locationIds = [...new Set(requested)].sort();
    if ((await this.locations.countExisting(locationIds)) !== locationIds.length) {
      throw new AppException(
        404,
        errorCodes.locationNotFound,
        'One or more locations do not exist.',
      );
    }

    const before = await this.scopes.locationIdsFor(userId);
    await this.scopes.replace(userId, locationIds);
    await this.audit.record({
      action: 'membership.locations_changed',
      entity: 'membership',
      entityId: userId,
      before: { locationIds: before },
      after: { locationIds },
    });
    return { userId, restricted: locationIds.length > 0, locationIds };
  }
}

function memberNotFound() {
  return new AppException(404, errorCodes.memberNotFound, 'No such member in this organisation.');
}
