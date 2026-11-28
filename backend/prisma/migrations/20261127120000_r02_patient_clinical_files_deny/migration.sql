-- R-02 (PR-68): a patient never reads a clinical file at the database layer,
-- whatever ordinary term of `files_read` would otherwise admit it.
--
-- Owner decision: a patient never accesses the medical record, clinical
-- results, lab results, medical documents or clinical attachments. ADR-031
-- (results release) is open. Approved design:
-- docs/audits/PR-68-R02-PATIENT-FILE-ACCESS-DESIGN.md §11 (revision 3).
--
-- What changes:
-- * New SECURITY DEFINER helper `app_rls.file_denied_to_patient(file, kind)`.
--   It is true only when the caller is a patient (scope `patient`, or, in any
--   scope, an account whose role is `patient`, which covers unlinked patients
--   in `self` scope) AND the file is clinical (by kind, or by any link in
--   `patient_documents`, `record_attachments` or `lab_attachments`,
--   soft-deleted links included). For a non-patient caller it answers false
--   without reading any link table.
-- * `files_read` now applies that denial around every ordinary term (hospital,
--   uploader, public kinds, conversation). `system` and `platform` stay
--   exempt. The `file_of_current_patient` term is removed; the function itself
--   is left untouched so that rollback is exact.
-- * EXECUTE goes to exactly the roles that can evaluate `files_read` today:
--   the explicit grantees of `app_rls.file_in_my_conversation` that also hold
--   SELECT on `public.files`. No PUBLIC, no maintenance role. The migration
--   aborts if PUBLIC can execute that function.
--
-- Explicit BEGIN/COMMIT: Prisma does not wrap a PostgreSQL migration in a
-- transaction (verified, design §11.5). Without it, a failure after DROP POLICY
-- would leave `files` with no read policy.
--
-- Before applying in any environment: run prisma/roles/r02-preapply-check.sql.
-- Rollback: prisma/rollbacks/20261127120000_r02_patient_clinical_files_deny.down.sql.
-- Runbook: docs/multi-hospital/DATABASE_ROLES.md §5.

BEGIN;

CREATE FUNCTION app_rls.file_denied_to_patient(p_file uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN NOT (COALESCE(app_rls.scope() = 'patient', false)
              OR (app_rls.current_user_id() IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
                     WHERE u.id = app_rls.current_user_id() AND r.code = 'patient')))
      THEN false
    ELSE COALESCE(p_kind IN ('patient_document', 'record_attachment', 'lab_attachment'), true)
      OR EXISTS (SELECT 1 FROM public.patient_documents  d WHERE d.file_id = p_file)
      OR EXISTS (SELECT 1 FROM public.record_attachments a WHERE a.file_id = p_file)
      OR EXISTS (SELECT 1 FROM public.lab_attachments    l WHERE l.file_id = p_file)
  END
$fn$;

REVOKE ALL ON FUNCTION app_rls.file_denied_to_patient(uuid, text) FROM PUBLIC;

DO $grant$
DECLARE
  r regrole;
  public_exec boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure
       AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    INTO public_exec;
  IF public_exec THEN
    RAISE EXCEPTION 'R-02: app_rls.file_in_my_conversation is executable by PUBLIC; grant set is undeterminable';
  END IF;

  FOR r IN
    SELECT DISTINCT a.grantee::regrole
      FROM pg_proc p,
           LATERAL aclexplode(p.proacl) a
     WHERE p.oid = 'app_rls.file_in_my_conversation(uuid)'::regprocedure
       AND a.privilege_type = 'EXECUTE'
       AND a.grantee <> 0
       AND a.grantee <> p.proowner
       AND has_table_privilege(a.grantee, 'public.files', 'SELECT')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION app_rls.file_denied_to_patient(uuid, text) TO %s', r);
  END LOOP;
END
$grant$;

DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (
       NOT app_rls.file_denied_to_patient(id, kind)
       AND (
            (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
         OR uploaded_by = app_rls.current_user_id()
         OR kind IN ('profile_photo', 'branding_asset')
         OR app_rls.file_in_my_conversation(id)
       )
  ));

COMMIT;
