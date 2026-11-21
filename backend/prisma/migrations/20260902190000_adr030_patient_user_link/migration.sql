-- ADR-030 — link a patient's clinical record to their platform account.
--
-- Amends ADR-018 §3 ("patients are records, not authenticated users") in
-- that clause only, by owner decision of 2026-09-02. Single-clinic,
-- billing-off and mobile-readiness are untouched.
--
-- ── Additive, and deliberately so ────────────────────────────────────
--
-- Three statements, no backfill, no data movement, no column dropped, no
-- type changed, no existing row rewritten. Every patient record in the
-- database keeps working exactly as it did, with `user_id` NULL, and no
-- doctor- or administrator-facing response changes shape. Rollback is
-- DROP CONSTRAINT + DROP COLUMN and loses only the links themselves.
--
-- ── Why nullable ─────────────────────────────────────────────────────
--
-- A patient is registered at the front desk by a clinician, and that
-- record must be complete and usable before the person has ever opened an
-- app — and for the many who never will. NOT NULL would make an account a
-- precondition for receiving care.
--
-- It would also force a backfill, and the backfill is the hazard rather
-- than the cost: filling this column for existing rows means matching an
-- account to a record, and the only column available to match on is
-- `patients.email` — a nullable, non-unique, clinician-typed contact
-- field. One typo or one shared family address discloses a stranger's
-- medical history. A nullable column has no backfill step at all, which
-- is precisely why this migration cannot mismatch a person to a record.
--
-- ── Why unique ───────────────────────────────────────────────────────
--
-- The mapping is one-to-at-most-one in both directions. Postgres permits
-- unlimited NULLs under a unique constraint, so this single index says
-- "every linked record is linked to a different account, and unlinked
-- records are unconstrained" exactly — no partial index, no trigger.
--
-- ── Why SET NULL and never CASCADE ───────────────────────────────────
--
-- DB §7: PHI is never hard-deleted. Users are deactivated rather than
-- deleted, but if a `users` row ever were removed, the clinical record
-- must survive it and revert to unlinked. CASCADE here would delete a
-- person's entire medical history because their app account went away,
-- which is the worst outcome this file could produce.
ALTER TABLE "patients" ADD COLUMN "user_id" UUID;

CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
