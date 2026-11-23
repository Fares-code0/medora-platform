-- G4 (ADR-047): an authoritative permission version per account.
--
-- `users.permission_version` changes whenever the account's effective
-- permissions can change. The access-token guard reads it on every request
-- (the same row it already reads for the session check) and a cached
-- permission set stamped with any other value is never used, so a permission
-- change applies on the account's next request.
--
-- The version is bumped by triggers, not by application code: every write
-- path to the permission tables — the API, a seed, a hand-run statement, a
-- cascade from a deleted permission or role — bumps it in the same
-- transaction as the change, so no path can forget it and the bump commits
-- (or rolls back) atomically with the change itself.
--
--   user_permissions   insert / update / delete  -> that user
--   role_permissions   insert / update / delete  -> every user of that role
--   permissions        code renamed              -> every user holding it
--   users.role_id      changed                   -> that user
--
-- Statement-level triggers with transition tables, not row-level ones: a
-- matrix save deletes and re-inserts every role_permissions row (~100), and a
-- row-level trigger would update each role's users once per row. These run
-- once per statement and update each affected user once.
--
-- UPDATE triggers compare old and new rows on the columns that decide
-- authorization only, so an update that touches nothing else (granted_by set
-- to NULL when the granting user is deleted) bumps nobody.
--
-- Additive and backward compatible: the column has a default, code that does
-- not know it keeps working, and its writes are versioned by the triggers.

ALTER TABLE public.users
  ADD COLUMN permission_version INTEGER NOT NULL DEFAULT 1;

-- users: a role change bumps; the version never goes backwards.
CREATE FUNCTION public.users_permission_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $users_pv$
BEGIN
  IF NEW.permission_version < OLD.permission_version THEN
    RAISE EXCEPTION 'users.permission_version may not decrease (% -> %)',
      OLD.permission_version, NEW.permission_version
      USING ERRCODE = '23514', CONSTRAINT = 'users_permission_version_monotonic';
  END IF;
  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    NEW.permission_version := NEW.permission_version + 1;
  END IF;
  RETURN NEW;
END;
$users_pv$;

CREATE TRIGGER users_permission_version_guard
  BEFORE UPDATE OF role_id, permission_version ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_permission_version_guard();

-- user_permissions: bump the users whose override rows changed.
CREATE FUNCTION public.bump_permission_version_user_permissions()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $up_pv$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.users u SET permission_version = u.permission_version + 1
     WHERE u.id IN (SELECT DISTINCT user_id FROM new_rows);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.users u SET permission_version = u.permission_version + 1
     WHERE u.id IN (SELECT DISTINCT user_id FROM old_rows);
  ELSE
    UPDATE public.users u SET permission_version = u.permission_version + 1
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
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_user_permissions();
CREATE TRIGGER user_permissions_version_update
  AFTER UPDATE ON public.user_permissions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_user_permissions();
CREATE TRIGGER user_permissions_version_delete
  AFTER DELETE ON public.user_permissions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_user_permissions();

-- role_permissions: bump every user of each role whose grants changed.
CREATE FUNCTION public.bump_permission_version_role_permissions()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $rp_pv$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.users u SET permission_version = u.permission_version + 1
     WHERE u.role_id IN (SELECT DISTINCT role_id FROM new_rows);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.users u SET permission_version = u.permission_version + 1
     WHERE u.role_id IN (SELECT DISTINCT role_id FROM old_rows);
  ELSE
    UPDATE public.users u SET permission_version = u.permission_version + 1
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
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_role_permissions();
CREATE TRIGGER role_permissions_version_update
  AFTER UPDATE ON public.role_permissions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_role_permissions();
CREATE TRIGGER role_permissions_version_delete
  AFTER DELETE ON public.role_permissions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_role_permissions();

-- permissions: the resolver reads codes, so renaming a code changes the
-- effective set of everyone holding it through a role or an override.
-- (Deleting a permission cascades to the two tables above.)
CREATE FUNCTION public.bump_permission_version_permission_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $p_pv$
BEGIN
  WITH renamed AS (
    SELECT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE n.code IS DISTINCT FROM o.code
  )
  UPDATE public.users u SET permission_version = u.permission_version + 1
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
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_permission_version_permission_code();
