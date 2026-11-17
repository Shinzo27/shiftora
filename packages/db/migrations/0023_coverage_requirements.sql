CREATE TABLE "coverage_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"job_role_id" uuid,
	"start_local" time NOT NULL,
	"end_local" time NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_requirements_weekday_range" CHECK ("coverage_requirements"."weekday" between 1 and 7),
	CONSTRAINT "coverage_requirements_headcount_range" CHECK ("coverage_requirements"."headcount" between 1 and 20),
	CONSTRAINT "coverage_requirements_times_differ" CHECK ("coverage_requirements"."start_local" <> "coverage_requirements"."end_local")
);
--> statement-breakpoint
ALTER TABLE "coverage_requirements" ADD CONSTRAINT "coverage_requirements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requirements" ADD CONSTRAINT "coverage_requirements_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requirements" ADD CONSTRAINT "coverage_requirements_role_fk" FOREIGN KEY ("org_id","job_role_id") REFERENCES "public"."job_roles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_requirements_unique" ON "coverage_requirements" USING btree ("org_id","location_id","weekday","start_local","job_role_id");--> statement-breakpoint
ALTER TABLE coverage_requirements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE coverage_requirements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON coverage_requirements
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
