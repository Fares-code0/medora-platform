-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL ONLY — NOT A MIGRATION. NOTHING APPLIES THIS FILE TO A DATABASE.
-- ════════════════════════════════════════════════════════════════════════
--
-- Phase 22 Row-Level Security design (docs/multi-hospital/RLS_DESIGN.md).
-- `backend/test/rls-proposal.e2e-spec.ts` executes this file inside a
-- transaction that is always rolled back, as a temporary non-owner role, to
-- prove how PostgreSQL behaves under the proposed policies. It is kept here
-- (not in prisma/migrations/) so the design and its tests cannot drift.
--
-- Activation is blocked (RLS_DESIGN.md §6) on:
--   1. the Backend↔PostgreSQL tenant-context contract — the GUC name
--      `app.hospital_id` below is a PLACEHOLDER pending that decision;
--   2. a dedicated non-owner, non-superuser application role (today the
--      application connects as the table owner, which bypasses RLS);
--   3. an ownership decision for legacy rows whose hospital_id is NULL
--      (this proposal makes them invisible to scoped sessions);
--   4. OD-07 — any Platform Admin / Hospital Admin policy.
--
-- Representative tables only, one per ownership pattern; the full coverage
-- inventory is RLS_DESIGN.md §3.

CREATE SCHEMA IF NOT EXISTS app_rls;

-- The tenant context, read transaction-locally. Missing, empty or malformed
-- context yields NULL, and every policy below compares with `=`, so a NULL
-- context matches no row: fail closed.
CREATE OR REPLACE FUNCTION app_rls.current_hospital_id() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $fn$
DECLARE
  raw text := current_setting('app.hospital_id', true);
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$fn$;

-- DB-1 / F4: the one hospital a doctor may act for — an active employment, a
-- doctor profile that is not soft-deleted and whose practice is not
-- suspended, at an ACTIVE, non-deleted hospital. Allow-list on
-- practice_status ('active', 'vacation'); whether VACATION or an unverified
-- doctor should yield clinical context is an open policy question
-- (RLS_DESIGN.md §6). History is untouched: ended employments simply do not
-- match.
CREATE OR REPLACE FUNCTION app_rls.effective_doctor_hospital(p_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT e.hospital_id
    FROM public.doctor_employments e
    JOIN public.doctors d ON d.id = e.doctor_id
    JOIN public.hospitals h ON h.id = e.hospital_id
   WHERE d.user_id = p_user_id
     AND d.deleted_at IS NULL
     AND d.practice_status IN ('active', 'vacation')
     AND e.ended_at IS NULL
     AND h.status = 'ACTIVE'
     AND h.deleted_at IS NULL
$fn$;

-- ── Coverage: every Direct and Indirect table of RLS_DESIGN.md Appendix A ──
-- One policy per table, FOR ALL (SELECT, UPDATE, DELETE through USING; INSERT
-- and UPDATE through WITH CHECK). Policies are created for every role subject
-- to RLS; the owner/superuser bypasses them (RLS_DESIGN.md §1, test 10).

-- Pattern 1 — direct ownership: the row carries hospital_id (33 tables; the
-- tenant table `hospitals` is keyed by id; the two system tables
-- audit_events / domain_events are deliberately excluded, see §3.3).
DO $direct$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments','lab_orders','medical_records','patient_doctor_assignments','prescriptions',
    'ai_conversations','conversations','hospital_medical_record_conditions','notifications',
    'patient_allergies','patient_clinical_alerts','patient_documents','patient_medical_history',
    'patient_medications','patient_notes','patient_studies','patient_vital_signs',
    'hospital_medical_records','files',
    'clinics','hospital_locations','hospital_departments','hospital_insurance_coverage','rooms',
    'resources','staff_shift_assignments','hospital_staff_affiliations','hospital_role_assignments',
    'doctor_employments','doctor_availability','doctor_time_off','published_slots',
    'queue_entries','waiting_room_entries']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (hospital_id = app_rls.current_hospital_id()) WITH CHECK (hospital_id = app_rls.current_hospital_id())',
      t || '_tenant', t);
  END LOOP;
