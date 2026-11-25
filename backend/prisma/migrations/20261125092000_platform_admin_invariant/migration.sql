-- At least one effective Platform Admin, enforced atomically (audit F-10).
--
-- An effective Platform Admin is an `active`, not soft-deleted user whose
-- role is `admin` and who holds an unrevoked `platform_admin_grants` row —
-- exactly what `PrismaHospitalContextRepository.hasActivePlatformAdminGrant`
-- and the account-status gate require together.
--
-- The application checked "is this the last one?" with a count before the
-- write, in a separate statement: two concurrent revocations (or a
-- revocation and a demotion, or a deactivation) could each see two and
-- both commit, leaving none. And the demotion and deactivation paths in
-- `PlatformUserService` counted `admin`-role accounts, not grants, so they
-- could remove the last Platform Admin while a Hospital Admin remained.
--
-- One model, one check, in the database:
--
-- * A deferred constraint trigger fires at COMMIT for every change that can
--   end someone's Platform Admin standing: a grant revoked; a user's role,
--   status or `deleted_at` changed.
-- * It takes one transaction-level advisory lock, so these commits are
--   serialized, then counts the effective Platform Admins on a fresh
--   snapshot (READ COMMITTED takes one per statement). The second of two
--   racing commits therefore sees the first and is refused.
-- * Refused with SQLSTATE 23514 and the message `last_platform_admin`; the
--   application answers 409.
--
-- It refuses only a transition from at least one to none, so an empty
-- database (before the first grant is bootstrapped) is unaffected. A hard
-- DELETE of a user or grant has no application path (accounts are
-- deactivated, grants revoked) and is not guarded.

CREATE OR REPLACE FUNCTION public.platform_admin_count() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT count(*)::integer
    FROM public.platform_admin_grants g
    JOIN public.users u ON u.id = g.user_id
    JOIN public.roles r ON r.id = u.role_id
   WHERE g.revoked_at IS NULL
     AND u.status = 'active'
     AND u.deleted_at IS NULL
     AND r.code = 'admin'
$fn$;

CREATE OR REPLACE FUNCTION public.assert_platform_admin_survives() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    -- Only a user who was an effective Platform Admin before the change.
    IF NOT (OLD.status = 'active' AND OLD.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM public.roles r WHERE r.id = OLD.role_id AND r.code = 'admin')
            AND EXISTS (SELECT 1 FROM public.platform_admin_grants g
                         WHERE g.user_id = OLD.id AND g.revoked_at IS NULL)) THEN
      RETURN NULL;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('medora.platform_admin_invariant', 0));
  IF public.platform_admin_count() = 0 THEN
    RAISE EXCEPTION 'last_platform_admin'
      USING ERRCODE = '23514',
            DETAIL = 'The change would leave the platform without an effective Platform Admin.';
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.platform_admin_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_platform_admin_survives() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER platform_admin_grant_revocation_guard
  AFTER UPDATE OF revoked_at ON public.platform_admin_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION public.assert_platform_admin_survives();

CREATE CONSTRAINT TRIGGER platform_admin_user_change_guard
  AFTER UPDATE OF role_id, status, deleted_at ON public.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.role_id IS DISTINCT FROM NEW.role_id
        OR OLD.status IS DISTINCT FROM NEW.status
        OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.assert_platform_admin_survives();
