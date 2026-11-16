import { Inject, Injectable } from '@nestjs/common';
import {
  canTakeOpenShift,
  paidMinutes,
  toLocal,
  type Assessment,
  type Clock,
} from '@shiftora/domain';
import {
  errorCodes,
  type EligibleCandidate,
  type OfferResult,
  type OpenShift,
  type Shift,
  type ShiftCandidates,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { CLOCK } from '../../common/clock.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { LocationsRepository, type LocationRecord } from '../locations/locations.repository.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { OrgMember } from '../tenancy/member.js';
import { SchedulesRepository } from './schedules.repository.js';
import { ShiftRequestsRepository } from './shift-requests.repository.js';
import { ShiftsRepository, type ShiftRecord } from './shifts.repository.js';
import { ShiftsService } from './shifts.service.js';

const shiftNotFound = () => new AppException(404, errorCodes.shiftNotFound, 'No such shift.');

/** The reasons a candidate is shown with: what blocks them, or what a manager should know. */
function reasonsOf(assessment: Assessment): string[] {
  return [
    ...assessment.blocking.map((blocker) => blocker.message),
    ...assessment.advisories.map((warning) => warning.message),
  ];
}

/**
 * Open shifts (W5 D3): who could take one, offering it to exactly those people, and the list
 * each member of staff sees. "Could take" is one rule everywhere — `canTakeOpenShift`: works at
 * the location, has the job role, is free, and the shift breaks none of their rest, hours or
 * time off (availability is a preference and does not exclude anyone).
 *
 * Offering records the moment and writes one `shift.offered` event naming the people; the
 * worker messages exactly them. Who wins a claim is W5 D4.
 */
@Injectable()
export class OpenShiftsService {
  constructor(
    private readonly shifts: ShiftsRepository,
    private readonly shiftsService: ShiftsService,
    private readonly schedules: SchedulesRepository,
    private readonly requests: ShiftRequestsRepository,
    private readonly employees: EmployeesService,
    private readonly locations: LocationsRepository,
    private readonly jobRoles: JobRolesService,
    private readonly access: LocationAccess,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly context: RequestContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Everyone at the location, eligible first, with why (not). For the manager's preview. */
  async candidates(shiftId: string): Promise<ShiftCandidates> {
    const { shift } = await this.openShift(shiftId);
    const staff = await this.employees.activeAt(shift.locationId);
    const assessments = await this.shiftsService.assessMany(
      staff.map((person) => person.id),
      shift,
    );
    const candidates: EligibleCandidate[] = staff.flatMap((person) => {
      const assessment = assessments.get(person.id);
      if (!assessment) return [];
      return [
        {
          employeeId: person.id,
          name: person.name,
          eligible: canTakeOpenShift(assessment),
          reasons: reasonsOf(assessment),
        },
      ];
    });
    candidates.sort((a, b) =>
      a.eligible === b.eligible ? a.name.localeCompare(b.name) : a.eligible ? -1 : 1,
    );
    return { shiftId: shift.id, candidates };
  }

  /** A manager offers an open shift: the eligible staff are told. */
  async offer(shiftId: string): Promise<OfferResult> {
    const { shift } = await this.openShift(shiftId, { writable: true });
    return this.offerShift(shift);
  }

  /**
   * Offers `shift` to everyone who could take it except `exclude` (the person who just dropped
   * it). Used by `offer` and by an approved drop, inside the caller's transaction.
   */
  async offerShift(shift: ShiftRecord, exclude: string[] = []): Promise<OfferResult> {
    if (shift.startsAt.getTime() <= this.clock.now().getTime()) {
      throw new AppException(
        409,
        errorCodes.shiftRequestExpired,
        'This shift has already started: it is too late to offer it.',
      );
    }
    const staff = await this.employees.activeAt(shift.locationId);
    const assessments = await this.shiftsService.assessMany(
      staff.map((person) => person.id).filter((id) => !exclude.includes(id)),
      shift,
    );
    const employeeIds = [...assessments]
      .filter(([, assessment]) => canTakeOpenShift(assessment))
      .map(([id]) => id);

    const offeredAt = this.clock.now();
    await this.shifts.markOffered(shift.id, offeredAt);
    await this.audit.record({
      action: 'shift.offered',
      entity: 'shift',
      entityId: shift.id,
      after: { offeredTo: employeeIds.length },
    });
    if (employeeIds.length > 0) {
      await this.outbox.record('shift.offered', { shiftId: shift.id, employeeIds });
    }

    const schedule = await this.schedules.findById(shift.scheduleId);
    if (schedule) {
      this.realtime.scheduleChanged({
        orgId: this.context.orgId,
        scheduleId: schedule.id,
        locationId: shift.locationId,
        weekStart: schedule.weekStart,
        kind: 'shifts',
      });
    }
    return {
      shiftId: shift.id,
      offeredAt: offeredAt.toISOString(),
      offeredTo: employeeIds.length,
    };
  }

  /**
   * Takes an offered shift (W5 D4). The rule is first valid claim wins, and the database decides:
   * the row is updated only if it is still open **at the version we read**, so of two nurses who
   * tap at the same moment exactly one gets a shift and the other is told, plainly, that it has
   * gone. Everything else here is the same check `mine()` uses, so a claim cannot be a way around
   * eligibility.
   */
  async claim(member: OrgMember, shiftId: string): Promise<{ shift: Shift }> {
    const me = await this.employees.findByUserId(member.userId);
    if (!me || me.status === 'archived') {
      throw new AppException(
        409,
        errorCodes.shiftRequestNotEligible,
        'This account has no staff profile at this location.',
      );
    }

    const { shift, location } = await this.openShiftForClaim(shiftId);
    const assessment = (await this.shiftsService.assessMany([me.id], shift)).get(me.id);
    if (!assessment || !canTakeOpenShift(assessment)) {
      throw new AppException(
        409,
        errorCodes.shiftRequestNotEligible,
        reasonsOf(assessment ?? { blocking: [], advisories: [] }).join(' ') ||
          'You cannot take this shift.',
      );
    }

    const updated = await this.shifts.claim(shift.id, me.id, shift.version);
    if (!updated) {
      throw new AppException(409, errorCodes.shiftAlreadyTaken, 'Someone else took this shift.');
    }

    await this.audit.record({
      action: 'shift.claimed',
      entity: 'shift',
      entityId: shift.id,
      before: { employeeId: null, status: 'open', version: shift.version },
      after: { employeeId: me.id, status: 'assigned', version: updated.version },
    });
    // The rota everyone was told about has changed: keep the publication honest so the reminders
    // that follow name the right person.
    await this.schedules.recordToldChange(shift.scheduleId);
    await this.outbox.record('shift.claimed', {
      shiftId: shift.id,
      employeeId: me.id,
      locationId: shift.locationId,
      startsAt: shift.startsAt.toISOString(),
    });

    const schedule = await this.schedules.findById(shift.scheduleId);
    if (schedule) {
      this.realtime.scheduleChanged({
        orgId: this.context.orgId,
        scheduleId: schedule.id,
        locationId: shift.locationId,
        weekStart: schedule.weekStart,
        kind: 'shifts',
      });
    }

    return { shift: this.present(updated, location.timezone) };
  }

  /** An open shift that was offered and has not started; 404 outside scope, 409 otherwise. */
  private async openShiftForClaim(
    id: string,
  ): Promise<{ shift: ShiftRecord; location: LocationRecord }> {
    const { shift, location } = await this.shiftInScope(id);
    if (shift.employeeId !== null || shift.status === 'assigned') {
      throw new AppException(409, errorCodes.shiftAlreadyTaken, 'Someone else took this shift.');
    }
    if (shift.status !== 'open') {
      throw new AppException(409, errorCodes.shiftNotOpen, 'This shift is not open any more.');
    }
    if (shift.offeredAt === null) {
      throw new AppException(
        409,
        errorCodes.shiftNotOpen,
        'This shift has not been offered, so it cannot be taken.',
      );
    }
    if (shift.startsAt.getTime() <= this.clock.now().getTime()) {
      throw new AppException(
        409,
        errorCodes.shiftRequestExpired,
        'This shift has already started.',
      );
    }
    return { shift, location };
  }

  /** The row as the API shows a shift: instants in UTC, the rest in the location clock. */
  private present(row: ShiftRecord, timezone: string): Shift {
    const start = toLocal(row.startsAt, timezone);
    const end = toLocal(row.endsAt, timezone);
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      locationId: row.locationId,
      jobRoleId: row.jobRoleId,
      employeeId: row.employeeId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      breakMinutes: row.breakMinutes,
      paidMinutes: paidMinutes(row),
      status: row.status,
      version: row.version,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The offered open shifts the caller could take right now, soonest first. */
  async mine(member: OrgMember): Promise<OpenShift[]> {
    const me = await this.employees.findByUserId(member.userId);
    if (!me || me.status === 'archived') return [];
    const { locationIds } = await this.employees.relationsFor([me.id]);
    const offered = await this.shifts.offeredOpen(locationIds.get(me.id) ?? [], this.clock.now());
    // A shift someone gave up is not offered back to them.
    const dropped = await this.requests.droppedBy(
      me.id,
      offered.map((shift) => shift.id),
    );
    const shifts = offered.filter((shift) => !dropped.has(shift.id));
    if (shifts.length === 0) return [];

    const eligible: ShiftRecord[] = [];
    for (const shift of shifts) {
      const assessment = (await this.shiftsService.assessMany([me.id], shift)).get(me.id);
      if (assessment && canTakeOpenShift(assessment)) eligible.push(shift);
    }

    const [locations, roles] = await Promise.all([
      this.locations.findByIds([...new Set(eligible.map((shift) => shift.locationId))]),
      this.jobRoles.list(),
    ]);
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const roleName = new Map(roles.map((role) => [role.id, role.name]));
    return eligible.flatMap((shift) => {
      const location = locationById.get(shift.locationId);
      if (!location || !shift.offeredAt) return [];
      const start = toLocal(shift.startsAt, location.timezone);
      const end = toLocal(shift.endsAt, location.timezone);
      return [
        {
          id: shift.id,
          date: start.date,
          startTime: start.time,
          endTime: end.time,
          startsAt: shift.startsAt.toISOString(),
          endsAt: shift.endsAt.toISOString(),
          locationId: location.id,
          locationName: location.name,
          jobRoleName: shift.jobRoleId ? (roleName.get(shift.jobRoleId) ?? null) : null,
          offeredAt: shift.offeredAt.toISOString(),
        },
      ];
    });
  }

  /** An open shift at a location in the caller's scope; 404 outside it, 409 if not open. */
  private async openShift(
    id: string,
    { writable = false } = {},
  ): Promise<{ shift: ShiftRecord; location: LocationRecord }> {
    const found = await this.shiftInScope(id, { writable });
    if (found.shift.status !== 'open' || found.shift.employeeId !== null) {
      throw new AppException(
        409,
        errorCodes.shiftNotOpen,
        'Only an open shift (nobody on it) can be offered.',
      );
    }
    return found;
  }

  /** The shift and its location, if the caller may see that location at all. No status opinion. */
  private async shiftInScope(
    id: string,
    { writable = false } = {},
  ): Promise<{ shift: ShiftRecord; location: LocationRecord }> {
    const shift = await this.shifts.findById(id);
    if (!shift) throw shiftNotFound();
    let location: LocationRecord;
    try {
      location = await this.access.assertAccess(shift.locationId);
    } catch (error) {
      if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
        throw shiftNotFound();
      }
      throw error;
    }
    if (writable) this.access.assertWritable(location);
    return { shift, location };
  }
}
