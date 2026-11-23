-- A role change revokes every live session of that account (approved G4
-- contract, 2026-11-23, docs/multi-hospital/OWNER_DECISIONS.md): "role
-- changes revoke existing sessions and reject old access tokens".
--
-- ADR-046 already refuses an access token whose role claim is stale. This
-- closes the other half: the refresh family dies with the role, so the
-- account signs in again under its new role instead of refreshing into it.
--
-- A trigger rather than application code so that no write path (the admin
-- API, a seed, a reconciliation script, a test helper) can change a role
-- without it. It runs in the same transaction as the role change: a rolled
-- back change revokes nothing. The columns cleared match
-- SessionService.revokeAllFor.

CREATE FUNCTION public.users_role_change_revokes_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.sessions
     SET revoked_at = CURRENT_TIMESTAMP,
         rotated_at = NULL,
         successor_token_ct = NULL
   WHERE user_id = NEW.id
     AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_role_change_revokes_sessions
  AFTER UPDATE OF role_id ON public.users
  FOR EACH ROW
  WHEN (OLD.role_id IS DISTINCT FROM NEW.role_id)
  EXECUTE FUNCTION public.users_role_change_revokes_sessions();
