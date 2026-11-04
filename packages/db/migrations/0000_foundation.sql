-- 0000_foundation: database-wide setup every later migration relies on.
-- Runs as app_owner. Assumes roles app_owner and app_user exist
-- (local: infra/postgres/init/01-roles.sql; production: created once by hand).

-- btree_gist: lets an exclusion constraint combine "same employee" (=) with
-- "overlapping time range" (&&), which is how shifts prevent double-booking (week 2).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- citext: case-insensitive text, for emails and coupon codes.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint

-- app_user can use the schema and read/write rows in every table app_owner creates
-- from now on. It never owns tables, so RLS always applies to it. Tables that must be
-- append-only (audit_events) revoke UPDATE/DELETE in their own migration.
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
--> statement-breakpoint

-- The tenant of the current transaction, set by the API/worker with
--   SELECT set_config('app.org_id', '<uuid>', true)   -- true = transaction-local
-- RLS policies compare org_id against this. When it isn't set it returns NULL, and
-- "org_id = NULL" matches no rows, so a forgotten tenant context fails closed.
-- (After a transaction-local setting ends, Postgres reports '' rather than NULL,
-- hence the nullif.)
CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
