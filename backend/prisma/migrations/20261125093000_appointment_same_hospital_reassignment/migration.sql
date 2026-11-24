-- Appointment reassignment within the owning hospital (audit F-07).
--
-- `hospitalscope_appointments_trg` froze three keys once set: the hospital,
-- the patient's Hospital Medical Record, and the doctor employment. The
-- first two are the tenant: an appointment belongs to one hospital and one
-- chart for good, and that is unchanged here. The third is the attribution
-- *within* the hospital — which of its doctors holds the booking — and
-- freezing it made the administrative reassignment (API §5.10) impossible
-- for every stamped appointment: the composite foreign key
-- (doctor_employment_id, hospital_id, doctor_id) needs the employment to
-- follow the doctor.
--
-- So the tenant keys stay frozen by the same generic trigger, and the
-- employment gets a narrower guard of its own. It may change only
--   * as part of a change of doctor (never on its own),
--   * to an active employment (ended_at IS NULL),
--   * of the new doctor,
--   * at the appointment's own hospital,
-- and never back to NULL. A move to another hospital is impossible (the
-- hospital key is frozen and the employment must be at it); the application
-- cancels and rebooks instead.

DROP TRIGGER hospitalscope_appointments_trg ON public.appointments;
CREATE TRIGGER hospitalscope_appointments_trg
  BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');

CREATE OR REPLACE FUNCTION public.validate_appointment_employment_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF OLD.doctor_employment_id IS NULL OR NEW.doctor_employment_id IS NOT DISTINCT FROM OLD.doctor_employment_id THEN
    RETURN NEW;
  END IF;
  IF NEW.doctor_employment_id IS NULL THEN
    RAISE EXCEPTION 'appointments.doctor_employment_id cannot be cleared' USING ERRCODE = '23514';
  END IF;
  IF NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id THEN
    RAISE EXCEPTION 'appointments.doctor_employment_id changes only with a reassignment to another doctor'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.doctor_employments e
     WHERE e.id = NEW.doctor_employment_id
       AND e.doctor_id = NEW.doctor_id
       AND e.hospital_id = OLD.hospital_id
       AND e.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'appointments may be reassigned only to an active employment at the same hospital'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER appointments_employment_change_trg
  BEFORE UPDATE OF doctor_employment_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.validate_appointment_employment_change();
