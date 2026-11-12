-- 0008_time_entries: attendance punches, and the organisation's geofence policy.
--
-- A punch stores both coordinates and the server's verdict (distance in metres): "16 m from
-- the clinic, ±8 m accuracy" is what settles an argument later, and the distance is computed
-- from the server's own copy of the location rather than the phone's.
--
-- Two guarantees live in the database:
--   * one open punch per employee (partial unique index on clock_out_at is null) — a second
--     clock-in without a clock-out is a bug, not data;
--   * one row per client event, unique per org — the device's Idempotency-Key, so a retry
--     after a dead connection cannot produce a second clock-in.
CREATE TYPE "public"."geofence_policy" AS ENUM('flag', 'reject');--> statement-breakpoint
CREATE TYPE "public"."attendance_method" AS ENUM('gps', 'qr', 'manual');--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"shift_id" uuid,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"method" "attendance_method" DEFAULT 'gps' NOT NULL,
	"in_latitude" double precision NOT NULL,
	"in_longitude" double precision NOT NULL,
	"in_accuracy_m" integer NOT NULL,
	"in_distance_m" integer NOT NULL,
	"out_latitude" double precision,
	"out_longitude" double precision,
	"out_accuracy_m" integer,
	"out_distance_m" integer,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"client_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_period_order" CHECK (clock_out_at is null or clock_out_at > clock_in_at),
	CONSTRAINT "time_entries_accuracy_positive" CHECK (in_accuracy_m >= 0),
	CONSTRAINT "time_entries_distance_positive" CHECK (in_distance_m >= 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "geofence_policy" "geofence_policy" DEFAULT 'flag' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_id_location_unique" UNIQUE("org_id","id","location_id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_shift_fk" FOREIGN KEY ("org_id","shift_id","location_id") REFERENCES "public"."shifts"("org_id","id","location_id") ON DELETE set null (shift_id) ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_client_event_unique" ON "time_entries" USING btree ("org_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_open" ON "time_entries" USING btree ("org_id","employee_id") WHERE clock_out_at is null;--> statement-breakpoint
CREATE INDEX "time_entries_employee_time_idx" ON "time_entries" USING btree ("org_id","employee_id","clock_in_at");--> statement-breakpoint
CREATE INDEX "time_entries_location_time_idx" ON "time_entries" USING btree ("org_id","location_id","clock_in_at");--> statement-breakpoint
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON time_entries
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
