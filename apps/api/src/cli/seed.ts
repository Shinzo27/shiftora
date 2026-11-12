/**
 * The demo clinic, in one command.
 *
 * `pnpm db:seed` builds a small but real tenant — two branches, a team with logins, a published
 * week of shifts and a handful of punches (including one outside the fence and one late) — so a
 * new checkout can be looked at without clicking through signup, and so a walkthrough has
 * something to show. It is a **fixture**: rows are inserted directly, inside one transaction with
 * the org context set, which is the one place in this repo where that is the right thing to do.
 *
 * Idempotent by deletion: the demo org (and its users) are removed first, so running it twice
 * leaves one clinic, not two.
 */
import * as argon2 from '@node-rs/argon2';
import {
  createDatabaseConnection,
  newId,
  schema,
  setTenantContext,
  sql,
  type Transaction,
} from '@shiftora/db';

const DEMO_EMAILS = [
  'priya@sunriseclinic.test',
  'asha@sunriseclinic.test',
  'rohan@sunriseclinic.test',
  'meera@sunriseclinic.test',
];

const DEMO_ORG = 'Sunrise Clinic';

/** The same argon2id parameters the API uses, so a seeded login behaves like a signed-up one. */
const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const DEMO_PASSWORD = 'demo-clinic-2026';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is not set (see .env.example).');
    process.exit(1);
  }

  // Not destructured: `close` is a method, and the linter refuses an unbound reference.
  const connection = createDatabaseConnection(url);
  const db = connection.db;
  // Called through the namespace: a bare import of `hash` is an unbound method to the linter.
  const password = await argon2.hash(DEMO_PASSWORD, HASH_OPTIONS);

  try {
    await db.transaction(async (tx) => {
      // ---- start from nothing -------------------------------------------------------------
      const existing = await tx.execute<{ id: string; owner_id: string }>(
        sql`select id from organizations where name = ${DEMO_ORG}`,
      );
      for (const org of existing.rows) {
        // Cascades take memberships, locations, employees, schedules, shifts and punches.
        await tx.execute(sql`delete from organizations where id = ${org.id}`);
      }
      await tx.execute(sql`delete from users where email = any(${sql.raw(pgArray(DEMO_EMAILS))})`);

      // ---- people -------------------------------------------------------------------------
      const priya = await user(tx, 'priya@sunriseclinic.test', 'Priya Nair', password);
      const asha = await user(tx, 'asha@sunriseclinic.test', 'Asha Mehta', password);
      const rohan = await user(tx, 'rohan@sunriseclinic.test', 'Rohan Desai', password);
      const meera = await user(tx, 'meera@sunriseclinic.test', 'Meera Iyer', password);

      // RLS only accepts rows for the org the transaction points at, so mint the id, point the
      // transaction at it, and only then insert — exactly what `OrgsService.create` does.
      const orgId = newId();
      await setTenantContext(tx, { userId: priya, orgId });
      const [org] = await tx
        .insert(schema.organizations)
        .values({
          id: orgId,
          name: DEMO_ORG,
          geofencePolicy: 'flag',
          attendanceGraceMinutes: 5,
        })
        .returning();
      if (!org) throw new Error('org insert returned nothing');

      await tx.insert(schema.memberships).values([
        { orgId: org.id, userId: priya, role: 'owner' },
        { orgId: org.id, userId: asha, role: 'employee' },
        { orgId: org.id, userId: rohan, role: 'manager' },
        { orgId: org.id, userId: meera, role: 'employee' },
      ]);

      // ---- branches -----------------------------------------------------------------------
      const [andheri, bandra] = await tx
        .insert(schema.locations)
        .values([
          {
            orgId: org.id,
            name: 'Andheri',
            address: '3rd floor, Crystal Plaza, Andheri West, Mumbai',
            latitude: 19.1197,
            longitude: 72.8468,
            radiusM: 120,
            timezone: 'Asia/Kolkata',
          },
          {
            orgId: org.id,
            name: 'Bandra',
            address: '12 Hill Road, Bandra West, Mumbai',
            latitude: 19.0607,
            longitude: 72.8362,
            radiusM: 100,
            timezone: 'Asia/Kolkata',
          },
        ])
        .returning();
      if (!andheri || !bandra) throw new Error('location insert returned nothing');

      await tx.insert(schema.membershipLocations).values([
        { orgId: org.id, userId: priya, locationId: andheri.id },
        { orgId: org.id, userId: priya, locationId: bandra.id },
        { orgId: org.id, userId: rohan, locationId: andheri.id },
      ]);

      // ---- roles and the team -------------------------------------------------------------
      const roles = await tx
        .insert(schema.jobRoles)
        .values(['Doctor', 'Nurse', 'Reception'].map((name) => ({ orgId: org.id, name })))
        .returning();
      const roleId = new Map(roles.map((role) => [role.name, role.id]));

      const [ashaStaff, rohanStaff, meeraStaff] = await tx
        .insert(schema.employees)
        .values([
          {
            orgId: org.id,
            userId: asha,
            name: 'Asha Mehta',
            email: 'asha@sunriseclinic.test',
            phone: '+919820000001',
            hourlyRateMinor: 45_000,
            notifyChannel: 'whatsapp',
            maxWeeklyMinutes: 2_400,
          },
          {
            orgId: org.id,
            userId: rohan,
            name: 'Rohan Desai',
            email: 'rohan@sunriseclinic.test',
            phone: '+919820000002',
            hourlyRateMinor: 90_000,
            notifyChannel: 'whatsapp',
          },
          {
            orgId: org.id,
            userId: meera,
            name: 'Meera Iyer',
            email: 'meera@sunriseclinic.test',
            phone: '+919820000003',
            hourlyRateMinor: 55_000,
            notifyChannel: 'email',
          },
        ])
        .returning();
      if (!ashaStaff || !rohanStaff || !meeraStaff) throw new Error('employee insert failed');

      await tx.insert(schema.employeeJobRoles).values([
        { orgId: org.id, employeeId: ashaStaff.id, jobRoleId: roleFor(roleId, 'Nurse') },
        { orgId: org.id, employeeId: rohanStaff.id, jobRoleId: roleFor(roleId, 'Doctor') },
        { orgId: org.id, employeeId: meeraStaff.id, jobRoleId: roleFor(roleId, 'Reception') },
      ]);
      await tx.insert(schema.employeeLocations).values([
        { orgId: org.id, employeeId: ashaStaff.id, locationId: andheri.id },
        { orgId: org.id, employeeId: rohanStaff.id, locationId: andheri.id },
        { orgId: org.id, employeeId: rohanStaff.id, locationId: bandra.id },
        { orgId: org.id, employeeId: meeraStaff.id, locationId: bandra.id },
      ]);

      // Asha works mornings, Meera is the one who said yes to weekends.
      await tx.insert(schema.availability).values([
        ...[1, 2, 3, 4, 5].map((weekday) => ({
          orgId: org.id,
          employeeId: ashaStaff.id,
          weekday,
          startLocal: '08:00',
          endLocal: '16:00',
        })),
        ...[1, 2, 3, 4, 5, 6].map((weekday) => ({
          orgId: org.id,
          employeeId: meeraStaff.id,
          weekday,
          startLocal: '09:00',
          endLocal: '18:00',
        })),
      ]);

      // ---- this week's rota, published ----------------------------------------------------
      const weekStart = mondayOf(todayInClinic());
      const [schedule] = await tx
        .insert(schema.schedules)
        .values({
          orgId: org.id,
          locationId: andheri.id,
          weekStart,
          status: 'published',
          publishedAt: new Date(),
          publishedBy: priya,
        })
        .returning();
      if (!schedule) throw new Error('schedule insert failed');

      const shifts: (typeof schema.shifts.$inferInsert)[] = [];
      for (const [offset, employeeId, start, end, roleName] of [
        [0, ashaStaff.id, '08:00', '16:00', 'Nurse'],
        [1, ashaStaff.id, '08:00', '16:00', 'Nurse'],
        [2, ashaStaff.id, '08:00', '16:00', 'Nurse'],
        [3, ashaStaff.id, '08:00', '16:00', 'Nurse'],
        [4, ashaStaff.id, '08:00', '16:00', 'Nurse'],
        [0, rohanStaff.id, '10:00', '18:00', 'Doctor'],
        [2, rohanStaff.id, '10:00', '18:00', 'Doctor'],
        [4, rohanStaff.id, '10:00', '18:00', 'Doctor'],
      ] as const) {
        shifts.push({
          orgId: org.id,
          scheduleId: schedule.id,
          locationId: andheri.id,
          jobRoleId: roleFor(roleId, roleName),
          employeeId,
          startsAt: localInstant(addDays(weekStart, offset), start),
          endsAt: localInstant(addDays(weekStart, offset), end),
          breakMinutes: 30,
          status: 'assigned',
        });
      }
      const created = await tx.insert(schema.shifts).values(shifts).returning();
      await tx
        .update(schema.schedules)
        .set({ version: 2, publishedVersion: 2 })
        .where(sql`id = ${schedule.id}`);

      // ---- what actually happened on the Monday of that week ------------------------------
      const today = weekStart;
      const ashaShift = created.find((shift) => shift.employeeId === ashaStaff.id);
      const rohanShift = created.find((shift) => shift.employeeId === rohanStaff.id);

      await tx.insert(schema.timeEntries).values([
        // On time, inside the fence.
        ...(ashaShift
          ? [
              {
                orgId: org.id,
                employeeId: ashaStaff.id,
                locationId: andheri.id,
                shiftId: ashaShift.id,
                clockInAt: localInstant(today, '07:58'),
                clockOutAt: localInstant(today, '16:03'),
                method: 'gps' as const,
                inLatitude: 19.1195,
                inLongitude: 72.847,
                inAccuracyM: 9,
                inDistanceM: 24,
                outLatitude: 19.1196,
                outLongitude: 72.8466,
                outAccuracyM: 12,
                outDistanceM: 19,
                deviceTime: localInstant(today, '07:58'),
                flags: [],
              },
            ]
          : []),
        // Late by 27 minutes, but at the branch.
        ...(rohanShift
          ? [
              {
                orgId: org.id,
                employeeId: rohanStaff.id,
                locationId: andheri.id,
                shiftId: rohanShift.id,
                clockInAt: localInstant(today, '10:27'),
                method: 'gps' as const,
                inLatitude: 19.1198,
                inLongitude: 72.8469,
                inAccuracyM: 14,
                inDistanceM: 12,
                deviceTime: localInstant(today, '10:27'),
                flags: [],
              },
            ]
          : []),
        // Flagged: 340 m from the branch, and a fix bad enough to say so.
        {
          orgId: org.id,
          employeeId: meeraStaff.id,
          locationId: bandra.id,
          clockInAt: localInstant(today, '09:04'),
          clockOutAt: localInstant(today, '17:00'),
          method: 'gps' as const,
          inLatitude: 19.0637,
          inLongitude: 72.8362,
          inAccuracyM: 380,
          inDistanceM: 334,
          deviceTime: localInstant(today, '09:04'),
          flags: ['outside_geofence', 'low_accuracy'],
        },
      ]);

      console.log(`Seeded ${DEMO_ORG}: 2 branches, 3 staff, 1 published week (from ${weekStart}).`);
      console.log(`Sign in as ${DEMO_EMAILS[0]} / ${DEMO_PASSWORD}`);
      console.log(`Staff ${DEMO_EMAILS[1]} and ${DEMO_EMAILS[2]} can clock in.`);
    });
  } finally {
    await connection.close();
  }
}

async function user(tx: Transaction, email: string, name: string, passwordHash: string) {
  const [row] = await tx
    .insert(schema.users)
    .values({ email, name, passwordHash, emailVerifiedAt: new Date() })
    .returning();
  if (!row) throw new Error(`user insert failed for ${email}`);
  return row.id;
}

function roleFor(roleId: Map<string, string>, name: string): string {
  const id = roleId.get(name);
  if (!id) throw new Error(`unknown role ${name}`);
  return id;
}

/** The clinic's today, so the demo always has this week in it. */
function todayInClinic(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Monday of the week containing a date: the plan's weeks start on Monday. */
function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = value.getUTCDay() === 0 ? 7 : value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (weekday - 1));
  return value.toISOString().slice(0, 10);
}

/** `2026-11-09` + `08:00` at the clinic's zone (Asia/Kolkata, no DST to worry about). */
function localInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function pgArray(values: string[]): string {
  return `array[${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(',')}]::citext[]`;
}

await main();
