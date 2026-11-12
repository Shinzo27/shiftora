CREATE TYPE "public"."review_decision" AS ENUM('accepted', 'disputed');--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "review_decision" "review_decision";--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "review_note" text;--> statement-breakpoint
-- A review is all four columns or none: a decision without a reviewer is not an answer, and a
-- reviewer without a decision leaves the punch looking unreviewed in the queue forever.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_review_all_or_nothing" CHECK (
  ("reviewed_at" IS NULL AND "reviewed_by" IS NULL AND "review_decision" IS NULL AND "review_note" IS NULL)
  OR ("reviewed_at" IS NOT NULL AND "reviewed_by" IS NOT NULL AND "review_decision" IS NOT NULL)
);--> statement-breakpoint
-- The queue is "flagged and not yet reviewed, for this branch, over a range".
CREATE INDEX "time_entries_review_queue_idx" ON "time_entries" ("org_id", "location_id", "clock_in_at")
  WHERE "reviewed_at" IS NULL AND cardinality("flags") > 0;
