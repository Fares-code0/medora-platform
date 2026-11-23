# Medora Database Architecture

## Status

The authoritative database is `backend/prisma/` and nothing else: the split Prisma schema in
`prisma/schema/`, the migrations in `prisma/migrations/`, and the seeds in `prisma/seed*`. This
repository has no standalone `database/` SQL or DBML package (see the root `CLAUDE.md`).

The multi-hospital foundation (`20261122150000_hospital_core`, `20261122160000_facility_foundation`)
and the Phase 21 data model (`20261122170000_phase21_data_model` plus its corrective migration
`20261123100000_fix_scoped_clinical_link_trigger`) are proposed against `main` from the
database-only branch `fix/phase21-database-main-integration`. They were first written on the
`Database` integration branch (PR #5, PR #6) and PR #9; PR #9's Phase 22 application code is **not**
part of this change (see [`docs/multi-hospital/PHASE22_BACKEND_HANDOFF.md`](../../docs/multi-hospital/PHASE22_BACKEND_HANDOFF.md)).

**Persistent-environment status of all four migrations is unknown.** No evidence in the repository
shows whether any local, development, staging or production database has applied them
([`PR5_MIGRATION_STATUS_AND_RECOVERY.md`](../../docs/multi-hospital/PR5_MIGRATION_STATUS_AND_RECOVERY.md)).
They are therefore treated as possibly applied: none is edited, renamed or consolidated.

## Entities and relationships

The full generated ERD, including every Prisma model, scalar column, and declared relation, is
[DATABASE_ERD.md](DATABASE_ERD.md). Regenerate it after schema changes from `backend/` with
`npm run db:erd`.

The primary ownership paths are:

- `Hospital` owns `HospitalLocation`, `Clinic`, `HospitalDepartment`, staff affiliation and employment
  scopes, published slots, and accepted insurance-plan metadata. `hospitals.status` is limited to
  `ACTIVE`, `SUSPENDED` and `INACTIVE` by the `hospitals_status_check` constraint
  (`20261122150000_hospital_core`); the Prisma field is a plain `String`, so the constraint is the
  only thing holding that vocabulary and `test/facility-foundation.e2e-spec.ts` pins it.
- `User` is a global account. `Doctor` is the professional profile. `DoctorEmployment` records
  hospital employment history; a partial unique index allows one active hospital employment per
  doctor. `HospitalStaffAffiliation` allows one active affiliation per staff member **per hospital**
  (see *Open decisions*, MRD-05) and grants no access by itself. `HospitalRoleAssignment` is the
  explicit hospital-scoped role grant and stores its employment or affiliation source; ending that
  source revokes only the roles it sourced (trigger `revoke_ended_hospital_affiliation_roles`).
- `Patient` remains the single global identity. `HospitalMedicalRecord` gives each patient a separate
  clinical record at each hospital, protected by a unique `(patient_id, hospital_id)` key.
- Patient clinical details, encounters, appointments, lab orders, prescriptions, conversations and
  notifications retain their existing patient and row identifiers. New hospital and medical-record
  references are nullable to preserve legacy rows without verified ownership; a CHECK on each table
  requires both or neither.
- `PublishedSlot` is owned by an active doctor employment. An appointment can book a slot only in the
  same hospital and for the matching doctor employment. A partial unique index limits active bookings
  to one per slot; cancelled, rescheduled, completed and no-show appointments release that key.
- `PatientInsurance` remains the patient's actual policy. `HospitalInsuranceCoverage` is separate
  metadata describing a provider and plan accepted by a hospital.
- `PatientEmergencyContact` and legacy `PatientChronicCondition` remain unchanged.
  `HospitalMedicalRecordCondition` is the new hospital-record-owned association.

## Isolation boundary

Hospital identifiers are structural ownership data, not an authorization decision. Composite foreign
keys ensure that a hospital-scoped department, employment, record, appointment, lab order,
prescription, or attachment cannot reference an object from a different hospital. Triggers preserve
assigned ownership keys and validate employment, file, slot and clinical-link ownership.

Tenant context resolution, hospital-scoped repository predicates, authorization guards, administrator
mapping, session/cache revocation, cross-hospital grants, Break-Glass, AI C2 retention/provenance, and
PostgreSQL Row-Level Security are **not enabled by this schema**. Do not enable real multi-hospital
access until those backend controls and cross-hospital negative tests are complete. OQ-02
patient-record claiming stays deferred.

## Drift check

`npm run db:check` is unchanged from `main`:
`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code`.
It replays the full migration history into `SHADOW_DATABASE_URL` and fails on any difference from
the Prisma schema. CI runs it against a separate `medora_shadow` database before `db:deploy`.

Phase 21 enables Prisma's `partialIndexes` preview feature, so partial indexes are now part of the
comparison. Two consequences:

- **Every partial index a migration creates must be declared in the schema.** That includes
  `sessions_successor_rotated_at_idx` from `main`'s ADR-045 migration
  (`20261121090000_session_refresh_grace`), declared in `03-identity.prisma` with the exact
  predicate of its migration (`successor_token_ct IS NOT NULL`, on `rotated_at`).
- **Predicates are declared in the text PostgreSQL stores** (`pg_get_expr(indpred)`), because Prisma
  compares that text. Three predicates are written that way:
  `appointments_one_active_booking_per_slot` (`status <> ALL (ARRAY[...::appointment_status])`),
  `patient_doctor_assignments_one_live_primary` (`(role)::text = 'primary'::text`) and
  `record_issue_reports_open_idx` (`(status)::text <> 'resolved'::text`). They are the same
  predicates the migrations created, in normalized form, so the check reports no difference without
  any allowlist.

## Migration history and the corrective migration

`20261122170000_phase21_data_model` created `validate_scoped_clinical_links()` with `NEW.<column>`
references in a single `IF … ELSIF` chain. PL/pgSQL resolves each condition's record fields when it
evaluates the condition, so on a table that lacks an earlier-named column the function raised
`record "new" has no field "…"` — e.g. every INSERT into `medical_records` (no `prescription_id`).
Reproduced on PostgreSQL 16 by reinstating the original function body.

`20261123100000_fix_scoped_clinical_link_trigger` replaces the function with one that reads the row
through `to_jsonb(NEW)`, preserving every tenant check. Because the first migration's persistent
status is unknown, it is **not** edited or merged with the fix; the corrective migration stays. A
database that applied the first migration without the second has broken writes on
`medical_records`, `patient_vital_signs`, `prescriptions`, `patient_medications`, `patient_studies`
and `notifications` until the second is applied, so both must be deployed together.
`test/multi-hospital-data-model.e2e-spec.ts` proves INSERT and UPDATE on all six tables, legacy and
hospital-scoped, and the rejection of mismatched links.

## Migration safety and locking

**How Prisma runs these files (measured on PostgreSQL 16).** Prisma 7's `migrate deploy` does
**not** wrap a migration file in a transaction: in a probe file without `BEGIN`, a failing second
statement left the first statement's table in place and the migration recorded as failed (P3018).
A file that contains its own `BEGIN; … COMMIT;` *is* atomic: the same probe wrapped that way left
nothing behind. `CREATE INDEX CONCURRENTLY` runs under Prisma 7 as a top-level statement, but never
inside a transaction block, `DO` block or function.

The four hospital migrations differ:

| Migration | Own `BEGIN/COMMIT` | On failure part-way |
|---|---|---|
| `20261122150000_hospital_core` | No | Partially applied; resolve by hand |
| `20261122160000_facility_foundation` | Yes | Rolled back; migration still recorded as failed |
| `20261122170000_phase21_data_model` | Yes (lines 4 and 555) | Rolled back; migration still recorded as failed |
| `20261123100000_fix_scoped_clinical_link_trigger` | No (one statement) | Atomic |

So the Phase 21 migration is all-or-nothing, which simplifies recovery, but **every lock it takes is
held until its final `COMMIT`**, and `CONCURRENTLY` is impossible inside it.

**What the Phase 21 migration does to existing tables.** It alters 24 existing tables (nullable
`ADD COLUMN`s, 21 foreign keys, 16 CHECK constraints, 46 index creations, 4 unique-index swaps and
new triggers), all with validation, no `NOT VALID` and no `CONCURRENTLY`:

| Operation | Lock taken | Cost on existing rows |
|---|---|---|
| `ADD COLUMN … uuid` (nullable, no default) | `ACCESS EXCLUSIVE`, brief | Catalog-only; no rewrite |
| `ADD CONSTRAINT … CHECK` (validated) | `ACCESS EXCLUSIVE` — blocks reads and writes | Full table scan |
| `ADD CONSTRAINT … FOREIGN KEY` (validated) | `SHARE ROW EXCLUSIVE` on both tables — blocks writes | Full scan of the referencing table |
| `CREATE INDEX` (not concurrent) | `SHARE` — blocks writes | Full table scan + sort |
| `DROP INDEX` / unique-index swap | `ACCESS EXCLUSIVE` | Brief |
| `CREATE TRIGGER` | `SHARE ROW EXCLUSIVE` | Brief |

Because the file is one transaction, those locks accumulate: by the end, all 24 existing tables are
held — most in `ACCESS EXCLUSIVE` (CHECKs, `ADD COLUMN`, index drops), which blocks reads as well as
writes — until `COMMIT`. The blocking window is the **whole migration's duration**, dominated by the
validation scans and index builds on the largest tables (the `DO $scope_constraints$` block alone does
this for 16 clinical tables). Lock acquisition order also matters: a long-running transaction on any
one of the 24 tables stalls the migration, and every query queued behind it. `audit_events` is partitioned; its new
FK and index touch every partition. Because every new column is NULL, the scans are cheap per row but
still proportional to table size.

**Production-safe strategy (recommended; not executed).**

1. **Rehearse on a restored, production-sized copy** and record each statement's duration and the
   locks waited on (`pg_stat_activity`, `pg_locks`). Size the window from that, not from CI.
2. **Run in a maintenance window with writers stopped**, or at minimum with `lock_timeout` set for the
   migration session (`PGOPTIONS='-c lock_timeout=5s -c statement_timeout=0'`) so DDL fails fast
   instead of queueing behind a long transaction and stalling every request behind it.
3. **Take a verified backup immediately before** (see `ROLLBACK_PROCEDURE.md` §9).
4. **If rehearsal shows the window is unacceptable**, the existing files must not be edited.
   Removing the file's `BEGIN/COMMIT` is not an option either: it is an edit to a possibly applied
   migration, and it would trade atomicity for a partially applied state on failure. The
   safe pattern for *future* additive migrations of this kind is: `ADD CONSTRAINT … NOT VALID` (new
   rows are checked immediately), then `VALIDATE CONSTRAINT` in a separate statement (only
   `SHARE UPDATE EXCLUSIVE`, writes continue), and `CREATE INDEX CONCURRENTLY` as top-level statements
   outside any `DO` block. Referential integrity is identical; only the validation of existing rows
   moves out of the blocking lock. Restructuring Phase 21 itself that way is possible only if every
   environment is verified never to have applied it — an owner decision.

## Local database setup

For disposable local work, copy `backend/.env.example` to `backend/.env`, use the repository's
PostgreSQL 16 Compose service, and set `APP_ENV=development`:

```bash
docker compose -f backend/docker-compose.yml up -d postgres redis
```

Check that `DATABASE_URL` points only to the local disposable database before running a migration or
seed. Do not use a database containing retained work as a disposable target.

## Development seed

The base seed (`npm run db:seed`) is unchanged in behaviour; `seed/demo.ts` now finds legacy allergy
rows explicitly, because Phase 21 split the allergy uniqueness into two partial indexes that Prisma's
`upsert` cannot target.

The multi-hospital fixtures use a separate runner, `npm run db:seed:multihospital`. It refuses to
connect unless `APP_ENV=development`, `MEDORA_DISPOSABLE_DB=true`, and `DATABASE_URL` targets loopback
PostgreSQL `medora_test` on port 5432; it never infers that another database is disposable
(`src/shared/database/multihospital-seed.guard.spec.ts`). It is idempotent: a second run creates no
rows (verified locally on PostgreSQL 16). It creates four fictional staff accounts without
credentials.

**It must not be run on the database the test suite uses.** Its fixtures (a nurse account, staff
affiliations, role assignments) break existing assertions in `authz-repositories.e2e-spec.ts` and
`administration-center.e2e-spec.ts` — verified: 12 failures after seeding. Those assertions are kept
strict; `main`'s CI does not run this seed. Recreate the database before running tests after using it.

```bash
cd backend
npm run db:deploy
npm run db:seed
APP_ENV=development MEDORA_DISPOSABLE_DB=true npm run db:seed:multihospital
```

## Open decisions (owner)

- **`audit_events.hospital_id` foreign key vs ADR-024 §3.** Phase 21 added
  `audit_events_hospital_id_fkey → hospitals`. ADR-024 §3 (accepted) says nothing references the
  ledger by foreign key "in either direction", and `test/schema-platform.e2e-spec.ts` asserts no
  foreign key on `audit_events`. That test is kept strict and fails until this is decided.
- **MRD-05 (a) vs staff affiliations.** MRD-05 (a) (approved) says one active employment for
  non-doctor staff; the schema allows active affiliations at several hospitals at once, and the
  Phase 21 tests assert that.
- **Consolidating the corrective migration** is possible only if every persistent environment is
  verified never to have applied `20261122170000`.

## Deferred implementation

- Backend tenant context, scoped queries, and hospital-level authorization (Phase 22 handoff).
- Verified legacy ownership mapping and any separately approved backfill.
- OQ-02 patient claiming and identity proofing.
- Cross-hospital access grants, consultations and provenance.
- Break-Glass, AI C2 retention and cross-hospital AI access.
- RLS enablement and tenant-context negative tests.
- Persistent environment verification and migration recovery for the hospital migrations.
