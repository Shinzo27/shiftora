-- Drizzle generated this from the schema diff. Three adjustments by hand: the drops and the add
-- are tolerant, and the two constraints are wrapped, because 0012 was hand-written (RLS and
-- constraint order) and the snapshot it left behind is a step ahead of the SQL that ran.
-- Everything here is idempotent, so it is safe on a database built either way.
ALTER TABLE "deliveries" DROP CONSTRAINT IF EXISTS "deliveries_employee_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "deliveries_notification_employee_channel_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "notifications_outbox_unique";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_email" text;--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "employee_id";--> statement-breakpoint
-- An invite goes to an address that has no staff row yet, so the recipient is nullable.
ALTER TABLE "notifications" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employee_fk"
    FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_notification_channel_unique" ON "deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_outbox_employee_unique" ON "notifications" USING btree ("outbox_id","employee_id");--> statement-breakpoint
-- Replaying an invite cannot email the same address twice.
DROP INDEX IF EXISTS "notifications_outbox_email_unique";--> statement-breakpoint
-- Plain, not partial: NULLs are distinct in Postgres so staff rows never collide, and ON CONFLICT
-- can infer a full unique index but not a partial one (the fan-out relies on that).
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_outbox_email_unique" ON "notifications" USING btree ("outbox_id","recipient_email");--> statement-breakpoint
-- A notification nobody is addressed to is a message into the void.
DO $$
BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_present"
    CHECK (employee_id is not null or recipient_email is not null);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
