-- The outbox relay is the one process that must read every tenant's pending events: it claims
-- the oldest unpublished rows and enqueues them, and only afterwards does a job run under a
-- single org's context. RLS has to allow exactly that, and nothing else.
--
-- The switch is a transaction-local GUC, not a role, because the API and the worker share
-- credentials today; a separate role (`app_worker`) is the honest fix before production and is
-- noted in ADR 017. Policies OR together, so app_user with an org context still sees only its
-- own rows.
CREATE POLICY outbox_relay_read ON outbox
  FOR SELECT
  USING (current_setting('app.outbox_relay', true) = 'on');--> statement-breakpoint

CREATE POLICY outbox_relay_claim ON outbox
  FOR UPDATE
  USING (current_setting('app.outbox_relay', true) = 'on')
  WITH CHECK (current_setting('app.outbox_relay', true) = 'on');--> statement-breakpoint

-- A claimed row must be findable again only if the claim was rolled back; the relay sets
-- published_at in the same transaction that marks the job, so this is the read path's index.
CREATE INDEX IF NOT EXISTS "outbox_relay_pending_idx"
  ON "outbox" ("created_at")
  WHERE "published_at" IS NULL;
