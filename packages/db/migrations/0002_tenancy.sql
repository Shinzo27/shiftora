-- 0002_tenancy: organisations, memberships, invites, audit events, and the row-level
-- security (RLS) that keeps every organisation's rows invisible to the others.
-- Generated tables first (drizzle-kit), then the hand-written security section below.

CREATE TYPE "public"."member_role" AS ENUM('owner', 'manager', 'employee', 'kiosk');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_id_entity_entity_id_index" ON "audit_events" USING btree ("org_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_created_at_index" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "invites_org_id_index" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_one_open_per_email" ON "invites" USING btree ("org_id","email") WHERE "invites"."accepted_at" is null and "invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "memberships_user_id_index" ON "memberships" USING btree ("user_id");--> statement-breakpoint

-- ===================== Row-level security (hand-written) =====================
-- The API runs each request in a transaction that first sets
--   app.user_id  (who is calling)       via set_config(..., true)  -- transaction-local
--   app.org_id   (which org they chose) -- only after checking they are a member
-- Policies below compare rows against these. With nothing set, every policy matches
-- nothing (NULL comparisons are never true), so a missing context fails closed.
--
-- FORCE makes the policies apply to the table owner (app_owner) too; only superusers and
-- BYPASSRLS roles skip them, and the app never connects as either.

CREATE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- organizations: the row whose id is the current org. Members may also *read* the orgs
-- they belong to, so "list my organisations" works before an org is selected.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations
  USING (id = current_org_id())
  WITH CHECK (id = current_org_id());
--> statement-breakpoint
CREATE POLICY members_read_own_orgs ON organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = organizations.id AND m.user_id = current_user_id()
  ));
--> statement-breakpoint

-- memberships: rows of the current org. A user may also *read* their own memberships in
-- any org (needed to list their orgs and to check membership when they pick one).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON memberships
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY users_read_own_memberships ON memberships FOR SELECT
  USING (user_id = current_user_id());
--> statement-breakpoint

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invites
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_events
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
-- Append-only: the default privileges from 0000 granted UPDATE/DELETE; take them back.
REVOKE UPDATE, DELETE ON audit_events FROM app_user;
