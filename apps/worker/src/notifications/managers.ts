import { sql, type Transaction } from '@shiftora/db';

/**
 * Owners, and managers whose scope includes this location (no `membership_locations` rows means
 * "every location", the same rule as `LocationAccess` in the API).
 */
export async function managersOf(
  tx: Transaction,
  orgId: string,
  locationId: string,
): Promise<{ name: string; email: string }[]> {
  const rows = await tx.execute<{ name: string; email: string }>(sql`
    select u.name, u.email
    from memberships m
    join users u on u.id = m.user_id
    where m.org_id = ${orgId}
      and (
        m.role = 'owner'
        or (
          m.role = 'manager'
          and (
            not exists (
              select 1 from membership_locations ml
              where ml.org_id = m.org_id and ml.user_id = m.user_id
            )
            or exists (
              select 1 from membership_locations ml
              where ml.org_id = m.org_id and ml.user_id = m.user_id and ml.location_id = ${locationId}
            )
          )
        )
      )
    order by u.name`);
  return rows.rows;
}
