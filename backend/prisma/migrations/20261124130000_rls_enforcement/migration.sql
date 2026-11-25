-- Row-Level Security: enforcement (multi-hospital §2.15, fix-list items 18–20).
--
-- Activates the Phase 22 design (prisma/rls-proposal, RLS_DESIGN.md) with
-- the owner's approved decisions:
--
-- * Policies bind the dedicated runtime role (prisma/roles/
--   provision-runtime-role.sql): non-owner, NOSUPERUSER, NOBYPASSRLS. The
--   table owner — migrations, seeds, operational tooling — is exempt as
--   PostgreSQL defines (no FORCE ROW LEVEL SECURITY). The application's boot
--   check refuses to start in production on a role that would bypass these
--   policies (src/shared/database/runtime-role.check.ts).
-- * Tenant context is transaction-local only: `set_config(name, value, true)`
--   inside the transaction whose statements it scopes, so it can never leak
--   to the next borrower of a pooled connection.
-- * Missing, empty or malformed context yields NULL and matches nothing:
--   fail closed.
--
-- Context (all transaction-local):
--   app.scope        'hospital' | 'platform' | 'patient' | 'system'
--   app.hospital_id  the hospital a 'hospital' scope acts for
--   app.user_id      the acting account (grants, sharing, audit)
--   app.patient_id   the patient a 'patient' scope is
--
-- What each scope sees:
--   hospital  rows of its hospital; a patient's rows at another hospital only
--             under an ACTIVE, unexpired exceptional-access grant held by
--             app.user_id, or an APPROVED, unexpired, unrevoked information
--             request made by app.user_id
--   platform  organisational metadata of every hospital; no clinical rows,
--             no patients (no PHI by default, §2.1)
--   patient   its own rows only
--   system    everything — set explicitly by background jobs that are not
--             per-hospital units, and never by a request
-- Legacy rows with hospital_id IS NULL are visible to no hospital scope
-- (isolated until an evidence-based backfill assigns them, §2.12).

CREATE SCHEMA IF NOT EXISTS app_rls;

CREATE OR REPLACE FUNCTION app_rls.setting_uuid(name text) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $fn$
DECLARE
  raw text := current_setting(name, true);
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION app_rls.scope() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT CASE current_setting('app.scope', true)
           WHEN 'hospital' THEN 'hospital'
           WHEN 'platform' THEN 'platform'
           WHEN 'patient'  THEN 'patient'
           WHEN 'system'   THEN 'system'
           ELSE NULL
         END
$fn$;

CREATE OR REPLACE FUNCTION app_rls.current_hospital_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT app_rls.setting_uuid('app.hospital_id')
$fn$;

CREATE OR REPLACE FUNCTION app_rls.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT app_rls.setting_uuid('app.user_id')
$fn$;

CREATE OR REPLACE FUNCTION app_rls.current_patient_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT app_rls.setting_uuid('app.patient_id')
$fn$;

-- Controlled cross-hospital access for one patient at one hospital. SECURITY
-- DEFINER so the check reads the grant tables themselves without the runtime
-- role needing to see every grant; the search_path is pinned.
CREATE OR REPLACE FUNCTION app_rls.has_controlled_access(p_patient uuid, p_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT app_rls.current_user_id() IS NOT NULL AND p_patient IS NOT NULL AND p_hospital IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.exceptional_access_grants g
       WHERE g.requester_user_id = app_rls.current_user_id()
         AND g.patient_id = p_patient
         AND g.hospital_id = p_hospital
         AND g.status = 'ACTIVE'
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND g.expires_at > now())
    OR EXISTS (
      SELECT 1 FROM public.information_requests r
       WHERE r.requester_user_id = app_rls.current_user_id()
         AND r.patient_id = p_patient
         AND r.target_hospital_id = p_hospital
         AND r.status = 'APPROVED'
         AND r.revoked_at IS NULL
         AND r.share_expires_at > now()))
$fn$;

-- The visibility rule for a clinical row (has hospital_id and patient_id).
CREATE OR REPLACE FUNCTION app_rls.clinical_visible(p_hospital uuid, p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT CASE app_rls.scope()
           WHEN 'system'   THEN true
           WHEN 'hospital' THEN p_hospital = app_rls.current_hospital_id()
                                OR app_rls.has_controlled_access(p_patient, p_hospital)
           WHEN 'patient'  THEN p_patient = app_rls.current_patient_id()
           ELSE false
         END
$fn$;

-- The write rule for a clinical row: own hospital only (controlled access
-- is read-only), or system.
CREATE OR REPLACE FUNCTION app_rls.clinical_writable(p_hospital uuid, p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT CASE app_rls.scope()
           WHEN 'system'   THEN true
           WHEN 'hospital' THEN p_hospital = app_rls.current_hospital_id()
           WHEN 'patient'  THEN p_patient = app_rls.current_patient_id()
           ELSE false
         END
$fn$;

-- The rule for an organisational row (hospital_id, no patient).
CREATE OR REPLACE FUNCTION app_rls.org_visible(p_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $fn$
  SELECT CASE app_rls.scope()
           WHEN 'system'   THEN true
           WHEN 'platform' THEN true
           WHEN 'hospital' THEN p_hospital = app_rls.current_hospital_id()
           ELSE false
         END
$fn$;

-- ── Clinical tables: hospital_id + patient_id ────────────────────────────
DO $clinical$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments','lab_orders','medical_records','patient_doctor_assignments','prescriptions',
    'ai_conversations','conversations','hospital_medical_record_conditions','notifications',
    'patient_allergies','patient_clinical_alerts','patient_documents','patient_medical_history',
    'patient_medications','patient_notes','patient_studies','patient_vital_signs',
    'hospital_medical_records','queue_entries','waiting_room_entries']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (app_rls.clinical_visible(hospital_id, patient_id))',
      t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (app_rls.clinical_writable(hospital_id, patient_id))',
      t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (app_rls.clinical_writable(hospital_id, patient_id)) WITH CHECK (app_rls.clinical_writable(hospital_id, patient_id))',
      t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (app_rls.clinical_writable(hospital_id, patient_id))',
      t || '_delete', t);
  END LOOP;
END
$clinical$;

-- ── Organisational tables: hospital_id only ──────────────────────────────
DO $org$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'files','clinics','hospital_locations','hospital_departments','hospital_insurance_coverage','rooms',
    'resources','staff_shift_assignments','hospital_staff_affiliations','hospital_role_assignments',
    'doctor_employments','doctor_availability','doctor_time_off','published_slots']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (app_rls.org_visible(hospital_id)) WITH CHECK (app_rls.org_visible(hospital_id))',
      t || '_tenant', t);
  END LOOP;
