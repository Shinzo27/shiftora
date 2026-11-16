import { Inject, Injectable } from '@nestjs/common';
import {
  availableActions,
  initialStatus,
  needsAcknowledgement,
  toLocal,
  transition,
  type Assessment,
  type Clock,
  type ShiftRequestAction,
  type ShiftRequestActor,
  type ShiftRequestStatus,
} from '@shiftora/domain';
import {
  errorCodes,
  type DecideShiftRequest,
  type FieldError,
  type ListShiftRequestsQuery,
  type NewShiftRequest,
  type RequestShift,
  type ShiftRequestView,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { CLOCK } from '../../common/clock.js';
import { isExclusionViolation, uniqueViolation } from '../../common/db-errors.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import type { EmployeeRecord } from '../employees/employees.repository.js';
import { JobRolesService } from '../job-roles/job-roles.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { LocationsRepository } from '../locations/locations.repository.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { OrgMember } from '../tenancy/member.js';
import { PublicationsRepository } from './publications.repository.js';
import { SchedulesRepository } from './schedules.repository.js';
import { ShiftRequestsRepository, type ShiftRequestRecord } from './shift-requests.repository.js';
import { ShiftsRepository, type ShiftRecord } from './shifts.repository.js';
import { ShiftsService } from './shifts.service.js';

const requestNotFound = () =>
  new AppException(404, errorCodes.shiftRequestNotFound, 'No such request.');
const shiftNotFound = () => new AppException(404, errorCodes.shiftNotFound, 'No such shift.');
const invalidTransition = (detail: string) =>
  new AppException(409, errorCodes.shiftRequestInvalidTransition, detail);

/** The outbox topic each action produces; the worker tells the right people (W5 D2). */
const TOPIC: Record<Exclude<ShiftRequestAction, 'expire'>, string> = {
  colleague_accept: 'shift_request.accepted',
  colleague_decline: 'shift_request.declined',
  manager_approve: 'shift_request.approved',
  manager_reject: 'shift_request.rejected',
  cancel: 'shift_request.cancelled',
};

/** Who is looking at a request, so each sees their own buttons. */
interface Viewer {
  employeeId: string | null;
  manager: boolean;
}

/**
 * Swaps and drops: staff ask, colleagues answer, managers decide (owner's rule: a manager
 * **always** approves a swap). The state machine is `packages/domain/requests`; this is the I/O.
 *
 * The one hard part is approval: it locks both shifts in id order, re-checks that they still
 * belong to the same people and have not started, re-validates the new assignments
 * (`assessMany`), reassigns, and records what staff have now been told — all in the request's
 * transaction, so a failure anywhere leaves both shifts as they were.
 */
@Injectable()
export class ShiftRequestsService {
  constructor(
    private readonly requests: ShiftRequestsRepository,
    private readonly shifts: ShiftsRepository,
    private readonly shiftsService: ShiftsService,
    private readonly schedules: SchedulesRepository,
    private readonly publications: PublicationsRepository,
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

  // ------------------------------------------------------------------------- staff

  async create(member: OrgMember, body: NewShiftRequest): Promise<ShiftRequestView> {
    const me = await this.staffOf(member);
    const shift = await this.shifts.findById(body.shiftId);
    if (!shift || shift.employeeId !== me.id || shift.status !== 'assigned') throw shiftNotFound();
    this.assertNotStarted(shift);
    await this.assertToldAbout(shift, me.id);

    let targetEmployeeId: string | null = null;
    let targetShiftId: string | null = null;
    if (body.type === 'swap') {
      const colleague = await this.colleague(body.targetEmployeeId!, me.id);
      targetEmployeeId = colleague.id;
      if (body.targetShiftId) {
        const theirs = await this.shifts.findById(body.targetShiftId);
        if (!theirs || theirs.employeeId !== colleague.id || theirs.status !== 'assigned') {
          throw shiftNotFound();
        }
        this.assertNotStarted(theirs);
        await this.assertToldAbout(theirs, colleague.id);
        targetShiftId = theirs.id;
      }
    }

    let row: ShiftRequestRecord;
    try {
      row = await this.requests.create({
        type: body.type,
        status: initialStatus(body.type),
        shiftId: shift.id,
        requesterEmployeeId: me.id,
        targetEmployeeId,
        targetShiftId,
        note: body.note ?? null,
      });
    } catch (error) {
      if (uniqueViolation(error)?.startsWith('shift_requests_one_open')) {
        throw new AppException(
          409,
          errorCodes.shiftRequestAlreadyOpen,
          'This shift already has a request waiting. Withdraw it first.',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'shift_request.created',
      entity: 'shift_request',
      entityId: row.id,
      after: { type: row.type, shiftId: row.shiftId, targetEmployeeId, targetShiftId },
    });
    await this.outbox.record('shift_request.created', { requestId: row.id });
    return this.viewOne(row, { employeeId: me.id, manager: false });
  }

  async mine(member: OrgMember): Promise<ShiftRequestView[]> {
    const me = await this.employees.findByUserId(member.userId);
    if (!me) return [];
    return this.views(await this.requests.forEmployee(me.id), {
      employeeId: me.id,
      manager: false,
    });
  }

  /** Accept, decline (the colleague) or cancel (the requester). */
  async respond(
    member: OrgMember,
    id: string,
    action: 'colleague_accept' | 'colleague_decline' | 'cancel',
  ): Promise<ShiftRequestView> {
    const me = await this.staffOf(member);
    const request = await this.requests.findById(id);
    const actor = request ? this.actorFor(request, me.id) : null;
    if (!request || !actor) throw requestNotFound();
    if (action !== 'cancel') await this.assertRequestInTime(request);

    const next = this.next(request.status, action, actor);
    const now = this.clock.now();
    const changed = await this.requests.change(id, request.status, {
      status: next,
      ...(action === 'cancel' ? {} : { respondedAt: now }),
      ...(isDecided(next) ? { decidedAt: now } : {}),
    });
    if (!changed) throw invalidTransition('Someone else acted on this request first.');

    await this.recordAction(changed, action, request.status);
    return this.viewOne(changed, { employeeId: me.id, manager: false });
  }

  // ------------------------------------------------------------------------- managers

  async inbox(query: ListShiftRequestsQuery): Promise<ShiftRequestView[]> {
    const scope = await this.access.scope();
    const rows = await this.requests.forLocations(
      scope.kind === 'all' ? null : [...scope.ids],
      query.scope,
    );
    return this.views(rows, { employeeId: null, manager: true });
  }

  async get(id: string): Promise<ShiftRequestView> {
    const { request } = await this.managed(id);
    return this.viewOne(request, { employeeId: null, manager: true });
  }

  async reject(id: string, body: DecideShiftRequest): Promise<ShiftRequestView> {
    const { request } = await this.managed(id);
    const next = this.next(request.status, 'manager_reject', 'manager');
    const changed = await this.requests.change(id, request.status, {
      status: next,
      decidedAt: this.clock.now(),
      decidedBy: this.context.userId,
      decisionNote: body.note ?? null,
    });
    if (!changed) throw invalidTransition('Someone else acted on this request first.');
    await this.recordAction(changed, 'manager_reject', request.status);
    return this.viewOne(changed, { employeeId: null, manager: true });
  }

  /**
   * Approves a swap or drop. Order matters, and every step is inside the request's transaction:
   *   1. the state machine allows it (the colleague accepted, for a swap);
   *   2. lock both shifts in id order, and check nothing moved underneath (same people, not
   *      started) — a manager may have edited the rota since the request was made;
   *   3. re-validate who takes what: blocking problems refuse, advisories need acknowledgement;
   *   4. reassign (via "open" for an exchange, so the no-double-booking constraint never sees
   *      a moment where someone holds both shifts);
   *   5. record the change as told (publication) and tell everyone (outbox).
   */
  async approve(id: string, body: DecideShiftRequest): Promise<ShiftRequestView> {
    const { request } = await this.managed(id, { writable: true });
    const next = this.next(request.status, 'manager_approve', 'manager');

    const ids = [request.shiftId, ...(request.targetShiftId ? [request.targetShiftId] : [])];
    const locked = await this.shifts.lockForUpdate(ids);
    const given = locked.find((row) => row.id === request.shiftId);
    const taken = request.targetShiftId
      ? locked.find((row) => row.id === request.targetShiftId)
      : null;
    if (!given || (request.targetShiftId && !taken)) throw requestNotFound();
    for (const shift of [given, taken]) if (shift) this.assertNotStarted(shift);
    if (given.employeeId !== request.requesterEmployeeId || given.status !== 'assigned') {
      throw invalidTransition('The shift changed since this was asked. Ask for a new request.');
    }
    if (taken && (taken.employeeId !== request.targetEmployeeId || taken.status !== 'assigned')) {
      throw invalidTransition('The shift changed since this was asked. Ask for a new request.');
    }

    if (request.type === 'swap') {
      await this.assertEligible(request, given, taken ?? null, body.acknowledgeWarnings === true);
    }

    // Who ends up on which shift.
    const moves: { shift: ShiftRecord; to: string | null }[] =
      request.type === 'drop'
        ? [{ shift: given, to: null }]
        : [
            { shift: given, to: request.targetEmployeeId },
            ...(taken ? [{ shift: taken, to: request.requesterEmployeeId }] : []),
          ];
    try {
      // An exchange frees the first shift before filling the second: never two at once.
      if (taken) await this.shifts.reassign(given.id, null);
      for (const move of [...moves].reverse()) await this.shifts.reassign(move.shift.id, move.to);
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new AppException(
          409,
          errorCodes.shiftOverlap,
          'Someone would be on two shifts at once. Refresh and check the rota.',
        );
      }
      throw error;
    }

    await this.recordTold(moves, [request.requesterEmployeeId, request.targetEmployeeId]);

    const changed = await this.requests.change(id, request.status, {
      status: next,
      decidedAt: this.clock.now(),
      decidedBy: this.context.userId,
      decisionNote: body.note ?? null,
    });
    if (!changed) throw invalidTransition('Someone else acted on this request first.');

    for (const move of moves) {
      await this.audit.record({
        action: 'shift.reassigned',
        entity: 'shift',
        entityId: move.shift.id,
        before: { employeeId: move.shift.employeeId, status: move.shift.status },
        after: { employeeId: move.to, status: move.to ? 'assigned' : 'open', requestId: id },
      });
    }
    await this.recordAction(changed, 'manager_approve', request.status);
    return this.viewOne(changed, { employeeId: null, manager: true });
  }

  // ------------------------------------------------------------------------- helpers

  /** The caller's staff profile; requests are about one's own shifts. */
  private async staffOf(member: OrgMember): Promise<EmployeeRecord> {
    const me = await this.employees.findByUserId(member.userId);
    if (!me || me.status === 'archived') {
      throw new AppException(
        403,
        errorCodes.staffProfileRequired,
        'Your login is not linked to a staff profile here.',
      );
    }
    return me;
  }

  /** The colleague for a swap: someone else, active, and able to log in to accept. */
  private async colleague(employeeId: string, myId: string): Promise<EmployeeRecord> {
    const field = (message: string): never => {
      throw new AppException(400, errorCodes.validationFailed, 'The request is invalid.', [
        { path: 'targetEmployeeId', message },
      ]);
    };
    if (employeeId === myId) field('Choose a colleague, not yourself');
    const colleague = (await this.employees.findMany([employeeId])).get(employeeId);
    if (!colleague) throw new AppException(404, errorCodes.employeeNotFound, 'No such employee.');
    if (colleague.status === 'archived') field('This colleague is archived');
    if (!colleague.userId) field('This colleague has no login yet, so cannot accept');
    return colleague;
  }

  private actorFor(request: ShiftRequestRecord, employeeId: string): ShiftRequestActor | null {
    if (request.requesterEmployeeId === employeeId) return 'requester';
    if (request.targetEmployeeId === employeeId) return 'colleague';
    return null;
  }

  private next(
    status: ShiftRequestStatus,
    action: ShiftRequestAction,
    actor: ShiftRequestActor,
  ): ShiftRequestStatus {
    const result = transition(status, action, actor);
    if (!result.ok) {
      throw invalidTransition(
        result.reason === 'closed'
          ? 'This request has already been decided.'
          : 'That is not possible for this request now.',
      );
    }
    return result.status;
  }

  /**
   * A request the caller manages: its shift (and any shift in return) is at a location in their
   * scope — otherwise it does not exist for them (404), as everywhere else.
   */
  private async managed(
    id: string,
    { writable = false } = {},
  ): Promise<{ request: ShiftRequestRecord }> {
    const request = await this.requests.findById(id);
    if (!request) throw requestNotFound();
    const shifts = await this.shifts.findByIds(
      [request.shiftId, request.targetShiftId].filter((x): x is string => x !== null),
    );
    for (const shift of shifts) {
      try {
        const location = await this.access.assertAccess(shift.locationId);
        if (writable) this.access.assertWritable(location);
      } catch (error) {
        if (error instanceof AppException && error.code === errorCodes.locationNotFound) {
          throw requestNotFound();
        }
        throw error;
      }
    }
    return { request };
  }

  private assertNotStarted(shift: ShiftRecord): void {
    if (shift.startsAt.getTime() <= this.clock.now().getTime()) {
      throw new AppException(
        409,
        errorCodes.shiftRequestExpired,
        'This shift has already started: it is too late to swap or drop it.',
      );
    }
  }

  private async assertRequestInTime(request: ShiftRequestRecord): Promise<void> {
    const shifts = await this.shifts.findByIds(
      [request.shiftId, request.targetShiftId].filter((x): x is string => x !== null),
    );
    for (const shift of shifts) this.assertNotStarted(shift);
  }

  /**
   * Only a shift staff were told about can be swapped or dropped: it is in the schedule's
   * latest publication, with this person on it. A draft is the manager's to change directly.
   */
  private async assertToldAbout(shift: ShiftRecord, employeeId: string): Promise<void> {
    const latest = await this.publications.latest(shift.scheduleId);
    const told = latest?.shifts.some(
      (entry) => entry.shiftId === shift.id && entry.employeeId === employeeId,
    );
    if (!told) {
      throw new AppException(
        409,
        errorCodes.shiftRequestNotPublished,
        'This shift has not been published yet. Ask a manager to change it directly.',
      );
    }
  }

  /**
   * Re-validates a swap at the moment of approval: the colleague takes the given shift, and the
   * requester the one in return (each without the shift they hand over).
   */
  private async assertEligible(
    request: ShiftRequestRecord,
    given: ShiftRecord,
    taken: ShiftRecord | null,
    acknowledged: boolean,
  ): Promise<void> {
    const checks: { path: string; assessment: Assessment | undefined }[] = [
      {
        path: 'colleague',
        assessment: (
          await this.shiftsService.assessMany(
            [request.targetEmployeeId!],
            given,
            taken ? [taken.id] : [],
          )
        ).get(request.targetEmployeeId!),
      },
    ];
    if (taken) {
      checks.push({
        path: 'requester',
        assessment: (
          await this.shiftsService.assessMany([request.requesterEmployeeId], taken, [given.id])
        ).get(request.requesterEmployeeId),
      });
    }

    const blocking: FieldError[] = [];
    const advisories: FieldError[] = [];
    for (const { path, assessment } of checks) {
      if (!assessment) continue;
      for (const blocker of assessment.blocking) blocking.push({ path, message: blocker.message });
      if (needsAcknowledgement(assessment)) {
        for (const warning of assessment.advisories) {
          advisories.push({ path, message: warning.message });
        }
      }
    }
    if (blocking.length > 0) {
      throw new AppException(
        409,
        errorCodes.shiftRequestNotEligible,
        'This swap cannot be approved.',
        blocking,
      );
    }
    if (advisories.length > 0 && !acknowledged) {
      throw new AppException(
        409,
        errorCodes.shiftRequestNeedsAcknowledgement,
        'This swap breaks a rule you may overrule. Approve again to confirm.',
        advisories,
      );
    }
  }

  /**
   * The approved change is now what staff were told: one schedule bump per week touched, and a
   * new publication that is the last one with these assignees replaced — so reminders follow
   * the new person, and the next publish diffs against the truth.
   */
  private async recordTold(
    moves: { shift: ShiftRecord; to: string | null }[],
    people: (string | null)[],
  ): Promise<void> {
    const affected = people.filter((p): p is string => p !== null);
    const bySchedule = new Map<string, Map<string, string | null>>();
    for (const move of moves) {
      const changes = bySchedule.get(move.shift.scheduleId) ?? new Map<string, string | null>();
      changes.set(move.shift.id, move.to);
      bySchedule.set(move.shift.scheduleId, changes);
    }
    for (const [scheduleId, changes] of bySchedule) {
      const latest = await this.publications.latest(scheduleId);
      const schedule = await this.schedules.recordToldChange(scheduleId);
      if (latest && schedule.publishedVersion) {
        await this.publications.create({
          scheduleId,
          version: schedule.publishedVersion,
          shifts: latest.shifts.map((entry) =>
            changes.has(entry.shiftId)
              ? { ...entry, employeeId: changes.get(entry.shiftId)! }
              : entry,
          ),
          affectedEmployeeIds: affected,
          publishedBy: this.context.userId,
        });
      }
      const shift = moves.find((move) => move.shift.scheduleId === scheduleId)!.shift;
      this.realtime.scheduleChanged({
        orgId: this.context.orgId,
        scheduleId,
        locationId: shift.locationId,
        weekStart: schedule.weekStart,
        kind: 'shifts',
      });
    }
  }

  private async recordAction(
    request: ShiftRequestRecord,
    action: Exclude<ShiftRequestAction, 'expire'>,
    from: ShiftRequestStatus,
  ): Promise<void> {
    await this.audit.record({
      action: TOPIC[action],
      entity: 'shift_request',
      entityId: request.id,
      before: { status: from },
      after: { status: request.status, note: request.decisionNote },
    });
    await this.outbox.record(TOPIC[action], { requestId: request.id });
  }

  // ------------------------------------------------------------------------- views

  private async viewOne(row: ShiftRequestRecord, viewer: Viewer): Promise<ShiftRequestView> {
    const [view] = await this.views([row], viewer);
    return view!;
  }

  private async views(rows: ShiftRequestRecord[], viewer: Viewer): Promise<ShiftRequestView[]> {
    if (rows.length === 0) return [];
    const shiftIds = [
      ...new Set(rows.flatMap((r) => [r.shiftId, ...(r.targetShiftId ? [r.targetShiftId] : [])])),
    ];
    const shifts = await this.shifts.findByIds(shiftIds);
    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const [locations, roles, people] = await Promise.all([
      this.locations.findByIds([...new Set(shifts.map((s) => s.locationId))]),
      this.jobRoles.list(),
      this.employees.findMany([
        ...new Set(
          rows.flatMap((r) => [
            r.requesterEmployeeId,
            ...(r.targetEmployeeId ? [r.targetEmployeeId] : []),
          ]),
        ),
      ]),
    ]);
    const locationById = new Map(locations.map((l) => [l.id, l]));
    const roleName = new Map(roles.map((r) => [r.id, r.name]));

    const summary = (id: string | null): RequestShift | null => {
      const shift = id ? shiftById.get(id) : undefined;
      const location = shift ? locationById.get(shift.locationId) : undefined;
      if (!shift || !location) return null;
      const start = toLocal(shift.startsAt, location.timezone);
      const end = toLocal(shift.endsAt, location.timezone);
      return {
        id: shift.id,
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        startsAt: shift.startsAt.toISOString(),
        locationId: location.id,
        locationName: location.name,
        jobRoleName: shift.jobRoleId ? (roleName.get(shift.jobRoleId) ?? null) : null,
      };
    };
    const person = (id: string | null) => {
      const row = id ? people.get(id) : undefined;
      return row ? { id: row.id, name: row.name } : null;
    };

    return rows.flatMap((row) => {
      const shift = summary(row.shiftId);
      const requester = person(row.requesterEmployeeId);
      if (!shift || !requester) return [];
      const actor: ShiftRequestActor | null = viewer.manager
        ? 'manager'
        : viewer.employeeId
          ? this.actorFor(row, viewer.employeeId)
          : null;
      return [
        {
          id: row.id,
          type: row.type,
          status: row.status,
          shift,
          targetShift: summary(row.targetShiftId),
          requester,
          colleague: person(row.targetEmployeeId),
          note: row.note,
          decisionNote: row.decisionNote,
          createdAt: row.createdAt.toISOString(),
          respondedAt: row.respondedAt?.toISOString() ?? null,
          decidedAt: row.decidedAt?.toISOString() ?? null,
          actions: actor ? availableActions(row.status, actor) : [],
        },
      ];
    });
  }
}

function isDecided(status: ShiftRequestStatus): boolean {
  return status !== 'pending_colleague' && status !== 'pending_manager';
}
