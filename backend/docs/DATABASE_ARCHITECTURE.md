# Medora Database Architecture

## Status

The authoritative database is `backend/prisma/` and nothing else: the split Prisma schema in
`prisma/schema/`, the migrations in `prisma/migrations/`, and the seeds in `prisma/seed*`. This
repository has no standalone `database/` SQL or DBML package (see the root `CLAUDE.md`).

The multi-hospital foundation (`20261122150000_hospital_core`, `20261122160000_facility_foundation`)
and the Phase 21 data model (`20261122170000_phase21_data_model` plus its corrective migration
`20261123100000_fix_scoped_clinical_link_trigger`), and the two owner-approved corrections
`20261123120000_drop_audit_events_hospital_fkey` and `20261123120100_one_active_staff_affiliation`
(2026-11-23), are proposed against `main` from the
database-only branch `fix/phase21-database-main-integration`. They were first written on the
`Database` integration branch (PR #5, PR #6) and PR #9; PR #9's Phase 22 application code is **not**
part of this change (see [`docs/multi-hospital/PHASE22_BACKEND_HANDOFF.md`](../../docs/multi-hospital/PHASE22_BACKEND_HANDOFF.md)).

**Persistent-environment status of the four hospital migrations is unknown.** No evidence in the repository
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
  doctor. `HospitalStaffAffiliation` allows **one active affiliation per staff member** across all
  hospitals (MRD-05 (a), owner-approved 2026-11-23; `hospital_staff_affiliations_one_active_per_staff_key`
  from `20261123120100_one_active_staff_affiliation`), keeps ended affiliations as history, and grants
  no access by itself. The older per-hospital key is kept. `HospitalRoleAssignment` is the
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

## Doctor, employment and hospital status (Phase 22 audit F4)

The schema already distinguishes every state the hospital context needs; no schema change is required:

| State | Column | Index |
|---|---|---|
| Doctor practice | `doctors.practice_status` (`doctor_practice_status`: active, suspended, vacation) | `doctors_practice_status_idx` |
| Doctor verification | `doctors.verification_status` | `doctors_verification_status_idx` |
| Doctor profile deleted | `doctors.deleted_at` (soft delete) | `doctors_deleted_at_idx` |
| Employment | `doctor_employments.started_at` / `ended_at`; one active per doctor | `doctor_employments_one_active_per_doctor_key (doctor_id) WHERE ended_at IS NULL` |
| Hospital | `hospitals.status` (CHECK: ACTIVE, SUSPENDED, INACTIVE), `hospitals.deleted_at` | `hospitals_status_idx`, `hospitals_deleted_at_idx` |

Ended employments are kept as history; nothing deletes them. The gap found by the audit is in what the
Backend's context query reads (it ignores `practice_status` and `deleted_at` on `doctors`). The
effective-employment rule is written once, as `app_rls.effective_doctor_hospital()` in the RLS
proposal (`prisma/rls-proposal/`), and proven in `test/rls-proposal.e2e-spec.ts` (tests 4–6). Whether
VACATION or an unverified doctor should yield clinical context is an open owner question
(`docs/multi-hospital/RLS_DESIGN.md` §6, B7).

## Shadow query resource safety (condition C1, database side)

**Verified:** nothing bounds a query on the application connection today — no `statement_timeout`,
`lock_timeout` or `idle_in_transaction_session_timeout` in the server defaults, the Compose service, any
role or database setting, any migration, or the `PrismaPg` options (`src/shared/database/prisma.service.ts`).
`test/database-statement-timeout.e2e-spec.ts` asserts the connection starts with `statement_timeout = 0`.

**Recommendation: a transaction-local timeout on the shadow queries only.**

| Option | Verdict |
|---|---|
| `SET LOCAL statement_timeout` (or `set_config('statement_timeout', …, true)`) inside a transaction that wraps the two shadow queries | **Recommended.** Cancels a slow statement and a lock wait with `57014`, and ends with the transaction, so the pooled connection carries nothing into the next request (all three proven in the test). Scope is exactly the shadow. |
| Role- or database-wide `ALTER ROLE/DATABASE … SET statement_timeout` | **Not recommended now.** The application, migrations and seeds share one role; a global limit would also cut migrations (the Phase 21 migration holds locks for its whole transaction), long exports and reports, and the re-encryption CLI's own bounded connection relies on its own settings. |
| Session-level `SET statement_timeout` from the application | **Unsafe** with a pool: it survives into the next request on that connection (proven). |
| Dedicated database role with a role-level timeout for shadow work | Possible later; needs a second connection pool (Backend-owned). |

Suggested value: a few hundred milliseconds (the two queries are single-row index lookups); the exact
value is the Backend's choice. A timeout alone does not bound *how many* comparisons queue for a pool
connection: the Backend also needs an in-flight cap that skips comparisons when it is reached. Both are
Backend work (issue linked from the Phase 22 plan); the shadow stays off until then.

Hygiene for operations (not applied here; environment configuration is outside the repository):
`idle_in_transaction_session_timeout` at the server or role level protects against a leaked open
transaction pinning a connection, and is safe for this application because no code path holds a
transaction idle on purpose.

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

## Owner decisions applied (2026-11-23)

- **Decision 1 — audit ledger foreign key (option A).** `20261123120000_drop_audit_events_hospital_fkey`
  drops only `audit_events_hospital_id_fkey`, restoring ADR-024 §3: nothing references the ledger by
  foreign key. `audit_events.hospital_id`, `audit_events_hospital_occurred_idx` and the immutability
  trigger stay; no row is read or changed. `test/schema-platform.e2e-spec.ts` passes unchanged.
  `domain_events_hospital_id_fkey` is outside ADR-024 and is unchanged.
- **Decision 2 — MRD-05 (a) (option A).** `20261123120100_one_active_staff_affiliation` first counts
  staff with more than one active affiliation and, if any exist, stops with an `MRD-05 (a)` error and a
  query hint, creating nothing; it never ends or changes an affiliation. Otherwise it creates
  `hospital_staff_affiliations_one_active_per_staff_key (staff_id) WHERE ended_at IS NULL`. Verified on
  a disposable database seeded with the old fixtures: the migration failed with the message and no
  affiliation, role assignment or index changed. Before deploying to any environment, run the hint's
  query read-only; any rows are an owner decision. The development seed now gives each staff fixture
  one hospital.

## Open decisions (owner)

- **Seed in CI.** Whether CI should run the multi-hospital seed on a separate disposable database
  (needs a CI change and a seed-guard change).
- **Consolidating the corrective migration** is possible only if every persistent environment is
  verified never to have applied `20261122170000`.

## Intentionally excluded from this change

Carried from neither `Database` (PR #5, PR #6) nor PR #9, on purpose. Nothing here is enabled or
disabled by this change; `.github/workflows/ci.yml` and `CLAUDE.md` are exactly `main`'s.

| Excluded item | Source | Reason | Status |
|---|---|---|---|
| CI health check `pg_isready -U medora -d medora_test` (instead of `-U medora`) | `Database` `05f3b64` (PR #5) | CI changes need owner approval; `main`'s health check gates the service | Not applied; available for a separate CI change |
| CI step "Focused ADR-010 scope test" (`npm run test -- test/schema-adr010.e2e-spec.ts` before the full suite) | `Database` `e52219b` (PR #5) | Same; the spec still runs in the full suite on every backend CI run | Not applied |
| CI step "Seed multi-hospital fixtures twice" | PR #9 | Seeding the test database breaks existing assertions (see *Development seed*); running it on a separate database needs a CI and seed-guard change | Owner decision 3 (open) |
| CI step "Show migration drift SQL" and moving `db:check` after `db:deploy`; removal of the shadow-database step | PR #9 | `main`'s shadow-database drift check passes with no difference, so it is kept unchanged | Not applied |
| `backend/prisma/check-drift.ts` and the `db:check` script change | PR #9 | Its allowlist is unnecessary once partial-index predicates are declared in normalized form | Not carried |
| `CLAUDE.md` ADR-numbering paragraph rewrite | `Database` (PR #5/#6) | `CLAUDE.md` is outside database scope and its rules forbid rewriting existing text; `docs/DECISIONS.md` carries the current numbering | Not carried; `main`'s paragraph (which names ADR-044 as highest) is stale |
| `patient-app/PATIENT_FRONTEND_CHECKLIST.md` note that ADR-042 is Accepted | `Database` (PR #5/#6) | Outside the database tree (and would trigger the patient-app suite) | Not carried; `main`'s copy still says ADR-042 is Proposed |
| Phase 22 application code, its specs and its documentation updates | PR #9, PR #12 | Backend work | Listed in `docs/multi-hospital/PHASE22_BACKEND_HANDOFF.md` |

## Deferred implementation

- Backend tenant context, scoped queries, and hospital-level authorization (Phase 22 handoff).
- Verified legacy ownership mapping and any separately approved backfill.
- OQ-02 patient claiming and identity proofing.
- Cross-hospital access grants, consultations and provenance.
- Break-Glass, AI C2 retention and cross-hospital AI access.
- RLS enablement and tenant-context negative tests.
- Persistent environment verification and migration recovery for the hospital migrations.
