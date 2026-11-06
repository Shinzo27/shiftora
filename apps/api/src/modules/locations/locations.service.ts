import { Injectable } from '@nestjs/common';
import {
  errorCodes,
  type CreateLocationRequest,
  type Location,
  type UpdateLocationRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isUniqueViolation } from '../../common/db-errors.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { LocationAccess } from './location-access.service.js';
import { LocationsRepository, type LocationRecord } from './locations.repository.js';

export function toLocation(row: LocationRecord): Location {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: row.radiusM,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export const nameTaken = (what: string) =>
  new AppException(409, errorCodes.nameTaken, `A ${what} with this name already exists.`);

/** The fields of a location that are compared for the audit log. */
function snapshot(row: LocationRecord) {
  const { name, address, latitude, longitude, radiusM, timezone, status } = row;
  return { name, address, latitude, longitude, radiusM, timezone, status };
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly context: RequestContext,
    private readonly locations: LocationsRepository,
    private readonly access: LocationAccess,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Location[]> {
    return (await this.locations.list(await this.access.scope())).map(toLocation);
  }

  async get(id: string): Promise<Location> {
    return toLocation(await this.access.assertAccess(id));
  }

  /** Owner-only route. Plan limits (Free = 1 location) arrive with billing in week 8. */
  async create(input: CreateLocationRequest): Promise<Location> {
    let row: LocationRecord;
    try {
      row = await this.locations.create({ ...input, address: input.address ?? null });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('location');
      throw error;
    }
    await this.audit.record({
      action: 'location.created',
      entity: 'location',
      entityId: row.id,
      after: snapshot(row),
    });
    return toLocation(row);
  }

  /** Owners and managers (within their scope). Only owners change `status`. */
  async update(id: string, changes: UpdateLocationRequest): Promise<Location> {
    const current = await this.access.assertAccess(id);
    const { status, ...details } = changes;

    if (status !== undefined && this.context.role !== 'owner') {
      throw new AppException(
        403,
        errorCodes.forbidden,
        'Only owners can change a location status.',
      );
    }
    // While read-only only the status may change (an owner re-activating it).
    if (Object.keys(details).length > 0) this.access.assertWritable(current);

    let updated: LocationRecord;
    try {
      updated = await this.locations.update(id, changes);
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('location');
      throw error;
    }
    await this.audit.record({
      action: 'location.updated',
      entity: 'location',
      entityId: id,
      before: snapshot(current),
      after: snapshot(updated),
    });
    return toLocation(updated);
  }
}
