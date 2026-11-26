-- Patient AI (ADR-050): two patient-facing assistant experiences stored in
-- the existing `ai_conversations` / `ai_messages` tables.
--
-- `patient_mode` is NULL for every clinician thread (all rows written before
-- this migration) and 'general' | 'personal' for a thread a patient opened
-- under `/me/ai/conversations`. The mode is fixed at creation.
--
-- A patient thread never binds a patient, a hospital chart or a reference:
-- the personal mode's data is re-resolved from the session on every turn
-- (PatientSelfScopeService), so nothing on the row may name a patient. The
-- CHECK makes that structural — a patient thread can never become a
-- patient-bound clinician thread or the reverse.
ALTER TABLE public.ai_conversations ADD COLUMN patient_mode varchar(16);

ALTER TABLE public.ai_conversations
  ADD CONSTRAINT ai_conversations_patient_mode_check
  CHECK (
    patient_mode IS NULL
    OR (
      patient_mode IN ('general', 'personal')
      AND context_mode = 'general'
      AND patient_id IS NULL
      AND hospital_id IS NULL
      AND hospital_medical_record_id IS NULL
      AND ref_public_id IS NULL
    )
  );

-- An assistant turn produced by the deterministic red-flag pre-check
-- (a fixed escalation message, no model call). False for every other turn.
ALTER TABLE public.ai_messages ADD COLUMN escalated boolean NOT NULL DEFAULT false;
