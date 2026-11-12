-- 0009_attendance_grace: the tenant's early/late tolerance, in minutes.
--
-- A punch that lands within the grace of the shift start counts as on time; beyond it the
-- difference is reported to the manager (never blocked — the punch has already happened).
--
-- Hand-edited: drizzle-kit also wanted to drop and re-create `time_entries_shift_fk` and
-- `shifts_org_id_id_location_unique`, because the schema file can only express plain `SET NULL`
-- while 0008 wrote `ON DELETE SET NULL (shift_id)` and added the three-column unique by hand.
-- Both are already correct in the database; re-creating them would be churn at best and a
-- duplicate-constraint error at worst (AGENTS.md: review every generate).
ALTER TABLE "organizations" ADD COLUMN "attendance_grace_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_grace_range" CHECK ("organizations"."attendance_grace_minutes" >= 0 and "organizations"."attendance_grace_minutes" <= 60);
