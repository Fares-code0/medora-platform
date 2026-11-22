-- Phase 21: additive multi-hospital ownership and affiliation model.
-- Existing clinical rows remain unassigned (both scope columns NULL).
-- Do not edit/replay earlier migrations; no ownership backfill occurs here.
BEGIN;

CREATE TABLE public.hospital_departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(300) NOT NULL DEFAULT '',
  status public.active_status NOT NULL DEFAULT 'active',
  catalogue_department_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  deleted_at timestamptz(3),
  CONSTRAINT hospital_departments_pkey PRIMARY KEY (id),
  CONSTRAINT hospital_departments_id_hospital_id_key UNIQUE (id, hospital_id),
  CONSTRAINT hospital_departments_hospital_id_name_key UNIQUE (hospital_id, name),
  CONSTRAINT hospital_departments_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_departments_catalogue_department_id_fkey FOREIGN KEY (catalogue_department_id) REFERENCES public.departments(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX hospital_departments_hospital_status_idx ON public.hospital_departments(hospital_id, status);
CREATE INDEX hospital_departments_catalogue_department_idx ON public.hospital_departments(catalogue_department_id);
CREATE INDEX hospital_departments_deleted_at_idx ON public.hospital_departments(deleted_at);

CREATE TABLE public.clinic_operating_hours (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  day public.weekday NOT NULL,
  open boolean NOT NULL,
  start_time time(0) NOT NULL,
  end_time time(0) NOT NULL,
  break_label varchar(80),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  created_by uuid,
  updated_by uuid,
  CONSTRAINT clinic_operating_hours_pkey PRIMARY KEY (id),
  CONSTRAINT clinic_operating_hours_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT clinic_operating_hours_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT clinic_operating_hours_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT clinic_operating_hours_clinic_day_key UNIQUE (clinic_id, day)
);
CREATE INDEX clinic_operating_hours_clinic_open_idx ON public.clinic_operating_hours(clinic_id, open);

CREATE TABLE public.doctor_employments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL,
  hospital_id uuid NOT NULL,
  hospital_department_id uuid,
  started_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT doctor_employments_pkey PRIMARY KEY (id),
  CONSTRAINT doctor_employments_id_hospital_id_key UNIQUE (id, hospital_id),
  CONSTRAINT doctor_employments_id_hospital_doctor_key UNIQUE (id, hospital_id, doctor_id),
  CONSTRAINT doctor_employments_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT doctor_employments_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT doctor_employments_department_hospital_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT doctor_employments_dates_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX doctor_employments_one_active_per_doctor_key ON public.doctor_employments(doctor_id) WHERE ended_at IS NULL;
CREATE INDEX doctor_employments_hospital_ended_idx ON public.doctor_employments(hospital_id, ended_at);
CREATE INDEX doctor_employments_doctor_started_idx ON public.doctor_employments(doctor_id, started_at DESC);

CREATE TABLE public.hospital_staff_affiliations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  hospital_id uuid NOT NULL,
  hospital_department_id uuid,
  started_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT hospital_staff_affiliations_pkey PRIMARY KEY (id),
  CONSTRAINT hospital_staff_affiliations_id_hospital_id_key UNIQUE (id, hospital_id),
  CONSTRAINT hospital_staff_affiliations_id_hospital_staff_key UNIQUE (id, hospital_id, staff_id),
  CONSTRAINT hospital_staff_affiliations_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff_members(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_staff_affiliations_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_staff_affiliations_department_hospital_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_staff_affiliations_dates_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX hospital_staff_affiliations_one_active_per_hospital_key ON public.hospital_staff_affiliations(staff_id, hospital_id) WHERE ended_at IS NULL;
CREATE INDEX hospital_staff_affiliations_hospital_ended_idx ON public.hospital_staff_affiliations(hospital_id, ended_at);
CREATE INDEX hospital_staff_affiliations_staff_started_idx ON public.hospital_staff_affiliations(staff_id, started_at DESC);

CREATE TABLE public.hospital_role_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  hospital_id uuid NOT NULL,
  role_id uuid NOT NULL,
  source_doctor_employment_id uuid,
  source_staff_affiliation_id uuid,
  granted_by uuid,
  granted_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at timestamptz(3),
  CONSTRAINT hospital_role_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT hospital_role_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_role_assignments_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_role_assignments_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_role_assignments_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT hospital_role_assignments_doctor_employment_fkey FOREIGN KEY (source_doctor_employment_id, hospital_id) REFERENCES public.doctor_employments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_role_assignments_staff_affiliation_fkey FOREIGN KEY (source_staff_affiliation_id, hospital_id) REFERENCES public.hospital_staff_affiliations(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_role_assignments_source_check CHECK (source_doctor_employment_id IS NULL OR source_staff_affiliation_id IS NULL)
);
CREATE UNIQUE INDEX hospital_role_assignments_active_key ON public.hospital_role_assignments(user_id, hospital_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX hospital_role_assignments_hospital_user_revoked_idx ON public.hospital_role_assignments(hospital_id, user_id, revoked_at);
CREATE INDEX hospital_role_assignments_role_idx ON public.hospital_role_assignments(role_id);

CREATE TABLE public.hospital_medical_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  hospital_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT hospital_medical_records_pkey PRIMARY KEY (id),
  CONSTRAINT hospital_medical_records_patient_hospital_key UNIQUE (patient_id, hospital_id),
  CONSTRAINT hospital_medical_records_id_hospital_patient_key UNIQUE (id, hospital_id, patient_id),
  CONSTRAINT hospital_medical_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_medical_records_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX hospital_medical_records_hospital_created_idx ON public.hospital_medical_records(hospital_id, created_at DESC);

CREATE TABLE public.hospital_medical_record_conditions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hospital_medical_record_id uuid NOT NULL,
  hospital_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  condition_id uuid NOT NULL,
  diagnosed_on date,
  recorded_by uuid,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz(3),
  CONSTRAINT hospital_medical_record_conditions_pkey PRIMARY KEY (id),
  CONSTRAINT hospital_medical_record_conditions_record_fkey FOREIGN KEY (hospital_medical_record_id, hospital_id, patient_id) REFERENCES public.hospital_medical_records(id, hospital_id, patient_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_medical_record_conditions_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES public.chronic_conditions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_medical_record_conditions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX hospital_medical_record_conditions_active_key ON public.hospital_medical_record_conditions(hospital_medical_record_id, condition_id) WHERE deleted_at IS NULL;
CREATE INDEX hospital_medical_record_conditions_condition_idx ON public.hospital_medical_record_conditions(condition_id);
CREATE INDEX hospital_medical_record_conditions_hospital_deleted_idx ON public.hospital_medical_record_conditions(hospital_id, deleted_at);

CREATE TABLE public.published_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  doctor_employment_id uuid NOT NULL,
  starts_at timestamptz(3) NOT NULL,
  duration_minutes integer NOT NULL,
  withdrawn_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT published_slots_pkey PRIMARY KEY (id),
  CONSTRAINT published_slots_id_hospital_employment_key UNIQUE (id, hospital_id, doctor_employment_id),
  CONSTRAINT published_slots_employment_hospital_fkey FOREIGN KEY (doctor_employment_id, hospital_id) REFERENCES public.doctor_employments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT published_slots_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT published_slots_duration_check CHECK (duration_minutes > 0)
);
CREATE INDEX published_slots_hospital_starts_idx ON public.published_slots(hospital_id, starts_at);

CREATE TABLE public.hospital_insurance_coverage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  plan_code varchar(60) NOT NULL,
  plan_name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  starts_on date,
  ends_on date,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hospital_insurance_coverage_pkey PRIMARY KEY (id),
  CONSTRAINT hospital_insurance_coverage_plan_key UNIQUE (hospital_id, provider_id, plan_code),
  CONSTRAINT hospital_insurance_coverage_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_insurance_coverage_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.insurance_providers(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT hospital_insurance_coverage_dates_check CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX hospital_insurance_coverage_hospital_active_idx ON public.hospital_insurance_coverage(hospital_id, active);

-- Nullable scope keys preserve every pre-existing row until a verified ownership map exists.
ALTER TABLE public.patient_allergies ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_documents ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_notes ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_medical_history ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_vital_signs ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_clinical_alerts ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_medications ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_studies ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.patient_doctor_assignments ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid, ADD COLUMN doctor_employment_id uuid;
ALTER TABLE public.appointments ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid, ADD COLUMN hospital_department_id uuid, ADD COLUMN doctor_employment_id uuid, ADD COLUMN published_slot_id uuid;
ALTER TABLE public.medical_records ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid, ADD COLUMN hospital_department_id uuid, ADD COLUMN doctor_employment_id uuid;
ALTER TABLE public.lab_orders ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid, ADD COLUMN hospital_department_id uuid, ADD COLUMN doctor_employment_id uuid;
ALTER TABLE public.prescriptions ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid, ADD COLUMN hospital_department_id uuid, ADD COLUMN doctor_employment_id uuid;
ALTER TABLE public.conversations ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.notifications ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.ai_conversations ADD COLUMN hospital_id uuid, ADD COLUMN hospital_medical_record_id uuid;
ALTER TABLE public.doctor_availability ADD COLUMN hospital_id uuid, ADD COLUMN doctor_employment_id uuid;
ALTER TABLE public.doctor_time_off ADD COLUMN hospital_id uuid, ADD COLUMN doctor_employment_id uuid;
ALTER TABLE public.staff_shift_assignments ADD COLUMN hospital_id uuid, ADD COLUMN hospital_staff_affiliation_id uuid;
ALTER TABLE public.rooms ADD COLUMN hospital_id uuid, ADD COLUMN hospital_department_id uuid;
ALTER TABLE public.resources ADD COLUMN hospital_id uuid, ADD COLUMN hospital_department_id uuid;
ALTER TABLE public.audit_events ADD COLUMN hospital_id uuid;
ALTER TABLE public.domain_events ADD COLUMN hospital_id uuid;

-- Preserve legacy global uniqueness while allowing separately owned hospital data.
DROP INDEX public.patient_allergies_patient_id_allergen_key;
CREATE UNIQUE INDEX patient_allergies_legacy_unique ON public.patient_allergies(patient_id, allergen) WHERE hospital_medical_record_id IS NULL;
CREATE UNIQUE INDEX patient_allergies_hospital_unique ON public.patient_allergies(hospital_medical_record_id, allergen) WHERE hospital_medical_record_id IS NOT NULL;
DROP INDEX public.staff_shift_assignments_staff_id_kind_key;
DROP INDEX public.doctor_availability_doctor_id_weekday_start_time_key;
CREATE UNIQUE INDEX doctor_availability_legacy_unique ON public.doctor_availability(doctor_id, weekday, start_time) WHERE doctor_employment_id IS NULL;
CREATE UNIQUE INDEX doctor_availability_employment_unique ON public.doctor_availability(doctor_employment_id, weekday, start_time) WHERE doctor_employment_id IS NOT NULL;
DROP INDEX public.rooms_name_key;
CREATE UNIQUE INDEX rooms_legacy_name_key ON public.rooms(name) WHERE hospital_id IS NULL;
CREATE UNIQUE INDEX rooms_hospital_name_key ON public.rooms(hospital_id, name) WHERE hospital_id IS NOT NULL;
CREATE UNIQUE INDEX staff_shift_assignments_legacy_unique ON public.staff_shift_assignments(staff_id, kind) WHERE hospital_staff_affiliation_id IS NULL;
CREATE UNIQUE INDEX staff_shift_assignments_hospital_unique ON public.staff_shift_assignments(staff_id, hospital_id, kind) WHERE hospital_staff_affiliation_id IS NOT NULL;

-- Scope pairing checks. A partial scope cannot be stored, and optional-patient
-- communication rows need a patient before they may be assigned an HMR.
DO $scope_constraints$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_allergies','patient_documents','patient_notes','patient_medical_history','patient_vital_signs','patient_clinical_alerts','patient_medications','patient_studies','patient_doctor_assignments','appointments','medical_records','lab_orders','prescriptions','conversations','notifications','ai_conversations']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((hospital_id IS NULL) = (hospital_medical_record_id IS NULL) AND (hospital_id IS NULL OR patient_id IS NOT NULL))', t, t || '_hospital_scope_pair_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (hospital_medical_record_id, hospital_id, patient_id) REFERENCES public.hospital_medical_records(id, hospital_id, patient_id) ON DELETE RESTRICT ON UPDATE CASCADE', t, t || '_hospital_medical_record_fkey');
    EXECUTE format('CREATE INDEX %I ON public.%I(hospital_id, hospital_medical_record_id) WHERE hospital_id IS NOT NULL', t || '_hospital_scope_idx', t);
  END LOOP;
END
$scope_constraints$;

ALTER TABLE public.rooms ADD CONSTRAINT rooms_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_hospital_department_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.rooms ADD CONSTRAINT rooms_hospital_department_scope_check CHECK (hospital_department_id IS NULL OR hospital_id IS NOT NULL);
ALTER TABLE public.resources ADD CONSTRAINT resources_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.resources ADD CONSTRAINT resources_hospital_department_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.resources ADD CONSTRAINT resources_hospital_department_scope_check CHECK (hospital_department_id IS NULL OR hospital_id IS NOT NULL);
CREATE INDEX rooms_hospital_department_idx ON public.rooms(hospital_id, hospital_department_id);
CREATE INDEX resources_hospital_department_idx ON public.resources(hospital_id, hospital_department_id);

ALTER TABLE public.appointments ADD CONSTRAINT appointments_hospital_department_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.medical_records ADD CONSTRAINT medical_records_hospital_department_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.lab_orders ADD CONSTRAINT lab_orders_hospital_department_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_hospital_department_fkey FOREIGN KEY (hospital_department_id, hospital_id) REFERENCES public.hospital_departments(id, hospital_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX appointments_hospital_department_idx ON public.appointments(hospital_id, hospital_department_id);
CREATE INDEX medical_records_hospital_department_idx ON public.medical_records(hospital_id, hospital_department_id);
CREATE INDEX lab_orders_hospital_department_idx ON public.lab_orders(hospital_id, hospital_department_id);
CREATE INDEX prescriptions_hospital_department_idx ON public.prescriptions(hospital_id, hospital_department_id);

ALTER TABLE public.doctor_availability ADD CONSTRAINT doctor_availability_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, doctor_id) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.doctor_availability ADD CONSTRAINT doctor_availability_hospital_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.doctor_time_off ADD CONSTRAINT doctor_time_off_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, doctor_id) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.doctor_time_off ADD CONSTRAINT doctor_time_off_hospital_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.staff_shift_assignments ADD CONSTRAINT staff_shift_assignments_affiliation_fkey FOREIGN KEY (hospital_staff_affiliation_id, hospital_id, staff_id) REFERENCES public.hospital_staff_affiliations(id, hospital_id, staff_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.staff_shift_assignments ADD CONSTRAINT staff_shift_assignments_hospital_scope_check CHECK ((hospital_id IS NULL) = (hospital_staff_affiliation_id IS NULL));
CREATE INDEX doctor_availability_employment_idx ON public.doctor_availability(doctor_employment_id);
CREATE INDEX doctor_time_off_employment_idx ON public.doctor_time_off(doctor_employment_id);
CREATE INDEX staff_shift_assignments_affiliation_idx ON public.staff_shift_assignments(hospital_staff_affiliation_id);
CREATE INDEX appointments_hospital_employment_idx ON public.appointments(hospital_id, doctor_employment_id);
CREATE INDEX appointments_published_slot_idx ON public.appointments(published_slot_id);
CREATE INDEX hospital_role_assignments_doctor_source_idx ON public.hospital_role_assignments(source_doctor_employment_id);
CREATE INDEX hospital_role_assignments_staff_source_idx ON public.hospital_role_assignments(source_staff_affiliation_id);
CREATE INDEX audit_events_hospital_occurred_idx ON public.audit_events(hospital_id, occurred_at DESC);
CREATE INDEX domain_events_hospital_created_idx ON public.domain_events(hospital_id, created_at);
CREATE INDEX published_slots_employment_starts_idx ON public.published_slots(doctor_employment_id, starts_at);

ALTER TABLE public.appointments ADD CONSTRAINT appointments_doctor_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, doctor_id) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.patient_doctor_assignments ADD CONSTRAINT patient_doctor_assignments_doctor_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, doctor_id) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.patient_doctor_assignments ADD CONSTRAINT patient_doctor_assignments_employment_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.medical_records ADD CONSTRAINT medical_records_doctor_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, doctor_id) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.medical_records ADD CONSTRAINT medical_records_employment_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.lab_orders ADD CONSTRAINT lab_orders_doctor_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, ordered_by) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.lab_orders ADD CONSTRAINT lab_orders_employment_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_doctor_employment_fkey FOREIGN KEY (doctor_employment_id, hospital_id, prescribing_doctor_id) REFERENCES public.doctor_employments(id, hospital_id, doctor_id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_employment_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.appointments ADD CONSTRAINT appointments_employment_scope_check CHECK ((hospital_id IS NULL) = (doctor_employment_id IS NULL));
ALTER TABLE public.appointments ADD CONSTRAINT appointments_published_slot_fkey FOREIGN KEY (published_slot_id, hospital_id, doctor_employment_id) REFERENCES public.published_slots(id, hospital_id, doctor_employment_id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX appointments_one_active_booking_per_slot ON public.appointments(published_slot_id) WHERE published_slot_id IS NOT NULL AND status NOT IN ('cancelled', 'rescheduled', 'completed', 'no-show');

ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.domain_events ADD CONSTRAINT domain_events_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Employment/affiliation-sourced permissions are revoked only for the ended
-- relationship. Independent grants and access at other hospitals remain intact.
CREATE FUNCTION public.revoke_ended_hospital_affiliation_roles()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $revoke$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
    IF TG_TABLE_NAME = 'doctor_employments' THEN
      UPDATE public.hospital_role_assignments SET revoked_at = CURRENT_TIMESTAMP
       WHERE hospital_id = NEW.hospital_id AND revoked_at IS NULL AND source_doctor_employment_id = NEW.id;
    ELSE
      UPDATE public.hospital_role_assignments SET revoked_at = CURRENT_TIMESTAMP
       WHERE hospital_id = NEW.hospital_id AND revoked_at IS NULL AND source_staff_affiliation_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END
$revoke$;
CREATE TRIGGER doctor_employment_revoke_roles_trg
  AFTER UPDATE OF ended_at ON public.doctor_employments
  FOR EACH ROW EXECUTE FUNCTION public.revoke_ended_hospital_affiliation_roles();
CREATE TRIGGER hospital_staff_affiliation_revoke_roles_trg
  AFTER UPDATE OF ended_at ON public.hospital_staff_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.revoke_ended_hospital_affiliation_roles();

-- The source relationship must identify the same account that receives the grant.
CREATE FUNCTION public.validate_hospital_role_assignment_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $role_source$
DECLARE source_user uuid; source_active boolean;
BEGIN
  IF NEW.source_doctor_employment_id IS NOT NULL THEN
    SELECT d.user_id, e.ended_at IS NULL INTO source_user, source_active
      FROM public.doctor_employments e JOIN public.doctors d ON d.id = e.doctor_id
     WHERE e.id = NEW.source_doctor_employment_id AND e.hospital_id = NEW.hospital_id FOR UPDATE OF e;
  ELSIF NEW.source_staff_affiliation_id IS NOT NULL THEN
    SELECT s.user_id, a.ended_at IS NULL INTO source_user, source_active
      FROM public.hospital_staff_affiliations a JOIN public.staff_members s ON s.id = a.staff_id
     WHERE a.id = NEW.source_staff_affiliation_id AND a.hospital_id = NEW.hospital_id FOR UPDATE OF a;
  ELSE
    RETURN NEW;
  END IF;
  IF source_user IS NULL OR source_user <> NEW.user_id OR source_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Hospital role assignment user must match an active source affiliation'
      USING ERRCODE = '23514', CONSTRAINT = 'hospital_role_assignment_source_user_check';
  END IF;
  RETURN NEW;
END
$role_source$;
CREATE TRIGGER hospital_role_assignment_source_trg
  BEFORE INSERT OR UPDATE OF user_id, hospital_id, source_doctor_employment_id, source_staff_affiliation_id
  ON public.hospital_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_hospital_role_assignment_source();

-- When both sides are tenant-scoped, links through an existing parent must
-- remain inside the same hospital record. Legacy NULL-scope rows keep old behavior.
CREATE FUNCTION public.validate_scoped_clinical_links()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $scoped_links$
DECLARE target_scope record; target_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'patient_medications' AND NEW.prescription_id IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.prescriptions WHERE id = NEW.prescription_id;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR NEW.hospital_medical_record_id IS NOT NULL) AND
        (target_scope.patient_id IS DISTINCT FROM NEW.patient_id OR target_scope.hospital_id IS DISTINCT FROM NEW.hospital_id OR target_scope.hospital_medical_record_id IS DISTINCT FROM NEW.hospital_medical_record_id)) THEN
      RAISE EXCEPTION 'Medication prescription must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'patient_medications_prescription_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'patient_studies' AND NEW.lab_order_id IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.lab_orders WHERE id = NEW.lab_order_id;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR NEW.hospital_medical_record_id IS NOT NULL) AND
        (target_scope.patient_id IS DISTINCT FROM NEW.patient_id OR target_scope.hospital_id IS DISTINCT FROM NEW.hospital_id OR target_scope.hospital_medical_record_id IS DISTINCT FROM NEW.hospital_medical_record_id)) THEN
      RAISE EXCEPTION 'Study lab order must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'patient_studies_lab_order_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'medical_records' AND NEW.appointment_id IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.appointments WHERE id = NEW.appointment_id;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR NEW.hospital_medical_record_id IS NOT NULL) AND
        (target_scope.patient_id IS DISTINCT FROM NEW.patient_id OR target_scope.hospital_id IS DISTINCT FROM NEW.hospital_id OR target_scope.hospital_medical_record_id IS DISTINCT FROM NEW.hospital_medical_record_id)) THEN
      RAISE EXCEPTION 'Encounter appointment must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'medical_records_appointment_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'patient_vital_signs' AND NEW.record_id IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.medical_records WHERE id = NEW.record_id;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR NEW.hospital_medical_record_id IS NOT NULL) AND
        (target_scope.patient_id IS DISTINCT FROM NEW.patient_id OR target_scope.hospital_id IS DISTINCT FROM NEW.hospital_id OR target_scope.hospital_medical_record_id IS DISTINCT FROM NEW.hospital_medical_record_id)) THEN
      RAISE EXCEPTION 'Vital sign encounter must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'patient_vital_signs_record_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME IN ('lab_orders','prescriptions') AND NEW.record_id IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.medical_records WHERE id = NEW.record_id;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR NEW.hospital_medical_record_id IS NOT NULL) AND
        (target_scope.patient_id IS DISTINCT FROM NEW.patient_id OR target_scope.hospital_id IS DISTINCT FROM NEW.hospital_id OR target_scope.hospital_medical_record_id IS DISTINCT FROM NEW.hospital_medical_record_id)) THEN
      RAISE EXCEPTION 'Clinical order encounter must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'clinical_order_record_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    IF NEW.record_id IS NOT NULL THEN target_id := NEW.record_id;
      SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.medical_records WHERE id = target_id;
    ELSIF NEW.lab_order_id IS NOT NULL THEN target_id := NEW.lab_order_id;
      SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.lab_orders WHERE id = target_id;
    ELSIF NEW.prescription_id IS NOT NULL THEN target_id := NEW.prescription_id;
      SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.prescriptions WHERE id = target_id;
    ELSIF NEW.appointment_id IS NOT NULL THEN target_id := NEW.appointment_id;
      SELECT hospital_id, hospital_medical_record_id, patient_id INTO target_scope FROM public.appointments WHERE id = target_id;
    ELSE RETURN NEW;
    END IF;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR NEW.hospital_medical_record_id IS NOT NULL) AND
        (target_scope.patient_id IS DISTINCT FROM NEW.patient_id OR target_scope.hospital_id IS DISTINCT FROM NEW.hospital_id OR target_scope.hospital_medical_record_id IS DISTINCT FROM NEW.hospital_medical_record_id)) THEN
      RAISE EXCEPTION 'Notification target must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'notifications_target_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END
