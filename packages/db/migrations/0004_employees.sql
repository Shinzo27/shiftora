-- 0004_employees: employees, their job roles and locations, weekly availability, time off.
-- Generated tables first (drizzle-kit), then the hand-written RLS section.
-- Every child table references (org_id, employee_id) → employees (org_id, id), and
-- (org_id, job_role_id/location_id) likewise, so no row can mix two orgs (see 0003).

CREATE TYPE "public"."employee_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('email', 'whatsapp', 'sms', 'push');--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_local" time NOT NULL,
	"end_local" time NOT NULL,
	CONSTRAINT "availability_weekday_range" CHECK ("availability"."weekday" between 1 and 7),
	CONSTRAINT "availability_not_empty" CHECK ("availability"."start_local" <> "availability"."end_local")
);
--> statement-breakpoint
CREATE TABLE "employee_job_roles" (
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"job_role_id" uuid NOT NULL,
	CONSTRAINT "employee_job_roles_org_id_employee_id_job_role_id_pk" PRIMARY KEY("org_id","employee_id","job_role_id")
);
--> statement-breakpoint
CREATE TABLE "employee_locations" (
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	CONSTRAINT "employee_locations_org_id_employee_id_location_id_pk" PRIMARY KEY("org_id","employee_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" "citext",
	"phone" text,
	"hourly_rate_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"max_weekly_minutes" integer,
	"min_rest_minutes" integer,
	"notify_channel" "notify_channel" DEFAULT 'email' NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "employees_rate_non_negative" CHECK ("employees"."hourly_rate_minor" >= 0),
	CONSTRAINT "employees_max_weekly_range" CHECK ("employees"."max_weekly_minutes" between 0 and 10080),
	CONSTRAINT "employees_min_rest_range" CHECK ("employees"."min_rest_minutes" between 0 and 2880)
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_positive" CHECK ("time_off"."ends_at" > "time_off"."starts_at")
);
--> statement-breakpoint
-- Moved up by hand: the foreign key employee_job_roles → job_roles (org_id, id) below
-- needs this unique constraint to exist first (drizzle-kit emitted it after the FK).
ALTER TABLE "job_roles" ADD CONSTRAINT "job_roles_org_id_id_unique" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_roles" ADD CONSTRAINT "employee_job_roles_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_roles" ADD CONSTRAINT "employee_job_roles_job_role_fk" FOREIGN KEY ("org_id","job_role_id") REFERENCES "public"."job_roles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_email_unique" ON "employees" USING btree ("org_id","email") WHERE "employees"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_user_unique" ON "employees" USING btree ("org_id","user_id") WHERE "employees"."user_id" is not null;--> statement-breakpoint
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employees
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
ALTER TABLE employee_job_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_job_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee_job_roles
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
ALTER TABLE employee_locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_locations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee_locations
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE availability FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON availability
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
ALTER TABLE time_off ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE time_off FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON time_off
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
