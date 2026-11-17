import { Injectable } from '@nestjs/common';
import { and, desc, eq, schema } from '@shiftora/db';
import type { PayRules } from '@shiftora/domain';

import { RequestContext } from '../../database/request-context.js';

const { payRules, users } = schema;

export type PayRulesRecord = typeof payRules.$inferSelect & { createdByName: string | null };

@Injectable()
export class PayRulesRepository {
  constructor(private readonly context: RequestContext) {}

  /** Every version, newest first, with who wrote it. */
  async list(): Promise<PayRulesRecord[]> {
    const rows = await this.context.tx
      .select({ row: payRules, createdByName: users.name })
      .from(payRules)
      .leftJoin(users, eq(users.id, payRules.createdBy))
      .where(eq(payRules.orgId, this.context.orgId))
      .orderBy(desc(payRules.version));
    return rows.map(({ row, createdByName }) => ({ ...row, createdByName }));
  }

  async create(values: {
    version: number;
    effectiveFrom: string;
    rules: PayRules;
    note: string | null;
  }): Promise<typeof payRules.$inferSelect> {
    const [row] = await this.context.tx
      .insert(payRules)
      .values({ ...values, orgId: this.context.orgId, createdBy: this.context.userId })
      .returning();
    return row!;
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(payRules)
      .where(and(eq(payRules.orgId, this.context.orgId), eq(payRules.id, id)));
  }
}
