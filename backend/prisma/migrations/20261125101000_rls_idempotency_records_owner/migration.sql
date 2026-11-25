-- Row-Level Security on idempotency_records (security remediation M1).
--
-- `response_body` keeps, for 24 hours, a copy of the response of every
-- `@Idempotent()` route — lab orders, prescriptions, appointments, messages
-- — so the table holds PHI. It had no RLS: the runtime role could read every
-- user's cached responses with no tenant context at all.
--
-- The access model is already fixed by the application (ADR-014): a record
-- belongs to the user whose request created it (`UNIQUE (user_id, key)`),
-- and only that user's requests claim, replay, complete or release it. The
-- request's tenant context always carries the caller's id (`app.user_id`,
-- set by AuthorizationGuard in every scope, `self` included), and the expiry
-- sweep runs as a job under explicit `system` scope. So:
--
-- * a request sees and writes only its own caller's rows;
-- * `system` (the sweep) sees every row;
-- * no context sees nothing (app_rls.current_user_id() is NULL).

ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY idempotency_records_owner ON public.idempotency_records FOR ALL
  USING (user_id = app_rls.current_user_id() OR app_rls.scope() = 'system')
  WITH CHECK (user_id = app_rls.current_user_id() OR app_rls.scope() = 'system');
