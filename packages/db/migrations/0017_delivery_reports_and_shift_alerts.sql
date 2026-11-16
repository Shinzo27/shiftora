-- 0017_delivery_reports_and_shift_alerts (W4 D5): provider delivery reports and the alert scan.
-- deliveries gains the provider's message id (how a webhook finds its row) and the delivered /
-- read times. shift_alerts records each reminder and missed clock-in alert once, so the
-- minute-by-minute scan never raises the same one twice.
--
-- Two read-only switches, the same shape as the outbox relay's (0011, ADR 017; see ADR 019):
--   app.alert_scan       lets the scan list organisations (it then works one org at a time);
--   app.provider_report  lets a delivery report find its delivery by provider message id.
-- Each is transaction-local, SELECT-only and one query wide.

CREATE TYPE "public"."shift_alert_kind" AS ENUM('reminder', 'missed_clock_in');--> statement-breakpoint
CREATE TABLE "shift_alerts" (
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"kind" "shift_alert_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_alerts_pk" PRIMARY KEY("org_id","shift_id","kind")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shift_alerts" ADD CONSTRAINT "shift_alerts_shift_fk" FOREIGN KEY ("org_id","shift_id") REFERENCES "public"."shifts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_provider_message_unique" ON "deliveries" USING btree ("channel","provider_message_id") WHERE provider_message_id is not null;--> statement-breakpoint

-- ===================== Row-level security (hand-written) =====================
ALTER TABLE shift_alerts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE shift_alerts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON shift_alerts
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());--> statement-breakpoint

CREATE POLICY organizations_alert_scan ON organizations
  FOR SELECT
  USING (current_setting('app.alert_scan', true) = 'on');--> statement-breakpoint

CREATE POLICY deliveries_provider_report ON deliveries
  FOR SELECT
  USING (current_setting('app.provider_report', true) = 'on');
