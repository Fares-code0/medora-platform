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

-- Pattern 1 — direct ownership: the row carries hospital_id.
ALTER TABLE public.hospital_medical_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY hospital_medical_records_tenant ON public.hospital_medical_records
  FOR ALL
  USING (hospital_id = app_rls.current_hospital_id())
  WITH CHECK (hospital_id = app_rls.current_hospital_id());

ALTER TABLE public.patient_allergies ENABLE ROW LEVEL SECURITY;
CREATE POLICY patient_allergies_tenant ON public.patient_allergies
  FOR ALL
  USING (hospital_id = app_rls.current_hospital_id())
  WITH CHECK (hospital_id = app_rls.current_hospital_id());

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_tenant ON public.appointments
  FOR ALL
  USING (hospital_id = app_rls.current_hospital_id())
  WITH CHECK (hospital_id = app_rls.current_hospital_id());

-- Pattern 2 — indirect ownership: the row inherits its hospital from a
-- parent. The parent's own policy also applies inside the subquery.
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY medical_records_tenant ON public.medical_records
  FOR ALL
  USING (hospital_id = app_rls.current_hospital_id())
  WITH CHECK (hospital_id = app_rls.current_hospital_id());

ALTER TABLE public.record_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_notes_via_record ON public.record_notes
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.medical_records m
     WHERE m.id = record_id AND m.hospital_id = app_rls.current_hospital_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.medical_records m
     WHERE m.id = record_id AND m.hospital_id = app_rls.current_hospital_id()));

-- Pattern 3 — global identity: `patients` is the single global identity
-- (DR-03) and deliberately gets no hospital policy here.