$scoped_links$;
CREATE TRIGGER patient_medications_scoped_link_trg BEFORE INSERT OR UPDATE OF prescription_id, hospital_id, hospital_medical_record_id ON public.patient_medications FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();
CREATE TRIGGER patient_studies_scoped_link_trg BEFORE INSERT OR UPDATE OF lab_order_id, hospital_id, hospital_medical_record_id ON public.patient_studies FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();
CREATE TRIGGER medical_records_scoped_link_trg BEFORE INSERT OR UPDATE OF appointment_id, hospital_id, hospital_medical_record_id ON public.medical_records FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();
CREATE TRIGGER patient_vital_signs_scoped_link_trg BEFORE INSERT OR UPDATE OF record_id, hospital_id, hospital_medical_record_id ON public.patient_vital_signs FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();
CREATE TRIGGER lab_orders_scoped_link_trg BEFORE INSERT OR UPDATE OF record_id, hospital_id, hospital_medical_record_id ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();
CREATE TRIGGER prescriptions_scoped_link_trg BEFORE INSERT OR UPDATE OF record_id, hospital_id, hospital_medical_record_id ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();
CREATE TRIGGER notifications_scoped_link_trg BEFORE INSERT OR UPDATE OF record_id, lab_order_id, prescription_id, appointment_id, hospital_id, hospital_medical_record_id ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.validate_scoped_clinical_links();

