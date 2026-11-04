-- Local development only. Runs once, when the Postgres volume is first created
-- (docker-entrypoint-initdb.d). In production these roles are created once by hand
-- with strong passwords (see ARCHITECTURE.md §7.1).
--
--   app_owner  owns the schema and runs migrations
--   app_user   what the API and worker connect as: owns nothing and can't bypass RLS
CREATE ROLE app_owner LOGIN PASSWORD 'app_owner';
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

ALTER DATABASE shiftora OWNER TO app_owner;
ALTER SCHEMA public OWNER TO app_owner;

REVOKE ALL ON DATABASE shiftora FROM PUBLIC;
GRANT CONNECT ON DATABASE shiftora TO app_user;
