# Medora Database Architecture

## Status

The authoritative application schema is the split Prisma schema in `backend/prisma/schema/`; its additive migrations are in `backend/prisma/migrations/`. The Phase 21 implementation adds structural multi-hospital ownership and is under review in [PR #9](https://github.com/Fares-code0/medora-platform/pull/9). PostgreSQL 16 disposable CI results are the merge gate. The existing `hospital_core` and `facility_foundation` migration status in persistent environments remains **unknown** until an authorized operator verifies each environment.

The historical SQL package under `database/` is retained for reconciliation and reference. It is not a second migration stream for the running Prisma backend. Reconcile it before treating it as an operational source of truth.

## Entities and relationships

The full generated ERD, including every Prisma model, scalar column, and declared relation, is [DATABASE_ERD.md](DATABASE_ERD.md). Regenerate it after schema changes from `backend/` with `npm run db:erd`.

The primary ownership paths are:

- `Hospital` owns `HospitalLocation`, `Clinic`, `HospitalDepartment`, staff affiliation and employment scopes, published slots, and accepted insurance-plan metadata.
- `User` is a global account. `Doctor` is the professional profile. `DoctorEmployment` records hospital employment history; a partial unique index allows one active hospital employment per doctor. `HospitalStaffAffiliation` allows multiple hospital affiliations but grants no access. `HospitalRoleAssignment` is the explicit hospital-scoped role grant and stores its employment or affiliation source.
- `Patient` remains the single global identity. `HospitalMedicalRecord` gives each patient a separate clinical record at each hospital, protected by a unique `(patient_id, hospital_id)` key.
- Patient clinical details, encounters, appointments, lab orders, prescriptions, conversations and notifications retain their existing patient and row identifiers. New hospital and medical-record references are nullable to preserve legacy rows without verified ownership.
- `PublishedSlot` is owned by an active doctor employment. An appointment can book a slot only in the same hospital and for the matching doctor employment. A partial unique index limits active bookings to one per slot; cancelled, rescheduled, completed and no-show appointments release that active-booking key.
- `PatientInsurance` remains the patient's actual policy. `HospitalInsuranceCoverage` is separate metadata describing a provider and plan accepted by a hospital.
- `PatientEmergencyContact` and legacy `PatientChronicCondition` remain unchanged. `HospitalMedicalRecordCondition` is the new hospital-record-owned association for hospital-specific conditions.

## Isolation boundary

Hospital identifiers are structural ownership data, not an authorization decision. Composite foreign keys ensure that a hospital-scoped department, employment, record, appointment, lab order, prescription, or attachment cannot reference an object from a different hospital. Triggers preserve assigned ownership keys and validate selected employment, file and slot ownership rules.

Tenant context resolution, hospital-scoped repository predicates, authorization guards, administrator mapping, session/cache revocation, cross-hospital grants, Break-Glass, AI C2 retention/provenance, and PostgreSQL Row-Level Security are **not enabled by this schema**. Do not enable real multi-hospital access until those backend controls and cross-hospital negative tests are complete. OQ-02 patient-record claiming stays deferred.

## Migration procedure

1. Use only an isolated, disposable PostgreSQL 16 database. `SHADOW_DATABASE_URL` is additionally needed for `prisma migrate dev`, not for `db:check`. Never point either URL at development, staging, production, or a database with retained data.
2. Confirm `DATABASE_URL` names the disposable test database. CI uses the fresh `medora_test` database in its PostgreSQL 16 service.
3. Run `npm run db:deploy`, then `npm run db:check`, then `npm run db:status` from `backend/`. The check compares the resulting live database schema to the Prisma datamodel and fails on unexpected drift. It narrowly allowlists the exact Prisma 7.10.1 false-positive DROP/CREATE diff for three partial indexes; PostgreSQL integration tests verify those index predicates and constraints. The check is read-only.
4. Run the database integration tests with the test guard enabled. Tests fail closed unless the database name is `medora_test` and the server is PostgreSQL 16.
5. Compare schema, migration SQL, and migration status in the same disposable environment; a fresh-history run does not establish the status of an already-deployed environment.

The Phase 21 migration is forward-only and additive. It adds nullable ownership columns and new constraints/relations without assigning legacy rows. Existing migration files, IDs, public IDs, sequences, soft-deleted data, and clinical history are preserved. Never resolve or edit an existing migration as a substitute for environment verification. The persistent application status of the earlier hospital migrations remains unknown and blocks production rollout.

## Local database setup

For disposable local work, copy `backend/.env.example` to `backend/.env`, use the repository's PostgreSQL 16 Compose service, and set `APP_ENV=development`. Start the services with:

```bash
docker compose -f backend/docker-compose.yml up -d postgres redis
```

Check that the compose service is healthy and that `DATABASE_URL` points only to the local disposable database before running a migration or seed. Do not use a database containing retained work as a disposable target.

## Development seed

The existing reference and demo seed remains layered. The Phase 21 fictional multi-hospital fixtures use a separate runner. It refuses to connect unless `APP_ENV=development`, `MEDORA_DISPOSABLE_DB=true`, and `DATABASE_URL` targets loopback PostgreSQL database `medora_test` on port 5432. CI runs it twice against its disposable PostgreSQL 16 service to exercise repeatability. It uses the canonical fictional demo patients, gives each hospital its own `HospitalMedicalRecord`, and creates sample departments, employment/affiliation provenance, hospital-scoped roles, appointments and clinical rows. Upserts and existence checks avoid duplicate creation on rerun and do not reactivate revoked role assignments or ended affiliations. It does not modify legacy ownership anchors.

From a disposable local development database only:

```bash
cd backend
npm run db:deploy
npm run db:seed
APP_ENV=development MEDORA_DISPOSABLE_DB=true npm run db:seed:multihospital
```

The guarded seed was not run locally because no disposable PostgreSQL 16 database was available. CI runs it twice against its disposable PostgreSQL 16 service. It creates the four fictional staff accounts and profiles needed by the hospital affiliations without creating passwords or credentials; the ordinary seed keeps credential provisioning disabled unless `APP_ENV` is explicitly `development`. The runner validates the loopback host and database name before connecting; it never infers that another database is disposable. Never run it against production or a persistent/shared database.

## Deferred implementation

- Backend tenant context, scoped queries, and hospital-level authorization.
- Verified legacy ownership mapping and any separately approved backfill.
- OQ-02 patient claiming and identity proofing.
- Cross-hospital access grants, consultations and provenance.
- Break-Glass, AI C2 retention and cross-hospital AI access.
- RLS enablement and tenant-context negative tests.
- Persistent environment verification and migration recovery for earlier hospital migrations.
