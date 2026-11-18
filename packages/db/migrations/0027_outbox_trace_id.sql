-- 0027_outbox_trace_id (W7 D5): the trace id of whatever wrote the event, so the worker's log
-- lines for the relay, the fan-out and the provider send share it with the API request that
-- caused them. Nullable: older rows, and rows written outside a request, have none.
ALTER TABLE "outbox" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_trace_id_format" CHECK ("outbox"."trace_id" ~ '^[0-9a-f]{32}$');