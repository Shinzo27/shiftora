-- 0021_pay_rules (W6 D1): versioned pay rules per organisation. A version starts on a local date
-- and never changes (UPDATE is revoked below); a change is a new version from a later date, so
-- old periods recalculate with the rules of their time. No rows = plain hourly pay.

CREATE TABLE "pay_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"rules" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_rules_org_version_unique" UNIQUE("org_id","version"),
	CONSTRAINT "pay_rules_org_effective_unique" UNIQUE("org_id","effective_from"),
	CONSTRAINT "pay_rules_version_positive" CHECK ("pay_rules"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rules" ADD CONSTRAINT "pay_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ===================== Immutability and row-level security (hand-written) =====================
-- The app may add a version and withdraw one that has not started (DELETE), never edit one.
REVOKE UPDATE ON pay_rules FROM app_user;--> statement-breakpoint
ALTER TABLE pay_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE pay_rules FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON pay_rules
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
