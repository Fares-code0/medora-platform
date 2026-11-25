-- G4 in the database: every permission write bumps `users.authz_version`, and
-- a role change revokes the account's sessions (consolidated from PR #63,
-- migrations 20261123140000_permission_version and
-- 20261123150000_role_change_revokes_sessions, adapted to PR #61's existing
-- `users.authz_version`).
--
-- Approved decision G4 (OWNER_DECISIONS.md, 2026-11-23): permission changes
-- apply on the next request and fail closed; ordinary permission changes do not
-- revoke sessions; role changes keep revoking sessions and rejecting old access
-- tokens (ADR-046). PR #61 already enforces this for every application path
-- (the version-keyed permission cache, and PlatformUserService revoking on a
-- role change). These triggers make it hold for every writer — a seed, a
-- migration, an operator's SQL — not only for the application:
--
-- * `authz_version` never decreases, and rises with a change of `role_id`;
-- * a write to `user_permissions`, `role_permissions` or a permission's
--   `code` bumps every affected account, once per statement;
-- * a change of `role_id` revokes every live session of that account in the
--   same transaction (`sessions_clear_revoked_successor` clears the rotation
--   state, as for any revocation).
--
-- The application's own bumps and revocations stay; a second bump is harmless
-- (the version only has to change), and revoking an already revoked session
-- matches nothing.



CREATE FUNCTION public.users_authz_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $users_pv$
BEGIN
  IF NEW.authz_version < OLD.authz_version THEN
    RAISE EXCEPTION 'users.authz_version may not decrease (% -> %)',
      OLD.authz_version, NEW.authz_version
      USING ERRCODE = '23514', CONSTRAINT = 'users_authz_version_monotonic';
  END IF;
  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    NEW.authz_version := NEW.authz_version + 1;
  END IF;
  RETURN NEW;
END;
$users_pv$;

CREATE TRIGGER users_authz_version_guard
  BEFORE UPDATE OF role_id, authz_version ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_authz_version_guard();

CREATE FUNCTION public.bump_authz_version_user_permissions()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $up_pv$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.users u SET authz_version = u.authz_version + 1
     WHERE u.id IN (SELECT DISTINCT user_id FROM new_rows);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.users u SET authz_version = u.authz_version + 1
     WHERE u.id IN (SELECT DISTINCT user_id FROM old_rows);
  ELSE
    UPDATE public.users u SET authz_version = u.authz_version + 1
     WHERE u.id IN (
       SELECT user_id FROM (
         (SELECT user_id, permission_id, allowed FROM new_rows
          EXCEPT SELECT user_id, permission_id, allowed FROM old_rows)
         UNION
         (SELECT user_id, permission_id, allowed FROM old_rows
          EXCEPT SELECT user_id, permission_id, allowed FROM new_rows)
       ) changed);
  END IF;
  RETURN NULL;
END;
$up_pv$;

CREATE TRIGGER user_permissions_version_insert
  AFTER INSERT ON public.user_permissions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_user_permissions();
CREATE TRIGGER user_permissions_version_update
  AFTER UPDATE ON public.user_permissions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_user_permissions();
CREATE TRIGGER user_permissions_version_delete
  AFTER DELETE ON public.user_permissions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_user_permissions();

CREATE FUNCTION public.bump_authz_version_role_permissions()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $rp_pv$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.users u SET authz_version = u.authz_version + 1
     WHERE u.role_id IN (SELECT DISTINCT role_id FROM new_rows);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.users u SET authz_version = u.authz_version + 1
     WHERE u.role_id IN (SELECT DISTINCT role_id FROM old_rows);
  ELSE
    UPDATE public.users u SET authz_version = u.authz_version + 1
     WHERE u.role_id IN (
       SELECT role_id FROM (
         (SELECT role_id, permission_id FROM new_rows
          EXCEPT SELECT role_id, permission_id FROM old_rows)
         UNION
         (SELECT role_id, permission_id FROM old_rows
          EXCEPT SELECT role_id, permission_id FROM new_rows)
       ) changed);
  END IF;
  RETURN NULL;
END;
$rp_pv$;

CREATE TRIGGER role_permissions_version_insert
  AFTER INSERT ON public.role_permissions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_role_permissions();
CREATE TRIGGER role_permissions_version_update
  AFTER UPDATE ON public.role_permissions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_role_permissions();
CREATE TRIGGER role_permissions_version_delete
  AFTER DELETE ON public.role_permissions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_role_permissions();

CREATE FUNCTION public.bump_authz_version_permission_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $p_pv$
BEGIN
  WITH renamed AS (
    SELECT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE n.code IS DISTINCT FROM o.code
  )
  UPDATE public.users u SET authz_version = u.authz_version + 1
   WHERE u.role_id IN (SELECT rp.role_id FROM public.role_permissions rp
                        WHERE rp.permission_id IN (SELECT id FROM renamed))
      OR u.id IN (SELECT up.user_id FROM public.user_permissions up
                   WHERE up.permission_id IN (SELECT id FROM renamed));
  RETURN NULL;
END;
$p_pv$;

CREATE TRIGGER permissions_version_code_update
  AFTER UPDATE ON public.permissions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_authz_version_permission_code();


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
