-- ════════════════════════════════════════════════════════════════════════
-- R-02 pre-apply checks: run BEFORE migration
-- 20261127120000_r02_patient_clinical_files_deny in every environment.
-- ════════════════════════════════════════════════════════════════════════
--
-- Read-only. Run as the owner/migration role, tokens replaced, e.g.:
--
--   sed -e 's/__RUNTIME_ROLE__/medora_app/g' -e 's/__OWNER_ROLE__/medora/g' \
--     r02-preapply-check.sql | psql "<owner connection>" -v ON_ERROR_STOP=1
--
-- It raises on the first failed check, so psql exits non-zero, and prints
-- "R-02 pre-apply checks passed" otherwise. A failure means STOP: do not apply
-- the migration and do not weaken the check. Design:
-- docs/audits/PR-68-R02-PATIENT-FILE-ACCESS-DESIGN.md §11.9.1.
--
-- 1. `public.files` carries exactly the four permissive policies the design
--    assumes. Any other policy would be ORed in, or restrict, unseen.
-- 2. The runtime role can evaluate `files_read` today: it is an explicit
--    EXECUTE grantee of app_rls.file_in_my_conversation and holds SELECT on
--    `files`. PUBLIC cannot execute that function (otherwise the migration's
--    grant set is undeterminable and it would abort). The runtime role
--    neither bypasses RLS nor is a superuser.
-- 3. The owner runs this (as it runs migrations) and owns every table the
--    SECURITY DEFINER helper reads, none with FORCE ROW LEVEL SECURITY, so
--    the helper sees link rows unfiltered.

DO $r02_check$
DECLARE
  found text;
BEGIN
  -- 1 ─────────────────────────────────────────────────────────────────────
  SELECT string_agg(polname::text || ':' || polcmd::text || ':' || polpermissive::text, ',' ORDER BY polname)
    INTO found
    FROM pg_policy WHERE polrelid = 'public.files'::regclass;
  IF found IS DISTINCT FROM
     'files_delete:d:true,files_insert:a:true,files_read:r:true,files_update:w:true' THEN
    RAISE EXCEPTION 'R-02 check 1 failed: policies on public.files are [%]', found;
  END IF;

  -- 2 ─────────────────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure
       AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'R-02 check 2 failed: PUBLIC can execute app_rls.file_in_my_conversation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure
       AND a.privilege_type = 'EXECUTE'
       AND a.grantee = '__RUNTIME_ROLE__'::regrole) THEN
    RAISE EXCEPTION 'R-02 check 2 failed: __RUNTIME_ROLE__ is not an explicit EXECUTE grantee of app_rls.file_in_my_conversation';
  END IF;
  IF NOT has_table_privilege('__RUNTIME_ROLE__', 'public.files', 'SELECT') THEN
    RAISE EXCEPTION 'R-02 check 2 failed: __RUNTIME_ROLE__ lacks SELECT on public.files';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__RUNTIME_ROLE__' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'R-02 check 2 failed: __RUNTIME_ROLE__ is a superuser or bypasses RLS';
  END IF;

  -- 3 ─────────────────────────────────────────────────────────────────────
  IF current_user::regrole <> '__OWNER_ROLE__'::regrole THEN
    RAISE EXCEPTION 'R-02 check 3 failed: run as the owner role __OWNER_ROLE__, not %', current_user;
  END IF;
  SELECT string_agg(c.oid::regclass::text || ' (owner ' || c.relowner::regrole::text
                    || CASE WHEN c.relforcerowsecurity THEN ', FORCE RLS' ELSE '' END || ')', ', ')
    INTO found
    FROM pg_class c
   WHERE c.oid IN ('public.files'::regclass, 'public.users'::regclass, 'public.roles'::regclass,
                   'public.patient_documents'::regclass, 'public.record_attachments'::regclass,
                   'public.lab_attachments'::regclass)
     AND (c.relowner <> '__OWNER_ROLE__'::regrole OR c.relforcerowsecurity);
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'R-02 check 3 failed: not owned by __OWNER_ROLE__ without FORCE RLS: %', found;
  END IF;

  RAISE NOTICE 'R-02 pre-apply checks passed';
END
$r02_check$;
