-- 0026_audit_partitions (W7 D4): audit_events becomes a table partitioned by month.
--
-- Hand-written: drizzle-kit does not model partitioning (its snapshot only records the new
-- primary key). The audit trail only grows, and the owner's screen reads it a month or two at a
-- time, so range partitions on created_at keep those reads on one or two small tables (partition
-- pruning) and make retention a DETACH/DROP instead of a giant DELETE.
--
-- Shape:
--   audit_events               the partitioned parent: RLS, policies and grants live here
--   audit_events_YYYY_MM       one per UTC month, created ahead by ensure_audit_partitions()
--   audit_events_default       catches a row whose month does not exist yet (never an error)
--
-- Security: app_user keeps INSERT/SELECT on the parent only. The default privileges from 0000
-- would also grant it every partition, and a partition queried by name skips the parent's RLS,
-- so each partition's privileges are revoked.

ALTER TABLE audit_events RENAME TO audit_events_unpartitioned;--> statement-breakpoint
ALTER TABLE audit_events_unpartitioned RENAME CONSTRAINT audit_events_pkey TO audit_events_unpartitioned_pkey;--> statement-breakpoint
ALTER INDEX audit_events_org_id_entity_entity_id_index RENAME TO audit_events_unpartitioned_entity_index;--> statement-breakpoint
ALTER INDEX audit_events_org_id_created_at_index RENAME TO audit_events_unpartitioned_created_at_index;--> statement-breakpoint

CREATE TABLE audit_events (
	"id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_id_created_at_pk" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_entity_entity_id_index" ON audit_events USING btree ("org_id", "entity", "entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_created_at_index" ON audit_events USING btree ("org_id", "created_at");--> statement-breakpoint

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_events
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());--> statement-breakpoint
-- Append-only, as before.
REVOKE UPDATE, DELETE ON audit_events FROM app_user;--> statement-breakpoint

CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;--> statement-breakpoint
REVOKE ALL ON audit_events_default FROM app_user;--> statement-breakpoint

-- One month's partition. Rows already sitting in the default partition for that month are moved
-- into it first (ATTACH refuses while the default holds rows of the new range), all in the
-- caller's transaction. Internal: only ensure_audit_partitions() and this migration call it.
CREATE FUNCTION create_audit_partition(month date) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  first_day date := date_trunc('month', month)::date;
  starts timestamptz := first_day::timestamp AT TIME ZONE 'UTC';
  ends timestamptz := (first_day + interval '1 month')::timestamp AT TIME ZONE 'UTC';
  part text := format('audit_events_%s', to_char(first_day, 'YYYY_MM'));
BEGIN
  IF to_regclass(part) IS NOT NULL THEN
    RETURN false;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I (LIKE audit_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', part);
  EXECUTE format('REVOKE ALL ON %I FROM app_user', part);
  EXECUTE format(
    'WITH moved AS (DELETE FROM audit_events_default
                     WHERE created_at >= %L AND created_at < %L RETURNING *)
     INSERT INTO %I SELECT * FROM moved', starts, ends, part);
  EXECUTE format(
    'ALTER TABLE audit_events ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
    part, starts, ends);
  RETURN true;
END
$$;--> statement-breakpoint

-- This month and the next `months_ahead` (UTC). Safe to call from several workers at once: the
-- advisory lock serialises them, and an existing month is skipped. Returns how many it created.
-- SECURITY DEFINER so that app_user (the worker) can run exactly this and nothing else as
-- app_owner; app_user still cannot create, alter or read partitions itself.
CREATE FUNCTION ensure_audit_partitions(months_ahead integer DEFAULT 3) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  this_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  created integer := 0;
BEGIN
  IF months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24, got %', months_ahead;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ensure_audit_partitions'));
  FOR i IN 0..months_ahead LOOP
    IF create_audit_partition((this_month + make_interval(months => i))::date) THEN
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION create_audit_partition(date) FROM PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION ensure_audit_partitions(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ensure_audit_partitions(integer) TO app_user;--> statement-breakpoint

-- Move the history across: everything lands in the default partition, then each month that has
-- rows gets its own partition (which takes them out of the default), then the months ahead.
--
-- RLS is FORCEd on both tables, which binds their owner too: with no org set, the old table would
-- read as empty and the new parent would refuse every row. So the old table stops forcing it (it
-- is dropped below), and the rows go straight into the default partition, which has no RLS of
-- its own (app_user cannot touch it). No other partition exists yet.
-- row_security = off makes any read that RLS would filter an ERROR instead of a silently short
-- answer, so a missed FORCE can never turn into an empty copy and a dropped table.
SET LOCAL row_security = off;--> statement-breakpoint
ALTER TABLE audit_events_unpartitioned NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO audit_events_default SELECT * FROM audit_events_unpartitioned;--> statement-breakpoint
-- Never drop history on a miscount: the whole migration rolls back instead.
DO $$
DECLARE
  old_rows bigint := (SELECT count(*) FROM audit_events_unpartitioned);
  new_rows bigint := (SELECT count(*) FROM audit_events_default);
BEGIN
  IF old_rows <> new_rows THEN
    RAISE EXCEPTION 'audit_events copy incomplete: % rows before, % after', old_rows, new_rows;
  END IF;
END
$$;--> statement-breakpoint
SELECT create_audit_partition(month::date)
  FROM generate_series(
    date_trunc('month', (SELECT min(created_at) FROM audit_events_unpartitioned) AT TIME ZONE 'UTC'),
    date_trunc('month', now() AT TIME ZONE 'UTC'),
    interval '1 month'
  ) AS month;--> statement-breakpoint
SELECT ensure_audit_partitions(3);--> statement-breakpoint
DO $$
DECLARE
  old_rows bigint := (SELECT count(*) FROM audit_events_unpartitioned);
  placed bigint := 0;
  part regclass;
BEGIN
  FOR part IN SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'audit_events'::regclass LOOP
    EXECUTE format('SELECT %s + count(*) FROM %s', placed, part) INTO placed;
  END LOOP;
  IF old_rows <> placed THEN
    RAISE EXCEPTION 'audit_events partitioning lost rows: % before, % after', old_rows, placed;
  END IF;
END
$$;--> statement-breakpoint
DROP TABLE audit_events_unpartitioned;--> statement-breakpoint
SET LOCAL row_security = on;
