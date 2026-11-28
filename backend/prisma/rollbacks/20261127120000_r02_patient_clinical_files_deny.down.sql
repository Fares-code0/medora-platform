-- Rollback of migration 20261127120000_r02_patient_clinical_files_deny (R-02).
--
-- NOT a migration: Prisma never reads this folder. To roll back, an operator
-- copies this file into a NEW migration (a later timestamp) and deploys it, or
-- runs it as the owner with `psql -v ON_ERROR_STOP=1` and then records the
-- change (see docs/multi-hospital/DATABASE_ROLES.md §5).
--
-- Restores exactly the state before R-02. The `files_read` text is verbatim
-- from 20261125095000_rls_files_conversations/migration.sql:96-102. Dropping
-- the helper removes its ACL with it. `file_of_current_patient` was never
-- modified, so it needs no restoring. Exactness is asserted by
-- test/rls-patient-clinical-files.e2e-spec.ts (catalog snapshot before == after).
--
-- WARNING: rolling back reopens the database-level patient read path that
-- R-02 closes.

BEGIN;
DROP POLICY files_read ON public.files;
CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
  OR uploaded_by = app_rls.current_user_id()
  OR kind IN ('profile_photo', 'branding_asset')
  OR app_rls.file_of_current_patient(id)
  OR app_rls.file_in_my_conversation(id));
DROP FUNCTION app_rls.file_denied_to_patient(uuid, text);
COMMIT;
