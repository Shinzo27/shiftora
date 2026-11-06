-- 0003_locations: locations, departments, job roles, and which locations a member may use.
-- Generated tables first (drizzle-kit), then the hand-written security section below.
--
-- Same-org foreign keys: Postgres checks foreign keys WITHOUT applying RLS. A plain
-- departments.location_id → locations.id key would let someone in org A attach a row to
-- org B's location just by knowing its id. So child tables reference the PAIR
-- (org_id, location_id) → locations (org_id, id): the referenced location must belong to
-- the same org as the row, and RLS already forces that org to be the caller's.

CREATE TYPE "public"."location_status" AS ENUM('active', 'read_only');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" "citext" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_location_name_unique" UNIQUE("location_id","name")
);
--> statement-breakpoint
CREATE TABLE "job_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" "citext" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_roles_org_name_unique" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" "citext" NOT NULL,
	"address" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"timezone" text NOT NULL,
	"status" "location_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_org_name_unique" UNIQUE("org_id","name"),
	CONSTRAINT "locations_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "locations_latitude_range" CHECK ("locations"."latitude" between -90 and 90),
	CONSTRAINT "locations_longitude_range" CHECK ("locations"."longitude" between -180 and 180),
	CONSTRAINT "locations_radius_range" CHECK ("locations"."radius_m" between 25 and 1000)
);
--> statement-breakpoint
CREATE TABLE "membership_locations" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_locations_org_id_user_id_location_id_pk" PRIMARY KEY("org_id","user_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_location_same_org_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_roles" ADD CONSTRAINT "job_roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_locations" ADD CONSTRAINT "membership_locations_membership_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."memberships"("org_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_locations" ADD CONSTRAINT "membership_locations_location_same_org_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ===================== Row-level security (hand-written) =====================
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON locations
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON departments
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

ALTER TABLE job_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON job_roles
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

ALTER TABLE membership_locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership_locations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON membership_locations
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
