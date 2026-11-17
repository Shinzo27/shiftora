CREATE TABLE "autofill_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"strategy" text,
	"assigned" integer DEFAULT 0 NOT NULL,
	"unfilled" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "autofill_runs_status_check" CHECK ("autofill_runs"."status" in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "autofill_runs" ADD CONSTRAINT "autofill_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE autofill_runs ADD CONSTRAINT autofill_runs_schedule_fk
  FOREIGN KEY (org_id, schedule_id) REFERENCES schedules (org_id, id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX autofill_runs_schedule_idx ON autofill_runs (org_id, schedule_id, created_at DESC);--> statement-breakpoint
ALTER TABLE autofill_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE autofill_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON autofill_runs
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
