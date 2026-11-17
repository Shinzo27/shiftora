import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_TIME_ZONE,
  rulesInForce,
  toLocal,
  type Clock,
  type PayRulesVersion,
} from '@shiftora/domain';
import {
  errorCodes,
  type CreatePayRulesVersion,
  type PayRulesInForceView,
  type PayRulesVersionView,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { CLOCK } from '../../common/clock.js';
import { uniqueViolation } from '../../common/db-errors.js';
import { AuditService } from '../audit/audit.service.js';
import { PayRulesRepository, type PayRulesRecord } from './pay-rules.repository.js';

function toView(row: PayRulesRecord): PayRulesVersionView {
  return {
    id: row.id,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    rules: row.rules,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ? { id: row.createdBy, name: row.createdByName ?? 'Unknown' } : null,
  };
}

/**
 * Pay rules as a history of versions (W6 D1). Owners add a version from a date after the latest
 * one; nobody edits a version; only the latest one can be withdrawn, and only before it starts.
 * With no versions the organisation is on plain hourly pay (owner's decision).
 */
@Injectable()
export class PayRulesService {
  constructor(
    private readonly payRules: PayRulesRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<PayRulesVersionView[]> {
    return (await this.payRules.list()).map(toView);
  }

  /** The versions in the shape the pay engine takes, for payroll (W6 D4). */
  async versions(): Promise<PayRulesVersion[]> {
    return (await this.payRules.list()).map((row) => ({
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      rules: row.rules,
    }));
  }

  async inForce(date: string): Promise<PayRulesInForceView> {
    const versions = await this.versions();
    const version = versions
      .filter((v) => v.effectiveFrom <= date)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    return { date, version: version?.version ?? null, rules: rulesInForce(versions, date) };
  }

  async create(body: CreatePayRulesVersion): Promise<PayRulesVersionView> {
    const [latest] = await this.payRules.list();
    if (latest && body.effectiveFrom <= latest.effectiveFrom) {
      throw new AppException(
        409,
        errorCodes.payRulesNotAfterLatest,
        `A new version must start after ${latest.effectiveFrom}, when version ${latest.version} starts.`,
      );
    }

    let row;
    try {
      row = await this.payRules.create({
        version: (latest?.version ?? 0) + 1,
        effectiveFrom: body.effectiveFrom,
        rules: body.rules,
        note: body.note ?? null,
      });
    } catch (error) {
      // Two owners saving at once: the second loses the version number and tries again.
      if (uniqueViolation(error)?.startsWith('pay_rules_org_')) {
        throw new AppException(
          409,
          errorCodes.payRulesNotAfterLatest,
          'Someone saved a version at the same moment. Reload and try again.',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'pay_rules.created',
      entity: 'pay_rules',
      entityId: row.id,
      after: { version: row.version, effectiveFrom: row.effectiveFrom, rules: row.rules },
    });
    const [created] = await this.payRules.list();
    return toView(created!);
  }

  /**
   * Withdraws a version that has not started yet — a typo caught in time. A version in force (or
   * one with a later version after it) is history and stays. "Not started" is judged on the
   * billing calendar (Asia/Kolkata), like the message quota.
   */
  async withdraw(id: string): Promise<void> {
    const all = await this.payRules.list();
    const latest = all[0];
    const target = all.find((row) => row.id === id);
    if (!target) {
      throw new AppException(404, errorCodes.payRulesNotFound, 'No such pay rules version.');
    }
    const today = toLocal(this.clock.now(), BILLING_TIME_ZONE).date;
    if (target.id !== latest?.id || target.effectiveFrom <= today) {
      throw new AppException(
        409,
        errorCodes.payRulesLocked,
        'Only the latest version, before it starts, can be withdrawn. Add a new version instead.',
      );
    }
    await this.payRules.remove(id);
    await this.audit.record({
      action: 'pay_rules.withdrawn',
      entity: 'pay_rules',
      entityId: id,
      before: { version: target.version, effectiveFrom: target.effectiveFrom, rules: target.rules },
    });
  }
}
