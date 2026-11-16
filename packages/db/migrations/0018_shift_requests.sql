-- 0018_shift_requests (W5 D1): swap, drop and pickup requests (state machine in
-- packages/domain/requests). One open request per shift on each side; a swap names a colleague,
-- a drop does not; open means undecided. Same-org composite foreign keys, RLS below.

CREATE TYPE "public"."shift_request_status" AS ENUM('pending_colleague', 'pending_manager', 'approved', 'rejected', 'declined', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."shift_request_type" AS ENUM('swap', 'drop', 'pickup');--> statement-breakpoint
CREATE TABLE "shift_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "shift_request_type" NOT NULL,
	"status" "shift_request_status" NOT NULL,
	"shift_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"target_employee_id" uuid,
	"target_shift_id" uuid,
	"note" text,
	"responded_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_requests_swap_has_colleague" CHECK (("shift_requests"."type" = 'swap') = ("shift_requests"."target_employee_id" is not null)),
	CONSTRAINT "shift_requests_target_shift_is_swap" CHECK ("shift_requests"."target_shift_id" is null or "shift_requests"."type" = 'swap'),
	CONSTRAINT "shift_requests_not_self" CHECK ("shift_requests"."target_employee_id" is null or "shift_requests"."target_employee_id" <> "shift_requests"."requester_employee_id"),
	CONSTRAINT "shift_requests_two_shifts" CHECK ("shift_requests"."target_shift_id" is null or "shift_requests"."target_shift_id" <> "shift_requests"."shift_id"),
	CONSTRAINT "shift_requests_decider_has_time" CHECK ("shift_requests"."decided_by" is null or "shift_requests"."decided_at" is not null),
	CONSTRAINT "shift_requests_open_undecided" CHECK (("shift_requests"."status" in ('pending_colleague', 'pending_manager')) = ("shift_requests"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "shift_requests" ADD CONSTRAINT "shift_requests_shift_fk" FOREIGN KEY ("org_id","shift_id") REFERENCES "public"."shifts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_requests" ADD CONSTRAINT "shift_requests_target_shift_fk" FOREIGN KEY ("org_id","target_shift_id") REFERENCES "public"."shifts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_requests" ADD CONSTRAINT "shift_requests_requester_fk" FOREIGN KEY ("org_id","requester_employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_requests" ADD CONSTRAINT "shift_requests_target_employee_fk" FOREIGN KEY ("org_id","target_employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_requests_one_open_per_shift" ON "shift_requests" USING btree ("shift_id") WHERE status in ('pending_colleague', 'pending_manager');--> statement-breakpoint
CREATE UNIQUE INDEX "shift_requests_one_open_per_target_shift" ON "shift_requests" USING btree ("target_shift_id") WHERE status in ('pending_colleague', 'pending_manager') and target_shift_id is not null;--> statement-breakpoint
CREATE INDEX "shift_requests_org_status_idx" ON "shift_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "shift_requests_requester_idx" ON "shift_requests" USING btree ("org_id","requester_employee_id");--> statement-breakpoint
CREATE INDEX "shift_requests_target_idx" ON "shift_requests" USING btree ("org_id","target_employee_id");--> statement-breakpoint

-- ===================== Row-level security (hand-written) =====================
ALTER TABLE shift_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE shift_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON shift_requests
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
