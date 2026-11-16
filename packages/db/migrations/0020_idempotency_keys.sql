CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"route" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_unique" ON "idempotency_keys" USING btree ("org_id","route","key");--> statement-breakpoint
-- The two response columns arrive together or not at all: a reserved row is never half-filled.
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_response_check
  CHECK ((response_status IS NULL) = (response_body IS NULL));--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
