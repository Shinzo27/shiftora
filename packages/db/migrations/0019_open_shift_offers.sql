-- 0019_open_shift_offers (W5 D3): when a manager offered an open shift to the eligible staff.
-- The partial index serves "open shifts I could take": offered, still open, by location.
ALTER TABLE "shifts" ADD COLUMN "offered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "shifts_offered_open_idx" ON "shifts" USING btree ("org_id","location_id","starts_at") WHERE status = 'open' AND offered_at IS NOT NULL;