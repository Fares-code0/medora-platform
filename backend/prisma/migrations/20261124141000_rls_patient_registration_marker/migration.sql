-- Patient registration under RLS, corrected (follows 20261124140000).
--
-- `xmin` does not identify the row an INSERT … RETURNING is returning (the
-- SELECT policy is checked against the new tuple before it is stored), so
-- the previous rule did not admit registration. Registration instead names
-- the patient it is creating in a transaction-local setting
-- (`app.registering_patient`, set by the repository inside the same
-- transaction); a hospital scope may read exactly that row. The marker lives
-- and dies with the transaction, and outside it a patient row is visible to a
-- hospital only through a Hospital Medical Record.

DROP POLICY patients_read ON public.patients;
CREATE POLICY patients_read ON public.patients FOR SELECT USING (
  app_rls.scope() = 'system'
  OR (app_rls.scope() = 'patient' AND id = app_rls.current_patient_id())
  OR (app_rls.scope() = 'hospital'
      AND (EXISTS (SELECT 1 FROM public.hospital_medical_records h WHERE h.patient_id = patients.id)
           OR public_id = NULLIF(current_setting('app.registering_patient', true), ''))));