CREATE FUNCTION public.validate_active_published_slot()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $slot$
DECLARE ended timestamptz;
BEGIN
  IF NEW.withdrawn_at IS NULL THEN
    SELECT ended_at INTO ended FROM public.doctor_employments
     WHERE id = NEW.doctor_employment_id AND hospital_id = NEW.hospital_id FOR UPDATE;
    IF NOT FOUND OR ended IS NOT NULL THEN
      RAISE EXCEPTION 'Published slot requires an active hospital employment'
        USING ERRCODE = '23514', CONSTRAINT = 'published_slots_active_employment_check';
    END IF;
  END IF;
  RETURN NEW;
END
$slot$;
CREATE TRIGGER published_slots_active_employment_trg BEFORE INSERT OR UPDATE OF doctor_employment_id, hospital_id ON public.published_slots FOR EACH ROW EXECUTE FUNCTION public.validate_active_published_slot();

CREATE FUNCTION public.validate_active_appointment_employment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $appointment$
DECLARE ended timestamptz; slot_start timestamptz; slot_duration integer; slot_withdrawn timestamptz;
BEGIN
  IF NEW.hospital_id IS NULL THEN RETURN NEW; END IF;
  SELECT ended_at INTO ended FROM public.doctor_employments
   WHERE id = NEW.doctor_employment_id AND hospital_id = NEW.hospital_id AND doctor_id = NEW.doctor_id FOR UPDATE;
  IF NOT FOUND OR ended IS NOT NULL THEN
    RAISE EXCEPTION 'Hospital appointment requires an active matching doctor employment'
      USING ERRCODE = '23514', CONSTRAINT = 'appointments_active_employment_check';
  END IF;
  IF NEW.published_slot_id IS NOT NULL THEN
    SELECT starts_at, duration_minutes, withdrawn_at INTO slot_start, slot_duration, slot_withdrawn
      FROM public.published_slots
     WHERE id = NEW.published_slot_id AND hospital_id = NEW.hospital_id AND doctor_employment_id = NEW.doctor_employment_id FOR UPDATE;
    IF NOT FOUND OR slot_withdrawn IS NOT NULL OR slot_start <> NEW.starts_at OR slot_duration <> NEW.duration_min THEN
      RAISE EXCEPTION 'Appointment must use an available matching published slot'
        USING ERRCODE = '23514', CONSTRAINT = 'appointments_published_slot_available_check';
    END IF;
  END IF;
  RETURN NEW;
