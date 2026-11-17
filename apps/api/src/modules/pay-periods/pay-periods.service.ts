import { Injectable } from '@nestjs/common';
import {
  errorCodes,
  type CreatePayPeriod,
  type PayPeriodView,
  type PayrollEmployee,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { isExclusionViolation } from '../../common/db-errors.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PayPeriodsRepository, type PayPeriodRecord } from './pay-periods.repository.js';

const notFound = () => new AppException(404, errorCodes.payPeriodNotFound, 'No such pay period.');

/**
 * Pay periods and their approval (W6 D4). Owner's rules: a period is dates a manager picks;
 * approval is refused while any punch in it is open or flagged-and-unreviewed; disputed punches
 * are left out of pay; only an owner approves.
 *
 * Approving records the decision and hands the work to the worker (`pay_period.approved` in the
 * outbox): the period is `calculating` until the lines are written, then `approved`.
 */
@Injectable()
export class PayPeriodsService {
  constructor(
    private readonly periods: PayPeriodsRepository,
    private readonly attendance: AttendanceService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async create(body: CreatePayPeriod): Promise<PayPeriodView> {
    let row: PayPeriodRecord;
    try {
      row = await this.periods.create(body.startsOn, body.endsOn);
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new AppException(
          409,
          errorCodes.payPeriodOverlap,
          'This overlaps another pay period: two periods cannot share a day.',
        );
      }
      throw error;
    }
    await this.audit.record({
      action: 'pay_period.created',
      entity: 'pay_period',
      entityId: row.id,
      after: { startsOn: row.startsOn, endsOn: row.endsOn },
    });
    return this.view(row);
  }

  async list(): Promise<PayPeriodView[]> {
    const rows = await this.periods.list();
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async get(id: string): Promise<PayPeriodView> {
    const row = await this.periods.findById(id);
    if (!row) throw notFound();
    return this.view(row);
  }

  async approve(id: string): Promise<PayPeriodView> {
    const row = await this.periods.findById(id);
    if (!row) throw notFound();
    if (row.status !== 'open') {
      throw new AppException(409, errorCodes.payPeriodNotOpen, 'This period is already approved.');
    }

    const readiness = await this.attendance.periodReadiness(row.startsOn, row.endsOn);
    const blockers = [
      ...(readiness.openPunches > 0
        ? [{ path: 'openPunches', message: `${readiness.openPunches} punch(es) still open` }]
        : []),
      ...(readiness.unreviewedFlags > 0
        ? [
            {
              path: 'unreviewedFlags',
              message: `${readiness.unreviewedFlags} flagged punch(es) not reviewed`,
            },
          ]
        : []),
    ];
    if (blockers.length > 0) {
      throw new AppException(
        409,
        errorCodes.payPeriodNotReady,
        'Review the period first: close the open punches and review the flagged ones.',
        blockers,
      );
    }

    const approved = await this.periods.markApproved(id);
    if (!approved) {
      throw new AppException(409, errorCodes.payPeriodNotOpen, 'This period is already approved.');
    }
    await this.audit.record({
      action: 'pay_period.approved',
      entity: 'pay_period',
      entityId: id,
      before: { status: 'open' },
      after: { status: 'calculating', disputedLeftOut: readiness.disputed },
    });
    await this.outbox.record('pay_period.approved', { payPeriodId: id });
    return this.view(approved);
  }

  /** An open period can be deleted (a wrong date range); an approved one is history. */
  async remove(id: string): Promise<void> {
    const row = await this.periods.findById(id);
    if (!row) throw notFound();
    if (row.status !== 'open') {
      throw new AppException(409, errorCodes.payPeriodNotOpen, 'An approved period stays.');
    }
    await this.periods.remove(id);
    await this.audit.record({
      action: 'pay_period.deleted',
      entity: 'pay_period',
      entityId: id,
      before: { startsOn: row.startsOn, endsOn: row.endsOn },
    });
  }

  /** Each person's pay for an approved period: totals and the lines behind them. */
  async payroll(id: string): Promise<PayrollEmployee[]> {
    const row = await this.periods.findById(id);
    if (!row) throw notFound();
    if (row.status !== 'approved') {
      throw new AppException(
        409,
        errorCodes.payPeriodNotCalculated,
        row.status === 'open'
          ? 'Approve the period first.'
          : 'Still calculating: the lines arrive in a few seconds.',
      );
    }
    const byEmployee = new Map<string, PayrollEmployee>();
    for (const { line, name } of await this.periods.lines(id)) {
      const person = byEmployee.get(line.employeeId) ?? {
        employeeId: line.employeeId,
        name,
        rateMinor: line.rateMinor,
        currency: line.currency,
        regularMinutes: 0,
        overtimeMinutes: 0,
        nightMinutes: 0,
        amountMinor: 0,
        lines: [],
      };
      if (line.category === 'overtime') person.overtimeMinutes += line.minutes;
      else person.regularMinutes += line.minutes;
      if (line.night) person.nightMinutes += line.minutes;
      person.amountMinor += line.amountMinor;
      person.lines.push({
        date: line.date,
        category: line.category as 'regular' | 'overtime',
        night: line.night,
        minutes: line.minutes,
        multiplierBp: line.multiplierBp,
        amountMinor: line.amountMinor,
      });
      byEmployee.set(line.employeeId, person);
    }
    return [...byEmployee.values()];
  }

  private async view(row: PayPeriodRecord): Promise<PayPeriodView> {
    return {
      id: row.id,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      calculatedAt: row.calculatedAt?.toISOString() ?? null,
      totals:
        row.status === 'approved'
          ? {
              employees: row.employees ?? 0,
              paidMinutes: row.paidMinutes ?? 0,
              amountMinor: row.amountMinor ?? 0,
            }
          : null,
      readiness:
        row.status === 'open'
          ? await this.attendance.periodReadiness(row.startsOn, row.endsOn)
          : null,
    };
  }
}
