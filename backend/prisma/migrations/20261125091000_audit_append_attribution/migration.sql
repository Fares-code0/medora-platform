-- Audit ledger appends under Row-Level Security (multi-hospital §2.13,
-- §2.15; audit finding F-04).
--
-- 1. Writers now insert without RETURNING (`createMany`), so the SELECT
--    policy is no longer consulted for the new row: a hospital- or
--    patient-scoped request can append an event it may not read back.
-- 2. The append policy was `WITH CHECK (true)`: any request could attribute
--    an event to any hospital, forging another tenant's audit history. It
--    now validates the attribution against the request's own tenant context:
--
--    | scope | may append an event attributed to |
--    | --- | --- |
--    | system, platform | any hospital, or none |
--    | hospital | its own hospital; a hospital it holds an exceptional-access grant or information request toward (the controlled-access events and reads); or none |
--    | patient | a hospital where the patient holds a Hospital Medical Record; or none |
--    | no context | none (unauthenticated events such as sign-in) |
--
-- The function reads the grant and record tables as the owner (SECURITY
-- DEFINER, pinned search_path) and only answers yes or no; it discloses no
-- row.

CREATE OR REPLACE FUNCTION app_rls.audit_attribution_allowed(p_hospital uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT CASE
    WHEN p_hospital IS NULL THEN true
    WHEN app_rls.scope() IN ('system', 'platform') THEN true
    WHEN app_rls.scope() = 'hospital' THEN
         p_hospital = app_rls.current_hospital_id()
      OR EXISTS (SELECT 1 FROM public.exceptional_access_grants g
                  WHERE g.requester_user_id = app_rls.current_user_id() AND g.hospital_id = p_hospital)
      OR EXISTS (SELECT 1 FROM public.information_requests r
                  WHERE r.requester_user_id = app_rls.current_user_id() AND r.target_hospital_id = p_hospital)
    WHEN app_rls.scope() = 'patient' THEN
      EXISTS (SELECT 1 FROM public.hospital_medical_records h
               WHERE h.patient_id = app_rls.current_patient_id() AND h.hospital_id = p_hospital)
    ELSE false
  END
$fn$;

DROP POLICY audit_events_append ON public.audit_events;
CREATE POLICY audit_events_append ON public.audit_events FOR INSERT
  WITH CHECK (app_rls.audit_attribution_allowed(hospital_id));
