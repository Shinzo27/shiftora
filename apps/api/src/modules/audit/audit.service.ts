import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, schema, sql } from '@shiftora/db';
import { errorCodes, type AuditPage, type AuditQuery } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { RequestContext } from '../../database/request-context.js';

/**
 * A page boundary: the last row's `created_at` **as Postgres prints it** (microseconds — a JS
 * Date would round them away and skip or repeat rows that share a millisecond) and its id.
 */
function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

const badCursor = () =>
  new AppException(400, errorCodes.validationFailed, 'That page link is no longer valid.');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `timestamptz::text`, e.g. "2026-11-18 09:30:00.123456+00" (or "+05:30" in another zone). */
const PG_TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

function decodeCursor(cursor: string): [string, string] {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badCursor();
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string' ||
    !PG_TIMESTAMPTZ.test(value[0]) ||
    !UUID.test(value[1])
  ) {
    throw badCursor();
  }
  return [value[0], value[1]];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export interface AuditEntry {
  /** What happened, as `entity.past_tense`, e.g. "membership.role_changed". */
  action: string;
  entity: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Records who changed what, in the SAME transaction as the change (via RequestContext):
 * if the change rolls back, so does its audit entry, and vice versa.
 */
@Injectable()
export class AuditService {
  constructor(private readonly context: RequestContext) {}

  /**
   * The trail for one row, oldest first. The attendance timesheet shows it next to a corrected
   * punch, which is the only place a manager can see what changed without opening the log.
   */
  async history(
    entity: string,
    entityId: string,
  ): Promise<{ at: string; by: string | null; action: string; before: unknown; after: unknown }[]> {
    const rows = await this.context.tx
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.orgId, this.context.orgId),
          eq(schema.auditEvents.entity, entity),
          eq(schema.auditEvents.entityId, entityId),
        ),
      )
      .orderBy(asc(schema.auditEvents.createdAt));
    return rows.map((row) => ({
      at: row.createdAt.toISOString(),
      by: row.actorUserId,
      action: row.action,
      before: row.before,
      after: row.after,
    }));
  }

  /**
   * The owner's log (W7 D4): newest first, filtered, a page at a time. A date range lets Postgres
   * read only the months it covers (the table is partitioned by month); `(org_id, created_at)`
   * is indexed in every partition.
   */
  async list(query: AuditQuery): Promise<AuditPage> {
    const t = schema.auditEvents;
    const where = [eq(t.orgId, this.context.orgId)];
    if (query.entity) where.push(eq(t.entity, query.entity));
    if (query.entityId) where.push(eq(t.entityId, query.entityId));
    if (query.actorUserId) where.push(eq(t.actorUserId, query.actorUserId));
    if (query.from) where.push(gte(t.createdAt, new Date(query.from)));
    if (query.to) where.push(lt(t.createdAt, new Date(query.to)));
    if (query.cursor) {
      const [at, id] = decodeCursor(query.cursor);
      where.push(sql`(${t.createdAt}, ${t.id}) < (${at}::timestamptz, ${id}::uuid)`);
    }

    const rows = await this.context.tx
      .select({
        id: t.id,
        createdAt: t.createdAt,
        position: sql<string>`${t.createdAt}::text`,
        action: t.action,
        entity: t.entity,
        entityId: t.entityId,
        before: t.before,
        after: t.after,
        actorUserId: t.actorUserId,
        actorName: schema.users.name,
      })
      .from(t)
      // users is a platform table (no RLS); only the names of people who acted here are read.
      .leftJoin(schema.users, eq(schema.users.id, t.actorUserId))
      .where(and(...where))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        actor: row.actorUserId
          ? { userId: row.actorUserId, name: row.actorName ?? 'Former user' }
          : null,
        before: asRecord(row.before),
        after: asRecord(row.after),
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.position, last.id) : null,
    };
  }

  async record(entry: AuditEntry): Promise<void> {
    await this.context.tx.insert(schema.auditEvents).values({
      orgId: this.context.orgId,
      actorUserId: this.context.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  }
}
