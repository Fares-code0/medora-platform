-- DB §B1, §B2, §F1, §I2, §K2, §K3 — the scalar-list columns the dictionary
-- declares NOT NULL, made NOT NULL.
--
-- Prisma has no way to say it. `String[]` is a required field in the client
-- (it types as `string[]`, never `string[] | null`), yet `migrate dev`
-- emits the column as plain `TEXT[]`, nullable, and `migrate diff` ignores
-- the nullability of a list column in both directions. So the dictionary's
-- "Null: no" was lost in M5.3/M5.5/M5.9 without `db:check` noticing, and
-- adding it here does not create drift either. Found by the comparison
-- against the Database branch's `database/medora.dbml`, which declares
-- `medications.frequencies` and `durations_days` NOT NULL as the dictionary
-- does (backend/docs/DATABASE_BRANCH_RECONCILIATION.md §5).
--
-- A NULL in one of these columns reaches the application as `null` where
-- the generated type promises an array, so `row.languages.length` throws.
-- The client never writes one — every column but `days` has a database
-- default of `'{}'`, and the shift DTO requires `days` — so a NULL can only
-- come from hand-written SQL. The backfill below is therefore expected to
-- touch no rows; it exists so the migration cannot fail on a database where
-- someone did write one.
--
-- `'{}'` is the value the column default would have produced, so the
-- backfill invents nothing. `staff_shift_assignments.days` is different: it
-- has no default and no neutral value (an empty mask fails DB §K3's
-- "boolean[7]"; an all-false mask asserts a schedule nobody chose), so a
-- NULL there stops the migration instead of being guessed at.
--
-- `scheduled_reports.recipients` already rejects NULL through
-- `scheduled_reports_has_recipients` (`coalesce(...) > 0`); it is set
-- NOT NULL so the column says what the constraint enforces.
--
-- Columns the dictionary leaves nullable or does not specify are untouched:
-- `lab_analyte_specs.qualitative_options` (§E2, "yes"),
-- `ai_user_settings.favorite_prompt_ids` (§H3, no nullability stated),
-- `incident_bookmarks.event_ids` (§13, inferred table) and
-- `admin_invitations.permissions` (ADR-035, not in the dictionary).
--
-- Wrapped in an explicit transaction: `migrate deploy` does not make a
-- migration atomic on its own (verified — a statement that fails part-way
-- leaves the earlier ones applied), and a half-tightened set of columns
-- would be worse than either state. The guard runs first regardless, so a
-- NULL shift mask stops the migration before anything has changed.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "staff_shift_assignments" WHERE "days" IS NULL) THEN
    RAISE EXCEPTION 'staff_shift_assignments has rows with a NULL days mask; '
      'set each to the seven-element mask it should have, then re-run this migration';
  END IF;
END
$$;

UPDATE "doctors" SET "languages" = '{}' WHERE "languages" IS NULL;
UPDATE "doctors" SET "education" = '{}' WHERE "education" IS NULL;
UPDATE "doctors" SET "certifications" = '{}' WHERE "certifications" IS NULL;
UPDATE "doctors" SET "skills" = '{}' WHERE "skills" IS NULL;
UPDATE "admin_profiles" SET "education" = '{}' WHERE "education" IS NULL;
UPDATE "admin_profiles" SET "certifications" = '{}' WHERE "certifications" IS NULL;
UPDATE "admin_profiles" SET "experience" = '{}' WHERE "experience" IS NULL;
UPDATE "staff_members" SET "permissions" = '{}' WHERE "permissions" IS NULL;
UPDATE "medications" SET "frequencies" = '{}' WHERE "frequencies" IS NULL;
UPDATE "medications" SET "durations_days" = '{}' WHERE "durations_days" IS NULL;

ALTER TABLE "doctors"
  ALTER COLUMN "languages" SET NOT NULL,
  ALTER COLUMN "education" SET NOT NULL,
  ALTER COLUMN "certifications" SET NOT NULL,
  ALTER COLUMN "skills" SET NOT NULL;

ALTER TABLE "admin_profiles"
  ALTER COLUMN "education" SET NOT NULL,
  ALTER COLUMN "certifications" SET NOT NULL,
  ALTER COLUMN "experience" SET NOT NULL;

ALTER TABLE "staff_members" ALTER COLUMN "permissions" SET NOT NULL;

ALTER TABLE "staff_shift_assignments" ALTER COLUMN "days" SET NOT NULL;

ALTER TABLE "medications"
  ALTER COLUMN "frequencies" SET NOT NULL,
  ALTER COLUMN "durations_days" SET NOT NULL;

ALTER TABLE "scheduled_reports" ALTER COLUMN "recipients" SET NOT NULL;

COMMIT;
