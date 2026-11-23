-- Owner decision 2026-11-23 (Decision 1, option A): comply with ADR-024 §3 —
-- nothing references the audit ledger by foreign key, in either direction.
--
-- 20261122170000_phase21_data_model added audit_events_hospital_id_fkey. With
-- it, an audit write carrying a hospital id that is not in `hospitals` fails,
-- and ADR-024 §4 holds that a lost audit event is worse than a misfiled one.
-- `hospital_id` is an attribution stamp, like `session_id`.
--
-- Only the constraint is dropped. The column, `audit_events_hospital_occurred_idx`
-- and the immutability trigger `hospitalscope_audit_events_trg` are kept, and no
-- row is read or changed. Brief ACCESS EXCLUSIVE lock; no table scan.
-- domain_events_hospital_id_fkey is out of ADR-024's scope and is unchanged.

ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_hospital_id_fkey;
