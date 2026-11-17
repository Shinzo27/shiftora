import { Injectable } from '@nestjs/common';
import { and, eq, ne, schema, sql } from '@shiftora/db';
import { errorCodes } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { RequestContext } from '../../database/request-context.js';

const { payPeriods } = schema;

/**
 * "Has this already been paid?" Once a pay period is approved (or being calculated), the work in
 * it is fixed: correcting a punch in it, or starting pay rules inside it, would change what was
 * paid after the fact. A small module of its own, so attendance and pay rules can ask without
 * depending on the whole payroll module.
 */
@Injectable()
export class PayLocksService {
  constructor(private readonly context: RequestContext) {}

  /** Throws 409 if any of these local dates is inside an approved (or calculating) period. */
  async assertDatesOpen(dates: string[]): Promise<void> {
    for (const date of new Set(dates)) {
      const [locked] = await this.context.tx
        .select({ startsOn: payPeriods.startsOn, endsOn: payPeriods.endsOn })
        .from(payPeriods)
        .where(
          and(
            eq(payPeriods.orgId, this.context.orgId),
            ne(payPeriods.status, 'open'),
            sql`${date}::date between ${payPeriods.startsOn} and ${payPeriods.endsOn}`,
          ),
        )
        .limit(1);
      if (locked) {
        throw new AppException(
          409,
          errorCodes.timeEntryPeriodLocked,
          `${date} is in the approved pay period ${locked.startsOn} – ${locked.endsOn}.`,
        );
      }
    }
  }

  /** The last day already paid (the latest end of an approved or calculating period), if any. */
  async paidThrough(): Promise<string | null> {
    const [row] = await this.context.tx
      .select({ last: sql<string | null>`max(${payPeriods.endsOn})::text` })
      .from(payPeriods)
      .where(and(eq(payPeriods.orgId, this.context.orgId), ne(payPeriods.status, 'open')));
    return row?.last ?? null;
  }
}
