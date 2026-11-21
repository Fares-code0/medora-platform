-- BR-DEC-003 (DEC-003) — the reason for removing a history event, removing
-- an emergency contact or resolving a clinical alert, persisted with the
-- row it explains rather than only in a log line.
--
-- Nullable on all three. Rows removed or resolved before this migration have
-- no reason, and the application — not the column — decides when one is
-- required: mandatory for a history removal (DEC-003 point 2, "each with a
-- mandatory reason"), optional for a contact removal and an alert
-- resolution ("optional-or-mandatory"; the client that calls those routes
-- today sends no body). 300 characters, the ceiling the other P4 reasons on
-- this schema use (`record_versions.reason`, BR-DEC-004).
--
-- Additive only: no existing column, index or constraint changes.

ALTER TABLE "patient_medical_history" ADD COLUMN "removal_reason" VARCHAR(300);
ALTER TABLE "patient_emergency_contacts" ADD COLUMN "removal_reason" VARCHAR(300);
ALTER TABLE "patient_clinical_alerts" ADD COLUMN "resolution_reason" VARCHAR(300);
