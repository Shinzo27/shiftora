import { Injectable } from '@nestjs/common';
import { and, asc, eq, schema } from '@shiftora/db';
import type {
  CoverageRequirementView,
  CreateCoverageRequirement,
  UpdateCoverageRequirement,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { errorCodes } from '@shiftora/shared';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';

const { coverageRequirements } = schema;

/** Postgres’s unique violation, possibly wrapped by the query builder: walk the cause chain. */
function uniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const duplicate = new AppException(
  409,
  errorCodes.coverageAlreadyExists,
  'That branch already has a requirement starting at this time for this role. Edit it instead.',
);

function snapshot(row: typeof coverageRequirements.$inferSelect): Record<string, unknown> {
  return {
    locationId: row.locationId,
    weekday: row.weekday,
    jobRoleId: row.jobRoleId,
    startLocal: row.startLocal,
    endLocal: row.endLocal,
    headcount: row.headcount,
  };
}

/**
 * Standing coverage per branch (W7): what the auto-scheduler reads to know how many people a
 * weekday needs. Writes are a manager's, and they are scoped: a manager who cannot see a branch
 * cannot describe its staffing.
 *
 * Every write is audited in the same transaction as the change, like a shift or a location —
 * "we asked for two nurses on Mondays until last week" is the sort of question that gets asked
 * after a rota goes wrong.
 */
@Injectable()
export class CoverageService {
  constructor(
    private readonly context: RequestContext,
    private readonly access: LocationAccess,
    private readonly jobRoles: JobRolesService,
    private readonly audit: AuditService,
  ) {}

  async list(locationId: string): Promise<CoverageRequirementView[]> {
    await this.access.assertAccess(locationId);
    const rows = await this.context.tx
      .select()
      .from(coverageRequirements)
      .where(eq(coverageRequirements.locationId, locationId))
      .orderBy(
        asc(coverageRequirements.weekday),
        asc(coverageRequirements.startLocal),
        asc(coverageRequirements.jobRoleId),
      );
    return this.present(rows);
  }

  async create(
    locationId: string,
    body: CreateCoverageRequirement,
  ): Promise<CoverageRequirementView> {
    this.access.assertWritable(await this.access.assertAccess(locationId));
    // The composite foreign key would refuse a role from another organisation, but as a 500.
    // Answer it as what it is: a role that does not exist here.
    if (body.jobRoleId) await this.jobRoles.assertAllExist([body.jobRoleId]);

    // Two unique indexes cover this: (role not null) and a partial one for anyone, because
    // Postgres treats NULLs as distinct and the plain index would let a duplicate through. A
    // violation is the race between two managers, and it means the same thing as a duplicate.
    let row: typeof coverageRequirements.$inferSelect | undefined;
    try {
      [row] = await this.context.tx
        .insert(coverageRequirements)
        .values({
          orgId: this.context.orgId,
          locationId,
          weekday: body.weekday,
          jobRoleId: body.jobRoleId ?? null,
          startLocal: body.startLocal,
          endLocal: body.endLocal,
          headcount: body.headcount,
        })
        .returning();
    } catch (error) {
      if (uniqueViolation(error)) throw duplicate;
      throw error;
    }

    await this.audit.record({
      action: 'coverage.created',
      entity: 'coverage_requirement',
      entityId: row!.id,
      after: snapshot(row!),
    });

    const [view] = await this.present([row!]);
    return view!;
  }

  async update(id: string, body: UpdateCoverageRequirement): Promise<CoverageRequirementView> {
    const existing = await this.find(id);
    this.access.assertWritable(await this.access.assertAccess(existing.locationId));
    if (body.jobRoleId) await this.jobRoles.assertAllExist([body.jobRoleId]);

    let row: typeof coverageRequirements.$inferSelect | undefined;
    try {
      [row] = await this.context.tx
        .update(coverageRequirements)
        .set({
          ...(body.weekday === undefined ? {} : { weekday: body.weekday }),
          ...(body.jobRoleId === undefined ? {} : { jobRoleId: body.jobRoleId }),
          ...(body.startLocal === undefined ? {} : { startLocal: body.startLocal }),
          ...(body.endLocal === undefined ? {} : { endLocal: body.endLocal }),
          ...(body.headcount === undefined ? {} : { headcount: body.headcount }),
          updatedAt: new Date(),
        })
        .where(eq(coverageRequirements.id, id))
        .returning();
    } catch (error) {
      // An edit can collide with another row just as an insert can.
      if (uniqueViolation(error)) throw duplicate;
      throw error;
    }

    await this.audit.record({
      action: 'coverage.updated',
      entity: 'coverage_requirement',
      entityId: id,
      before: snapshot(existing),
      after: snapshot(row!),
    });

    const [view] = await this.present([row!]);
    return view!;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.find(id);
    this.access.assertWritable(await this.access.assertAccess(existing.locationId));
    await this.context.tx.delete(coverageRequirements).where(eq(coverageRequirements.id, id));
    await this.audit.record({
      action: 'coverage.deleted',
      entity: 'coverage_requirement',
      entityId: id,
      before: snapshot(existing),
    });
  }

  private async find(id: string) {
    const [row] = await this.context.tx
      .select()
      .from(coverageRequirements)
      .where(and(eq(coverageRequirements.id, id), eq(coverageRequirements.orgId, this.context.orgId)));
    if (!row) {
      throw new AppException(404, errorCodes.coverageNotFound, 'No such coverage requirement.');
    }
    return row;
  }

  /** Rows plus the role names, in one extra query rather than one per row. */
  private async present(
    rows: (typeof coverageRequirements.$inferSelect)[],
  ): Promise<CoverageRequirementView[]> {
    const roles = await this.jobRoles.list();
    const nameOf = new Map(roles.map((role) => [role.id, role.name]));
    return rows.map((row) => ({
      id: row.id,
      locationId: row.locationId,
      weekday: row.weekday,
      jobRoleId: row.jobRoleId,
      jobRoleName: row.jobRoleId ? (nameOf.get(row.jobRoleId) ?? null) : null,
      startLocal: row.startLocal,
      endLocal: row.endLocal,
      headcount: row.headcount,
    }));
  }
}