END
$direct$;

ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY hospitals_tenant ON public.hospitals FOR ALL
  USING (id = app_rls.current_hospital_id())
  WITH CHECK (id = app_rls.current_hospital_id());

-- Pattern 2 — indirect ownership through one parent carrying hospital_id.
-- The parent's own policy also applies inside the subquery.
DO $indirect$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('record_allergies','record_id','medical_records'),('record_attachments','record_id','medical_records'),
    ('record_diagnoses','record_id','medical_records'),('record_issue_reports','record_id','medical_records'),
    ('record_medications','record_id','medical_records'),('record_notes','record_id','medical_records'),
    ('record_timeline_events','record_id','medical_records'),('record_treatment_plan_items','record_id','medical_records'),
    ('record_versions','record_id','medical_records'),
    ('lab_results','lab_order_id','lab_orders'),('lab_specimens','lab_order_id','lab_orders'),
    ('lab_attachments','lab_order_id','lab_orders'),('lab_timeline_events','lab_order_id','lab_orders'),
    ('prescription_history_entries','prescription_id','prescriptions'),('prescription_notes','prescription_id','prescriptions'),
    ('prescription_safety_warnings','prescription_id','prescriptions'),('prescription_timeline_events','prescription_id','prescriptions'),
    ('appointment_events','appointment_id','appointments'),('appointment_reschedule_proposals','appointment_id','appointments'),
    ('ai_messages','conversation_id','ai_conversations'),
    ('messages','conversation_id','conversations'),('conversation_participants','conversation_id','conversations'),
    ('conversation_shared_links','conversation_id','conversations'),('communication_access_requests','conversation_id','conversations'),
    ('notification_deliveries','notification_id','notifications'),('report_exports','file_id','files'),
    ('clinic_operating_hours','clinic_id','clinics')
  ) AS m(child, fk, parent)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I AND p.hospital_id = app_rls.current_hospital_id())) WITH CHECK (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I AND p.hospital_id = app_rls.current_hospital_id()))',
      r.child || '_via_' || r.parent, r.child, r.parent, r.fk, r.parent, r.fk);
  END LOOP;
END
$indirect$;

-- Pattern 2b — two levels: message → conversation.
DO $two_level$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_attachments','message_flags'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE m.id = message_id AND c.hospital_id = app_rls.current_hospital_id())) WITH CHECK (EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE m.id = message_id AND c.hospital_id = app_rls.current_hospital_id()))',
      t || '_via_conversation', t);
  END LOOP;
END
$two_level$;

-- Pattern 3 — global patient identity (DR-03): visible and updatable where the
-- context hospital holds a HospitalMedicalRecord for the patient. No INSERT
-- policy for `patients`: a new patient has no record yet at insert time, so
-- creating one needs a decided flow (RLS_DESIGN.md §6, B8) — denied until then.
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_with_record_select ON public.patients FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.hospital_medical_records h
                  WHERE h.patient_id = patients.id AND h.hospital_id = app_rls.current_hospital_id()));
CREATE POLICY patients_with_record_update ON public.patients FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.hospital_medical_records h
                  WHERE h.patient_id = patients.id AND h.hospital_id = app_rls.current_hospital_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hospital_medical_records h
                  WHERE h.patient_id = patients.id AND h.hospital_id = app_rls.current_hospital_id()));

DO $identity_children$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_emergency_contacts','patient_insurance','patient_chronic_conditions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.hospital_medical_records h WHERE h.patient_id = %I.patient_id AND h.hospital_id = app_rls.current_hospital_id())) WITH CHECK (EXISTS (SELECT 1 FROM public.hospital_medical_records h WHERE h.patient_id = %I.patient_id AND h.hospital_id = app_rls.current_hospital_id()))',
      t || '_via_patient_record', t, t, t);
  END LOOP;
END
$identity_children$;

-- Not covered here, by design: audit_events, domain_events (§3.3, never
-- block an audit insert; workers run outside a request), the two Unresolved
-- tables (patient_access_grants, satisfaction_surveys), Global/reference and
-- Internal/system tables, and patient-app / discovery policies (need #20).
