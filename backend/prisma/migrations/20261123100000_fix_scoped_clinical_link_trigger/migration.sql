-- The original generic trigger function accessed NEW fields that do not exist on
-- every table using the trigger (for example, medical_records has no
-- prescription_id). Convert the trigger row to JSON so table-specific fields
-- can be inspected safely, while preserving the existing tenant checks.
CREATE OR REPLACE FUNCTION public.validate_scoped_clinical_links()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $scoped_links$
DECLARE
  new_row jsonb := to_jsonb(NEW);
  target_scope record;
  target_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'patient_medications' AND new_row ->> 'prescription_id' IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id
      INTO target_scope FROM public.prescriptions
     WHERE id = (new_row ->> 'prescription_id')::uuid;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR new_row ->> 'hospital_medical_record_id' IS NOT NULL) AND
        (target_scope.patient_id::text IS DISTINCT FROM new_row ->> 'patient_id' OR
         target_scope.hospital_id::text IS DISTINCT FROM new_row ->> 'hospital_id' OR
         target_scope.hospital_medical_record_id::text IS DISTINCT FROM new_row ->> 'hospital_medical_record_id')) THEN
      RAISE EXCEPTION 'Medication prescription must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'patient_medications_prescription_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'patient_studies' AND new_row ->> 'lab_order_id' IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id
      INTO target_scope FROM public.lab_orders
     WHERE id = (new_row ->> 'lab_order_id')::uuid;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR new_row ->> 'hospital_medical_record_id' IS NOT NULL) AND
        (target_scope.patient_id::text IS DISTINCT FROM new_row ->> 'patient_id' OR
         target_scope.hospital_id::text IS DISTINCT FROM new_row ->> 'hospital_id' OR
         target_scope.hospital_medical_record_id::text IS DISTINCT FROM new_row ->> 'hospital_medical_record_id')) THEN
      RAISE EXCEPTION 'Study lab order must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'patient_studies_lab_order_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'medical_records' AND new_row ->> 'appointment_id' IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id
      INTO target_scope FROM public.appointments
     WHERE id = (new_row ->> 'appointment_id')::uuid;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR new_row ->> 'hospital_medical_record_id' IS NOT NULL) AND
        (target_scope.patient_id::text IS DISTINCT FROM new_row ->> 'patient_id' OR
         target_scope.hospital_id::text IS DISTINCT FROM new_row ->> 'hospital_id' OR
         target_scope.hospital_medical_record_id::text IS DISTINCT FROM new_row ->> 'hospital_medical_record_id')) THEN
      RAISE EXCEPTION 'Encounter appointment must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'medical_records_appointment_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'patient_vital_signs' AND new_row ->> 'record_id' IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id
      INTO target_scope FROM public.medical_records
     WHERE id = (new_row ->> 'record_id')::uuid;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR new_row ->> 'hospital_medical_record_id' IS NOT NULL) AND
        (target_scope.patient_id::text IS DISTINCT FROM new_row ->> 'patient_id' OR
         target_scope.hospital_id::text IS DISTINCT FROM new_row ->> 'hospital_id' OR
         target_scope.hospital_medical_record_id::text IS DISTINCT FROM new_row ->> 'hospital_medical_record_id')) THEN
      RAISE EXCEPTION 'Vital sign encounter must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'patient_vital_signs_record_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'prescriptions' AND new_row ->> 'record_id' IS NOT NULL THEN
    SELECT hospital_id, hospital_medical_record_id, patient_id
      INTO target_scope FROM public.medical_records
     WHERE id = (new_row ->> 'record_id')::uuid;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR new_row ->> 'hospital_medical_record_id' IS NOT NULL) AND
        (target_scope.patient_id::text IS DISTINCT FROM new_row ->> 'patient_id' OR
         target_scope.hospital_id::text IS DISTINCT FROM new_row ->> 'hospital_id' OR
         target_scope.hospital_medical_record_id::text IS DISTINCT FROM new_row ->> 'hospital_medical_record_id')) THEN
      RAISE EXCEPTION 'Clinical order encounter must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'clinical_order_record_scope_check';
    END IF;
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    IF new_row ->> 'record_id' IS NOT NULL THEN
      target_id := (new_row ->> 'record_id')::uuid;
      SELECT hospital_id, hospital_medical_record_id, patient_id
        INTO target_scope FROM public.medical_records WHERE id = target_id;
    ELSIF new_row ->> 'lab_order_id' IS NOT NULL THEN
      target_id := (new_row ->> 'lab_order_id')::uuid;
      SELECT hospital_id, hospital_medical_record_id, patient_id
        INTO target_scope FROM public.lab_orders WHERE id = target_id;
    ELSIF new_row ->> 'prescription_id' IS NOT NULL THEN
      target_id := (new_row ->> 'prescription_id')::uuid;
      SELECT hospital_id, hospital_medical_record_id, patient_id
        INTO target_scope FROM public.prescriptions WHERE id = target_id;
    ELSIF new_row ->> 'appointment_id' IS NOT NULL THEN
      target_id := (new_row ->> 'appointment_id')::uuid;
      SELECT hospital_id, hospital_medical_record_id, patient_id
        INTO target_scope FROM public.appointments WHERE id = target_id;
    ELSE
      RETURN NEW;
    END IF;
    IF NOT FOUND OR
       ((target_scope.hospital_medical_record_id IS NOT NULL OR new_row ->> 'hospital_medical_record_id' IS NOT NULL) AND
        (target_scope.patient_id::text IS DISTINCT FROM new_row ->> 'patient_id' OR
         target_scope.hospital_id::text IS DISTINCT FROM new_row ->> 'hospital_id' OR
         target_scope.hospital_medical_record_id::text IS DISTINCT FROM new_row ->> 'hospital_medical_record_id')) THEN
      RAISE EXCEPTION 'Notification target must belong to the same patient and hospital medical record'
        USING ERRCODE = '23514', CONSTRAINT = 'notifications_target_scope_check';
    END IF;
  END IF;
  RETURN NEW;
END
$scoped_links$;
