-- Patient registration under Row-Level Security (multi-hospital §2.7, §2.15).
--
-- Registration inserts a patient and, in the same transaction, opens its
-- Hospital Medical Record at the registering doctor's hospital. A patient
-- row is readable to a hospital scope only through a visible record, so the
-- INSERT … RETURNING that creates it (whose returned row PostgreSQL checks
-- against the SELECT policy) was refused: the record does not exist yet.
--
-- A hospital-scoped transaction may therefore also read the patient rows it
-- created itself (`xmin` is the creating transaction). That is the
-- transaction's own write, never another tenant's data; once it commits, the
-- row is visible only through a record, as before.

DROP POLICY patients_read ON public.patients;
CREATE POLICY patients_read ON public.patients FOR SELECT USING (
  app_rls.scope() = 'system'
  OR (app_rls.scope() = 'patient' AND id = app_rls.current_patient_id())
  OR (app_rls.scope() = 'hospital'
      AND (EXISTS (SELECT 1 FROM public.hospital_medical_records h WHERE h.patient_id = patients.id)
           OR patients.xmin = pg_current_xact_id()::xid)));
