-- 0016_message_quota_and_dead_letters (W4 D4): the paid-message quota and the dead-letter list.
-- message_usage counts WhatsApp/SMS per org, month (Asia/Kolkata calendar) and channel; the
-- worker reserves with a conditional upsert before sending and gives the reservation back on a
-- failed send. deliveries.dead_lettered_at marks a delivery whose retries ran out; replays
-- counts owner replays (part of the replay job id).

CREATE TABLE "message_usage" (
	"org_id" uuid NOT NULL,
	"month" text NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_usage_pk" PRIMARY KEY("org_id","month","channel"),
	CONSTRAINT "message_usage_month_format" CHECK ("message_usage"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "message_usage_paid_channel" CHECK ("message_usage"."channel" in ('whatsapp', 'sms')),
	CONSTRAINT "message_usage_count_positive" CHECK ("message_usage"."sent_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "replays" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message_usage" ADD CONSTRAINT "message_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_dead_letter_idx" ON "deliveries" USING btree ("org_id","dead_lettered_at") WHERE dead_lettered_at is not null;--> statement-breakpoint

-- ===================== Row-level security (hand-written) =====================
ALTER TABLE message_usage ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_usage FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON message_usage
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
