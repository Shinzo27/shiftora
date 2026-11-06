-- 0005_scheduling: shift templates and weekly schedules (one per location and week).
-- Generated tables first (drizzle-kit), then hand-written changes and the RLS section.
--
-- Times on templates are LOCAL wall-clock times (Postgres `time`) in the location's zone;
-- schedules store the local Monday (`date`). Converting to UTC instants needs the zone's DST
-- rules, so it happens in packages/domain/time, never in SQL.

CREATE TYPE "public"."schedule_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "schedule_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_location_week_unique" UNIQUE("location_id","week_start"),
	CONSTRAINT "schedules_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "schedules_week_starts_monday" CHECK (extract(isodow from "schedules"."week_start") = 1),
	CONSTRAINT "schedules_published_has_time" CHECK ("schedules"."status" <> 'published' or "schedules"."published_at" is not null),
	CONSTRAINT "schedules_version_positive" CHECK ("schedules"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" "citext" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"job_role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_location_name_unique" UNIQUE("location_id","name"),
	CONSTRAINT "shift_templates_times_differ" CHECK ("shift_templates"."start_time" <> "shift_templates"."end_time"),
	CONSTRAINT "shift_templates_break_range" CHECK ("shift_templates"."break_minutes" between 0 and 240)
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_location_same_org_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_location_same_org_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_job_role_same_org_fk" FOREIGN KEY ("org_id","job_role_id") REFERENCES "public"."job_roles"("org_id","id") ON DELETE SET NULL (job_role_id) ON UPDATE no action;--> statement-breakpoint
-- Hand-edited above: drizzle-kit wrote "ON DELETE set null", which on this two-column key
-- would also null org_id (NOT NULL → error). Postgres 15+ nulls only the listed column.

-- ===================== Row-level security (hand-written) =====================
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shift_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON shift_templates
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON schedules
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