END
$appointment$;
CREATE TRIGGER appointments_active_employment_trg BEFORE INSERT OR UPDATE OF hospital_id, doctor_employment_id, published_slot_id, starts_at, duration_min ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.validate_active_appointment_employment();


-- A clinical document/file must be owned by the same hospital as its clinical parent.
CREATE FUNCTION public.validate_clinical_file_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $file_owner$
DECLARE parent_hospital uuid; file_hospital uuid;
BEGIN
  IF TG_TABLE_NAME = 'patient_documents' THEN
    parent_hospital := NEW.hospital_id;
    SELECT hospital_id INTO file_hospital FROM public.files WHERE id = NEW.file_id;
  ELSIF TG_TABLE_NAME = 'record_attachments' THEN
    SELECT hospital_id INTO parent_hospital FROM public.medical_records WHERE id = NEW.record_id;
    SELECT hospital_id INTO file_hospital FROM public.files WHERE id = NEW.file_id;
  ELSIF TG_TABLE_NAME = 'lab_attachments' THEN
    SELECT hospital_id INTO parent_hospital FROM public.lab_orders WHERE id = NEW.lab_order_id;
    SELECT hospital_id INTO file_hospital FROM public.files WHERE id = NEW.file_id;
  ELSE
    SELECT c.hospital_id INTO parent_hospital FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE m.id = NEW.message_id;
    SELECT hospital_id INTO file_hospital FROM public.files WHERE id = NEW.file_id;
  END IF;
  IF parent_hospital IS DISTINCT FROM file_hospital THEN
    RAISE EXCEPTION 'Clinical attachment file must belong to the parent hospital'
      USING ERRCODE = '23514', CONSTRAINT = 'clinical_attachment_file_hospital_check';
  END IF;
  RETURN NEW;
