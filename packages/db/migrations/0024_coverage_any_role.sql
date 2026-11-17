-- Postgres treats NULLs as distinct, so the covering index cannot stop two "anyone" requirements
-- for the same weekday and start. A partial unique index can, and it is what makes the API's 409
-- honest instead of racy.
CREATE UNIQUE INDEX coverage_requirements_any_role_unique
  ON coverage_requirements (org_id, location_id, weekday, start_local)
  WHERE job_role_id IS NULL;
