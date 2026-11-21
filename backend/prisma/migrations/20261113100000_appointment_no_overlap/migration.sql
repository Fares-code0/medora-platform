-- No double booking, enforced by the database (DR-11; ADR-005 §4 rule 4).
--
-- Until now the overlap rule was a read followed by a write.
-- `SlotConflictChecker.assertBookable` reads the doctor's live bookings,
-- then `AppointmentRepository.create` or `transition` inserts or moves
-- the row, with no transaction or lock between the two. Two requests for
-- the same doctor and slot can both read an empty book and both write.
-- The pre-check cannot see a row that is not committed yet, so only a
-- constraint closes the gap. The same reasoning is why e-mail uniqueness
-- is a unique index and not a pre-check (`shared/database/prisma-errors.ts`).
--
-- The constraint enforces the hard invariant: two live, non-deleted
-- appointments of one doctor never share an instant. The buffer between
-- appointments (`bufferMin`) stays a scheduling rule in the checker.
-- It is a doctor preference that can change after bookings exist, so
-- freezing today's value into a constraint would be wrong.
--
-- "Live" is `LIVE_STATUSES` in `appointment.repository.ts`, in the
-- database's spelling. A cancelled, completed or no-show appointment
-- occupies no slot. `deleted_at IS NULL` matches the soft-delete filter
-- the checker reads through.
--
-- `ends_at` is maintained by the `derive_appointment_columns` BEFORE
-- trigger (migration 20261030130000). The constraint therefore sees the
-- derived end, never a value a caller supplied.
--
-- Upgrade safety: the preflight below refuses to proceed when existing
-- rows already overlap, and names the query that lists them. It never
-- cancels or moves an appointment, because which of two clashing bookings
-- wins is a clinical decision, not a migration's. On a database with no
-- overlaps the constraint is added in one transaction.
--
-- `btree_gist` provides the `=` operator class on `uuid` that a GiST
-- exclusion constraint needs. It ships with PostgreSQL contrib, and
-- `IF NOT EXISTS` mirrors 20260814120000_enable_extensions.
--
-- No explicit BEGIN/COMMIT. `migrate deploy` sends this file as one
-- multi-statement query, which PostgreSQL runs as one implicit
-- transaction: when the preflight raises, the extension is rolled back
-- too. With an explicit BEGIN the raise would leave the session in an
-- aborted transaction block. Prisma's own bookkeeping statement would then
-- fail with "current transaction is aborted", which hides the preflight's
-- message and leaves the migration's `logs` empty. Verified both ways
-- against PostgreSQL 16 while writing this migration.

CREATE EXTENSION IF NOT EXISTS "btree_gist";

DO $$
DECLARE
  clashes integer;
BEGIN
  SELECT count(*) INTO clashes
  FROM "appointments" a
  JOIN "appointments" b
    ON a."doctor_id" = b."doctor_id"
   AND a."id" < b."id"
   AND tstzrange(a."starts_at", a."ends_at", '[)') && tstzrange(b."starts_at", b."ends_at", '[)')
  WHERE a."deleted_at" IS NULL AND b."deleted_at" IS NULL
    AND a."status" IN ('scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient')
    AND b."status" IN ('scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient');

  IF clashes > 0 THEN
    RAISE EXCEPTION 'appointments_no_overlap: % pair(s) of live appointments already overlap', clashes
      USING HINT = 'Resolve them first (cancel or reschedule one of each pair), then re-run the migration. '
                || 'The pairs are listed by the SELECT in this migration''s preflight block.';
  END IF;
END $$;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "doctor_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE (
    "deleted_at" IS NULL
    AND "status" IN ('scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient')
  );