END
$org$;

-- ── Children: visible exactly when their parent is (the parent's own
--    policy applies inside the EXISTS) ─────────────────────────────────────
DO $children$
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
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I)) WITH CHECK (EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I))',
      r.child || '_via_' || r.parent, r.child, r.parent, r.child, r.fk, r.parent, r.child, r.fk);
  END LOOP;
END
$children$;

DO $two_level$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_attachments','message_flags'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = %I.message_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = %I.message_id))',
      t || '_via_message', t, t, t);
  END LOOP;
END
$two_level$;

-- ── Patients: through a visible Hospital Medical Record, or self ─────────
-- A patient row has no hospital_id: it is visible where a record is visible
-- (the HMR policy applies inside the EXISTS), to the patient themselves, and
-- to system. Platform scope sees none (§2.1). INSERT is allowed to hospital
-- and system scope — registration creates the HMR in the same transaction.
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_read ON public.patients FOR SELECT USING (
  app_rls.scope() = 'system'
  OR (app_rls.scope() = 'patient' AND id = app_rls.current_patient_id())
  OR (app_rls.scope() = 'hospital'
      AND EXISTS (SELECT 1 FROM public.hospital_medical_records h WHERE h.patient_id = patients.id)));
CREATE POLICY patients_insert ON public.patients FOR INSERT
  WITH CHECK (app_rls.scope() IN ('hospital', 'system'));
CREATE POLICY patients_update ON public.patients FOR UPDATE USING (
  app_rls.scope() = 'system'
  OR (app_rls.scope() = 'patient' AND id = app_rls.current_patient_id())
  OR (app_rls.scope() = 'hospital'
      AND EXISTS (SELECT 1 FROM public.hospital_medical_records h
                   WHERE h.patient_id = patients.id AND h.hospital_id = app_rls.current_hospital_id())));
CREATE POLICY patients_delete ON public.patients FOR DELETE USING (app_rls.scope() = 'system');

DO $identity_children$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_emergency_contacts','patient_insurance','patient_chronic_conditions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.patients p WHERE p.id = %I.patient_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.patients p WHERE p.id = %I.patient_id))',
      t || '_via_patient', t, t, t);
  END LOOP;
END
$identity_children$;

-- ── Hospitals: a directory every scope may read; written by platform/system
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY hospitals_read ON public.hospitals FOR SELECT USING (app_rls.scope() IS NOT NULL);
CREATE POLICY hospitals_write ON public.hospitals FOR ALL
  USING (app_rls.scope() IN ('platform', 'system'))
  WITH CHECK (app_rls.scope() IN ('platform', 'system'));

-- ── Audit ledger: every scope may append; reads are scoped ───────────────
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_append ON public.audit_events FOR INSERT WITH CHECK (true);
CREATE POLICY audit_events_read ON public.audit_events FOR SELECT USING (
  app_rls.scope() IN ('platform', 'system')
  OR (app_rls.scope() = 'hospital' AND hospital_id = app_rls.current_hospital_id()));

-- ── Controlled access and ownership evidence ─────────────────────────────
ALTER TABLE public.exceptional_access_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY exceptional_access_grants_tenant ON public.exceptional_access_grants FOR ALL USING (
  app_rls.scope() = 'system'
  OR requester_user_id = app_rls.current_user_id()
  OR (app_rls.scope() = 'hospital' AND hospital_id = app_rls.current_hospital_id()))
WITH CHECK (
  app_rls.scope() = 'system'
  OR requester_user_id = app_rls.current_user_id()
  OR (app_rls.scope() = 'hospital' AND hospital_id = app_rls.current_hospital_id()));

ALTER TABLE public.information_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY information_requests_tenant ON public.information_requests FOR ALL USING (
  app_rls.scope() = 'system'
  OR requester_user_id = app_rls.current_user_id()
  OR (app_rls.scope() = 'hospital' AND target_hospital_id = app_rls.current_hospital_id()))
WITH CHECK (
  app_rls.scope() = 'system'
  OR requester_user_id = app_rls.current_user_id()
  OR (app_rls.scope() = 'hospital' AND target_hospital_id = app_rls.current_hospital_id()));

ALTER TABLE public.platform_admin_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_grants_platform ON public.platform_admin_grants FOR ALL
  USING (app_rls.scope() IN ('platform', 'system'))
  WITH CHECK (app_rls.scope() IN ('platform', 'system'));

ALTER TABLE public.ownership_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ownership_assignments_system ON public.ownership_assignments FOR ALL
  USING (app_rls.scope() = 'system') WITH CHECK (app_rls.scope() = 'system');
