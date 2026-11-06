import { Injectable } from '@nestjs/common';
import { and, asc, eq, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { membershipLocations } = schema;

/** The location restrictions of members in the current org. */
@Injectable()
export class MembershipLocationsRepository {
  constructor(private readonly context: RequestContext) {}

  async locationIdsFor(userId: string): Promise<string[]> {
    const rows = await this.context.tx
      .select({ locationId: membershipLocations.locationId })
      .from(membershipLocations)
      .where(
        and(
          eq(membershipLocations.orgId, this.context.orgId),
          eq(membershipLocations.userId, userId),
        ),
      )
      .orderBy(asc(membershipLocations.locationId));
    return rows.map((row) => row.locationId);
  }

  /** Replaces the member's locations with `locationIds` (empty = no restriction). */
  async replace(userId: string, locationIds: string[]): Promise<void> {
    const orgId = this.context.orgId;
    await this.context.tx
      .delete(membershipLocations)
      .where(and(eq(membershipLocations.orgId, orgId), eq(membershipLocations.userId, userId)));
    if (locationIds.length > 0) {
      await this.context.tx
        .insert(membershipLocations)
        .values(locationIds.map((locationId) => ({ orgId, userId, locationId })));
    }
  }
}
