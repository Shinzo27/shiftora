-- 0022_payroll (W6 D4): pay periods (dates a manager picks, ≤ 31 days, never overlapping within
-- an organisation) and the lines an approved period pays (written by the worker from computePay).

CREATE TYPE "public"."pay_period_status" AS ENUM('open', 'calculating', 'approved');--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "pay_period_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"calculated_at" timestamp with time zone,
	"employees" integer,
	"paid_minutes" integer,
	"amount_minor" integer,
	CONSTRAINT "pay_periods_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "pay_periods_dates_ordered" CHECK ("pay_periods"."ends_on" >= "pay_periods"."starts_on"),
	CONSTRAINT "pay_periods_at_most_31_days" CHECK ("pay_periods"."ends_on" - "pay_periods"."starts_on" < 31),
	CONSTRAINT "pay_periods_approved_has_approver" CHECK ("pay_periods"."status" = 'open' or "pay_periods"."approved_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "timesheet_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"pay_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"night" boolean NOT NULL,
	"minutes" integer NOT NULL,
	"multiplier_bp" integer NOT NULL,
	"rate_minor" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "timesheet_lines_category" CHECK ("timesheet_lines"."category" in ('regular', 'overtime')),
	CONSTRAINT "timesheet_lines_minutes_positive" CHECK ("timesheet_lines"."minutes" > 0),
	CONSTRAINT "timesheet_lines_multiplier" CHECK ("timesheet_lines"."multiplier_bp" >= 10000),
	CONSTRAINT "timesheet_lines_money" CHECK ("timesheet_lines"."rate_minor" >= 0 and "timesheet_lines"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_period_fk" FOREIGN KEY ("org_id","pay_period_id") REFERENCES "public"."pay_periods"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_periods_org_dates_idx" ON "pay_periods" USING btree ("org_id","starts_on");--> statement-breakpoint
CREATE INDEX "timesheet_lines_period_employee_idx" ON "timesheet_lines" USING btree ("pay_period_id","employee_id","date");--> statement-breakpoint

-- ===================== Hand-written: no overlap, and row-level security =====================
-- Two periods of one organisation can never share a day: the database refuses it, so two
-- managers creating periods at once cannot both win (same technique as shifts, 0006).
ALTER TABLE pay_periods ADD CONSTRAINT pay_periods_no_overlap
  EXCLUDE USING gist (org_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&);--> statement-breakpoint

ALTER TABLE pay_periods ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE pay_periods FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON pay_periods
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());--> statement-breakpoint

ALTER TABLE timesheet_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE timesheet_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON timesheet_lines
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