END
$file_owner$;
CREATE TRIGGER patient_documents_file_owner_trg BEFORE INSERT OR UPDATE OF file_id, hospital_id ON public.patient_documents FOR EACH ROW EXECUTE FUNCTION public.validate_clinical_file_owner();
CREATE TRIGGER record_attachments_file_owner_trg BEFORE INSERT OR UPDATE OF file_id, record_id ON public.record_attachments FOR EACH ROW EXECUTE FUNCTION public.validate_clinical_file_owner();
CREATE TRIGGER lab_attachments_file_owner_trg BEFORE INSERT OR UPDATE OF file_id, lab_order_id ON public.lab_attachments FOR EACH ROW EXECUTE FUNCTION public.validate_clinical_file_owner();
CREATE TRIGGER message_attachments_file_owner_trg BEFORE INSERT OR UPDATE OF file_id, message_id ON public.message_attachments FOR EACH ROW EXECUTE FUNCTION public.validate_clinical_file_owner();

CREATE FUNCTION public.prevent_attached_file_reassignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $file_lock$
BEGIN
  IF OLD.hospital_id IS DISTINCT FROM NEW.hospital_id AND (
    EXISTS (SELECT 1 FROM public.patient_documents WHERE file_id = OLD.id) OR
    EXISTS (SELECT 1 FROM public.record_attachments WHERE file_id = OLD.id) OR
    EXISTS (SELECT 1 FROM public.lab_attachments WHERE file_id = OLD.id) OR
    EXISTS (SELECT 1 FROM public.message_attachments WHERE file_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'A file owner cannot change after it is attached'
      USING ERRCODE = '23514', CONSTRAINT = 'files_attached_owner_immutable_check';
  END IF;
  RETURN NEW;
END
$file_lock$;
CREATE TRIGGER files_attached_owner_immutable_trg BEFORE UPDATE OF hospital_id ON public.files FOR EACH ROW EXECUTE FUNCTION public.prevent_attached_file_reassignment();

C-- Once a tenant owner is assigned, changing that owner in place is not a transfer workflow.
-- A future verified ownership correction must use a separately reviewed process.
CREATE FUNCTION public.prevent_tenant_scope_reassignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $scope_immutable$
DECLARE old_row jsonb := to_jsonb(OLD); new_row jsonb := to_jsonb(NEW); field_name text; old_value text; new_value text;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    old_value := old_row ->> field_name;
    new_value := new_row ->> field_name;
    IF old_value IS NOT NULL AND old_value IS DISTINCT FROM new_value THEN
      RAISE EXCEPTION 'Assigned tenant key % on %.% cannot be changed in place', field_name, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END
$scope_immutable$;

CREATE TRIGGER hospitalscope_clinic_trg BEFORE UPDATE OF hospital_id ON public.clinics FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_location_trg BEFORE UPDATE OF hospital_id ON public.hospital_locations FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_department_trg BEFORE UPDATE OF hospital_id ON public.hospital_departments FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_employment_trg BEFORE UPDATE OF hospital_id ON public.doctor_employments FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_staff_affiliation_trg BEFORE UPDATE OF hospital_id ON public.hospital_staff_affiliations FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_role_assignment_trg BEFORE UPDATE OF hospital_id ON public.hospital_role_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_medical_record_trg BEFORE UPDATE OF patient_id, hospital_id ON public.hospital_medical_records FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('patient_id', 'hospital_id');
CREATE TRIGGER hospitalscope_condition_trg BEFORE UPDATE OF hospital_medical_record_id, hospital_id, patient_id ON public.hospital_medical_record_conditions FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_medical_record_id', 'hospital_id', 'patient_id');
CREATE TRIGGER hospitalscope_slot_trg BEFORE UPDATE OF hospital_id, doctor_employment_id ON public.published_slots FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_insurance_trg BEFORE UPDATE OF hospital_id ON public.hospital_insurance_coverage FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_clinic_hours_trg BEFORE UPDATE OF clinic_id ON public.clinic_operating_hours FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('clinic_id');
CREATE TRIGGER hospitalscope_room_trg BEFORE UPDATE OF hospital_id ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_resource_trg BEFORE UPDATE OF hospital_id ON public.resources FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_patient_allergies_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_allergies FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_documents_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_documents FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_notes_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_notes FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_history_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_medical_history FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_vitals_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_vital_signs FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_alerts_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_clinical_alerts FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_medications_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_medications FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_studies_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.patient_studies FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_patient_assignments_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id, doctor_employment_id ON public.patient_doctor_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_appointments_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id, doctor_employment_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_encounters_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id, doctor_employment_id ON public.medical_records FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_lab_orders_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id, doctor_employment_id ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_prescriptions_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id, doctor_employment_id ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_conversations_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_notifications_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_ai_conversations_trg BEFORE UPDATE OF hospital_id, hospital_medical_record_id ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_medical_record_id');
CREATE TRIGGER hospitalscope_availability_trg BEFORE UPDATE OF hospital_id, doctor_employment_id ON public.doctor_availability FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_time_off_trg BEFORE UPDATE OF hospital_id, doctor_employment_id ON public.doctor_time_off FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'doctor_employment_id');
CREATE TRIGGER hospitalscope_shift_trg BEFORE UPDATE OF hospital_id, hospital_staff_affiliation_id ON public.staff_shift_assignments FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id', 'hospital_staff_affiliation_id');
CREATE TRIGGER hospitalscope_files_trg BEFORE UPDATE OF hospital_id ON public.files FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_audit_events_trg BEFORE UPDATE OF hospital_id ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');
CREATE TRIGGER hospitalscope_domain_events_trg BEFORE UPDATE OF hospital_id ON public.domain_events FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_scope_reassignment('hospital_id');

COMMIT;
