CREATE TYPE "public"."delivery_channel" AS ENUM('email', 'whatsapp', 'sms', 'push');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"outbox_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"address" text,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The unique keys the composite foreign keys below need must exist BEFORE them (AGENTS.md:
-- drizzle-kit otherwise emits a constraint before its target, and Postgres refuses the file).
CREATE UNIQUE INDEX "notifications_org_id_id_unique" ON "notifications" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_outbox_employee_unique" ON "notifications" USING btree ("outbox_id","employee_id");--> statement-breakpoint
CREATE INDEX "notifications_employee_idx" ON "notifications" USING btree ("org_id","employee_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_notification_fk" FOREIGN KEY ("org_id","notification_id") REFERENCES "public"."notifications"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_notification_channel_unique" ON "deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "deliveries_status_idx" ON "deliveries" USING btree ("org_id","status");--> statement-breakpoint
-- The sender finds what is still unsent; partial, so it stays small as history grows.
CREATE INDEX "deliveries_pending_idx" ON "deliveries" ("org_id", "created_at")
  WHERE "status" = 'queued';--> statement-breakpoint
-- Tenant tables, like every other: the worker sets one org's context per job before touching
-- them, so a fan-out bug cannot reach another clinic's staff.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON notifications
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());--> statement-breakpoint
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON deliveries
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
