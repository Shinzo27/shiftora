CREATE TYPE "public"."one_time_token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "one_time_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_time_tokens_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DROP INDEX "notifications_outbox_email_unique";--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "one_time_tokens_user_purpose_idx" ON "one_time_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_outbox_email_unique" ON "notifications" USING btree ("outbox_id","recipient_email");--> statement-breakpoint
-- Platform mail (verify an address, reset a password) belongs to no organisation, so its outbox
-- row has no org_id. The tenant policy's WITH CHECK cannot accept that, and policies OR together,
-- so this one permits exactly the null-org case and nothing wider.
CREATE POLICY outbox_platform_insert ON outbox FOR INSERT WITH CHECK (org_id IS NULL);
