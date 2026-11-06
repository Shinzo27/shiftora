import { foreignKey, pgTable, unique, uuid } from 'drizzle-orm/pg-core';

import { citext, id, timestamps } from './columns.js';
import { locations } from './locations.js';

/** A team within one location, e.g. "Front desk", "OPD". Tenant table (RLS). */
export const departments = pgTable(
  'departments',
  {
    id: id(),
    orgId: uuid().notNull(),
    locationId: uuid().notNull(),
    name: citext().notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'departments_location_same_org_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('cascade'),
    unique('departments_location_name_unique').on(t.locationId, t.name),
  ],
);

export type DepartmentRow = typeof departments.$inferSelect;
