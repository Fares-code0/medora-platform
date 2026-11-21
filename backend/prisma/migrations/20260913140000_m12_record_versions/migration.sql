-- M12 — record versioning, the one-primary rule, and the `MR-…` sequence.
--
-- Three additions, none of which rewrites an existing row.
--
-- ══ 1. The `MR-…` sequence (API §6.3) ════════════════════════════════
--
-- Same reasoning as `patient_identity_seq` (M10.2) and
-- `appointment_reference_seq` (M11.2): the handle is read aloud, quoted
-- in a toast and printed on a referral, and guessability is not the
-- control — every read is care-scoped, so walking `MR-10001`,
-- `MR-10002`, … returns 404 for every chart the caller is not on.
--
-- Starting at 10001 because that is the range the frontend's own mock
-- renders (`mock-data.ts`), and `medical_records_public_id_prefix`
-- already constrains the shape to `MR-%`.

CREATE SEQUENCE IF NOT EXISTS "medical_record_reference_seq"
  AS BIGINT
  START WITH 10001
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- ══ 2. One primary diagnosis per record (API §6.4) ═══════════════════
--
-- API §6.4 says "one-primary-diagnosis enforced (partial unique)" and
-- M5.7 did not add the index — `@@unique([record_id, icd_code_id])`
-- stops the same code twice and says nothing about how many of them are
-- primary. Two primaries is not a cosmetic problem: `primaryDiagnosis()`
-- on the frontend returns `find(...)`, so the record's headline
-- diagnosis would silently become whichever row the database happened
-- to return first, and could differ between two loads of the same page.
--
-- Partial, matching the shape M5.3 and M5.4 already use for
-- `doctor_specialties` and `patient_emergency_contacts`: a record may
-- have any number of secondary diagnoses, and at most one primary.
--
-- Deliberately allows **zero** primaries. A draft being typed up has
-- diagnoses before one of them has been chosen as the headline, and a
-- constraint that required one would make the intermediate state
-- unrepresentable.

CREATE UNIQUE INDEX IF NOT EXISTS "record_diagnoses_one_primary"
  ON "record_diagnoses" ("record_id") WHERE "is_primary";

-- ══ 3. `record_versions` (API §6.8, RM M12.6) ════════════════════════
--
-- Every update stores a before/after diff. The requirement comes from
-- two directions — UX 1.5.3's version history and the logs diff viewer
-- of module 14 — and both want the same thing: what changed, who
-- changed it, and when.
--
-- ── Why a diff and not a full snapshot ───────────────────────────────
--
-- A snapshot per update would copy the whole clinical document,
-- children included, on every keystroke-sized save. The diff is what
-- both consumers actually render, and it is bounded by the size of the
-- change rather than the size of the record.
--
-- ── Why `jsonb` and not a column per field ───────────────────────────
--
-- The document has eight scalar fields and five child collections, and
-- a change may touch any subset. Fifty nullable columns would encode
-- the same information less legibly and would need a migration every
-- time the record gains a field.
--
-- ── INSERT-only, like the audit trail ────────────────────────────────
--
-- No `updated_at`, no `deleted_at`. A version row that can be edited is
-- not a version history, and a version row that can be deleted is worse
-- than none — it makes the absence of a change indistinguishable from
-- its removal. The soft-delete client extension therefore never touches
-- this table, which is correct: it has no `deleted_at` to filter on.
--
-- `version` is per record and dense from 1, so "version 3" means the
-- same thing to a clinician and to a query. It is assigned inside the
-- update's transaction from a `MAX(version) + 1` over the record's own
-- rows, and the unique index below is what makes two concurrent updates
-- collide rather than silently share a number.

CREATE TABLE "record_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,
    -- The display name as it was, on the same reasoning ADR-003 §4 gives
    -- for `appointment_events.actor_name`: the FK may go null when an
    -- account is removed, and a later rename must not rewrite history.
    "actor_name" VARCHAR(120),
    -- `{ field: { before, after } }` for the scalars that changed, plus
    -- a `children` key naming collections that were replaced. Never the
    -- whole document.
    "changes" JSONB NOT NULL,
    "summary" VARCHAR(300),

    CONSTRAINT "record_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "record_versions_record_id_version_key"
  ON "record_versions" ("record_id", "version");

CREATE INDEX "record_versions_record_id_changed_at_idx"
  ON "record_versions" ("record_id", "changed_at" DESC);

ALTER TABLE "record_versions"
  ADD CONSTRAINT "record_versions_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "medical_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "record_versions"
  ADD CONSTRAINT "record_versions_changed_by_fkey"
  FOREIGN KEY ("changed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Version numbers are dense from 1 (DB §9's positive-integer house style).
ALTER TABLE "record_versions"
  ADD CONSTRAINT "record_versions_version_positive" CHECK ("version" > 0);
