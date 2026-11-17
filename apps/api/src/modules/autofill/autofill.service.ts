import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, schema } from '@shiftora/db';
import {
  errorCodes,
  type AutofillRequestResult,
  type AutofillRunView,
  type UnfilledSlotView,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { LocationAccess } from '../locations/location-access.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SchedulesRepository } from '../scheduling/schedules.repository.js';

const { autofillRuns } = schema;

/**
 * Runs the auto-scheduler against a week (W7 D3).
 *
 * The request does one thing: records that a run was asked for and writes the outbox event that
 * will do it. The solving happens in the worker — a request handler must not spend two seconds
 * thinking, and must certainly not do it inside its own transaction.
 */
@Injectable()
export class AutofillService {
  constructor(
    private readonly context: RequestContext,
    private readonly schedules: SchedulesRepository,
    private readonly access: LocationAccess,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async request(scheduleId: string, userId: string): Promise<AutofillRequestResult> {
    const schedule = await this.schedules.findById(scheduleId);
    if (!schedule) {
      throw new AppException(404, errorCodes.scheduleNotFound, 'No such schedule.');
    }
    this.access.assertWritable(await this.access.assertAccess(schedule.locationId));

    // One run at a time per week. Two clicks, or two managers, would otherwise queue two solvers
    // that each write shifts; the second would find the slots taken and report a confusing
    // "nothing to do". A refusal that names the running one is more useful than a silent merge.
    const [inFlight] = await this.context.tx
      .select({ id: autofillRuns.id })
      .from(autofillRuns)
      .where(
        and(
          eq(autofillRuns.orgId, this.context.orgId),
          eq(autofillRuns.scheduleId, scheduleId),
          inArray(autofillRuns.status, ['queued', 'running']),
        ),
      )
      .limit(1);
    if (inFlight) {
      throw new AppException(
        409,
        errorCodes.autofillAlreadyRunning,
        'This week is already being filled. Wait for the run to finish.',
      );
    }

    const [run] = await this.context.tx
      .insert(autofillRuns)
      .values({
        orgId: this.context.orgId,
        scheduleId,
        status: 'queued',
        createdBy: userId,
      })
      .returning();

    await this.audit.record({
      action: 'schedule.autofill_requested',
      entity: 'schedule',
      entityId: scheduleId,
      after: { runId: run!.id },
    });

    await this.outbox.record('schedule.autofill_requested', {
      runId: run!.id,
      scheduleId,
    });

    return { runId: run!.id, status: 'queued' };
  }

  /** The latest run for the week, or null when nobody has asked yet. */
  async latest(scheduleId: string): Promise<AutofillRunView | null> {
    const schedule = await this.schedules.findById(scheduleId);
    if (!schedule) {
      throw new AppException(404, errorCodes.scheduleNotFound, 'No such schedule.');
    }
    await this.access.assertAccess(schedule.locationId);

    const [row] = await this.context.tx
      .select()
      .from(autofillRuns)
      .where(
        and(eq(autofillRuns.orgId, this.context.orgId), eq(autofillRuns.scheduleId, scheduleId)),
      )
      .orderBy(desc(autofillRuns.createdAt))
      .limit(1);
    return row ? present(row) : null;
  }
}

function present(row: typeof autofillRuns.$inferSelect): AutofillRunView {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    status: row.status as AutofillRunView['status'],
    strategy: row.strategy,
    assigned: row.assigned,
    unfilled: (row.unfilled as UnfilledSlotView[] | null) ?? [],
    score: (row.score as AutofillRunView['score']) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}
