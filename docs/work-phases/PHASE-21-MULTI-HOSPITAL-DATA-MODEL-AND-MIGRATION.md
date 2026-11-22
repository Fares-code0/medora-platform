# Phase 21 — Multi-Hospital Data Model & Migration

**Origin:** audit-derived; reconciled with the FINAL owner decisions on 2026-10-07
**Primary Area:** Database (+ Backend)
**Status:** IN PROGRESS — additive model, migration and isolated development seed committed on codex/phase21-data-model; draft PR #9 targets Database; fresh PostgreSQL 16 CI validation pending
**Valid after the final decisions:** yes
**Depends On:** PR #5 foundation merged into Database; persistent migration status remains unknown and blocks deployment
**Enables:** 22, 22A, 23, 24, 26

**Implementation update (2026-11-22):** The current branch adds hospital departments, one-active-employment-per-doctor, multi-hospital staff affiliations, hospital role assignments, HospitalMedicalRecord, hospital-owned chronic-condition links, published slots, hospital insurance coverage and nullable hospital ownership for clinical rows/files. Legacy clinical identifiers and soft-deleted rows remain in place; no ownership backfill, default hospital assignment, patient claim, or existing migration edit is part of this phase. Details and validation evidence are appended under “Current implementation”.

**Related documentation:** `docs/multi-hospital/DATA_MODEL_CHANGES.md`, `DATABASE_CHECKLIST.md`,
`MIGRATION_AND_COMPATIBILITY.md`
Patient AI assistant prerequisites (added 2026-10-10): `DATABASE_CHECKLIST.md` §I (I1–I7).

> **Correction history.**
> - *First version:* modelled `Organization`, `OrganizationMembership` (several per doctor) and
>   `PatientEnrollment`. Superseded by Hospital (DR-01), one active employment (DR-02) and per-hospital
>   Medical Records (DR-03).
> - *Second version:* left Locations, admin scope, record creation and grant fields "OD-required".
>   Superseded by the final decisions: Clinic is a separate entity, multiple Locations (OD-06);
>   Platform/Hospital Admin (OD-07); first-interaction record creation and global identity (OD-09);
>   purpose-bound, category-limited grants with an explicit end (OD-01, OD-03); consultations (OD-13);
>   insurance coverage (OD-14).

---

## Objective

Complete the additive multi-hospital database model on top of the merged Hospital foundation while preserving all legacy records. New ownership keys remain nullable until verified ownership mappings exist. Do not assign a default hospital or infer legacy ownership.

## Why it exists

AF-01…AF-12, AF-35, AF-38, AF-39, AF-40.

## Owner decisions it implements

DR-01…DR-04, DR-06, DR-07, DR-10, DR-11, DR-12 (AI storage), OD-01, OD-03, OD-04, OD-06, OD-07, OD-08,
OD-09, OD-12, OD-13, OD-14, OQ-01, all FINAL. OQ-02 (open, deferred) affects record-claim tooling only.

## Deliverables

**Stage 1 — model** (implementation complete; CI validation pending)
- [x] [DATABASE] Hospital, HospitalLocation and Clinic foundation from merged PR #5; new per-clinic operating hours leave the legacy global weekday schedule unchanged.
- [x] [DATABASE] HospitalDepartment linked to the global Department catalogue; same-hospital local department references cover employment, staff affiliations, encounters, appointments, labs, prescriptions, rooms and resources. Legacy department IDs remain intact.
- [x] [DATABASE] DoctorEmployment history with one active employment per doctor globally; HospitalStaffAffiliation supports multiple hospitals and alone grants no access.
- [x] [DATABASE] HospitalRoleAssignment stores hospital role provenance; termination revokes only assignments sourced from the ended affiliation/employment. Runtime authorization remains deferred.
- [x] [DATABASE] Global Patient plus one HospitalMedicalRecord per patient/hospital; nullable HMR ownership for eight patient clinical tables and related encounters, appointments, labs, prescriptions, conversations, notifications and AI conversations. No legacy ownership backfill.
- [x] [DATABASE] HospitalMedicalRecordCondition association; existing PatientChronicCondition composite key and PatientEmergencyContact remain unchanged.
- [x] [DATABASE] PublishedSlot and partial active-booking uniqueness; cancellation, rescheduling, completion and no-show release slot capacity.
- [x] [DATABASE] PatientInsurance remains the patient-owned actual policy; HospitalInsuranceCoverage lists plans accepted by each hospital.
- [x] [DATABASE] Nullable File hospital ownership and same-hospital attachment checks; existing files remain unassigned.
- [ ] [TESTING] PostgreSQL 16 fresh migration, drift and integration results are pending disposable CI. Local Prisma validation, client generation, typecheck and lint pass.
- [ ] [BACKEND] Tenant context, scoped queries/authorization and deliberate admin mapping remain backend integration work. This schema does not enable access.
- [ ] [DATABASE] Historical schema.sql reconciliation remains a separate source-of-truth cleanup task.
- [ ] [DEFERRED] Cross-hospital grants/consultations, Break-Glass, provenance, AI C2 retention, patient claiming and RLS await their specifications, approvals and security tests.

**Stage 2 — migration** (DATABASE_CHECKLIST.md G)
- [x] [DATABASE] New forward-only migration 20261122170000_phase21_data_model; previous migrations untouched. Nullable scope columns preserve unknown legacy ownership, identifiers, soft-deleted rows and history.
- [x] [DATABASE] Composite tenant/patient FKs, active partial uniques, indexes, checks and triggers for source provenance, termination revocation, file ownership and slot booking.
- [ ] [BLOCKED] Ownership backfill/default hospital assignment requires verified row-level mappings and separate approval; none is inferred.
- [ ] [DATABASE] Deliberate existing-admin mapping via reviewed list; no automatic conversion (OD-07).
- [ ] [DATABASE] Expand-only migrations; destructive contract/down migrations are outside Phase 21.
- [x] [DATABASE] Fictional, repeatable development-only hospital, location, clinic, department, staff, role, patient-record, appointment and clinical sample seed; explicitly gated on `APP_ENV=development`.

ClinicWorkingDay remains the historical platform-wide weekday schedule. ClinicOperatingHour gives each Clinic its own weekday rows without changing the old primary key. Room.name retains unique names for legacy unassigned rooms while permitting same names in different hospitals.

PatientInsurance stores actual policies under global Patient identity. HospitalInsuranceCoverage is hospital-owned accepted-plan metadata. No existing insurance data is copied or rewritten.

HospitalDepartment.catalogueDepartmentId is optional shared catalogue metadata. The hospitalDepartmentId added to scoped rows names the local department; existing Department foreign keys and IDs remain unchanged.

HospitalRoleAssignment is structural data, not an authorization engine. Employment/affiliation provenance supports targeted revocation but does not implement runtime session/cache revocation.

## Blocking conditions

Fresh PostgreSQL 16 CI validation of this migration. Verified status of the earlier hospital_core migration in every persistent environment remains a deployment prerequisite.

## Security requirements

- Structural hospital ownership; one active employment in the database; no open-ended grants or
  Break-Glass sessions.
- Gate **G-1**.

## Downstream phases

22, 22A, 23, 24, 26

## Current implementation

- Added HospitalDepartment, DoctorEmployment, HospitalStaffAffiliation, HospitalRoleAssignment, HospitalMedicalRecord, HospitalMedicalRecordCondition, PublishedSlot, HospitalInsuranceCoverage and ClinicOperatingHour. Existing Hospital, HospitalLocation and Clinic are the PR #5 foundation.
- Added same-hospital department links for scoped appointments, encounters, lab orders, prescriptions, rooms and resources while preserving legacy Department IDs and relationships.
- Existing patient/clinical identifiers and patient FKs are preserved. Eight patient clinical tables and related encounter, appointment, lab, prescription, messaging, notification and AI conversation tables gain nullable hospital/HMR anchors with composite patient/hospital FKs. PatientEmergencyContact and PatientChronicCondition are unchanged; the new HMR condition association is additive.
- File hospital ownership remains nullable. New scoped patient documents and attachments require same-hospital files; legacy files remain unassigned.
- Published-slot capacity is protected by a partial unique index; cancelled, rescheduled, completed and no-show appointments release capacity.
- The new transaction-wrapped migration follows 20261122160000_facility_foundation. No prior migration was edited/replayed/resolved, and there is no backfill or default hospital assignment.
- Local validation: Prisma schema validation, Prisma Client generation, TypeScript typecheck, ESLint and git diff --check pass. Source-only Vitest run: 94 test files passed; five Redis-dependent files failed (6 tests) or skipped (17 tests) because no local Redis service is available. PostgreSQL migration/drift/integration tests await disposable CI. No database was accessed.
- Development seed was implemented but not executed; no disposable PostgreSQL 16 environment was available locally. Repeated-seed behavior is protected through natural-key upserts and stable slot IDs; verify actual row counts and constraints in disposable CI before treating it as validated.
- Persistent application status for 20261122150000_hospital_core and 20261122160000_facility_foundation remains unknown; see docs/multi-hospital/MIGRATION_AND_COMPATIBILITY.md. Fresh-history CI cannot establish persistent-environment state.
- OQ-02 identity proofing, cross-hospital grants, Break-Glass, AI C2 retention, provenance and RLS remain deferred. This phase does not yet enable multi-hospital backend access.

## Source / evidence

`docs/multi-hospital/AUDIT_FINDINGS.md`; `backend/prisma/schema/*.prisma`.

Ownership immutability: new tenant/HMR keys may be assigned to currently unowned legacy rows after verified mapping, but cannot be changed in place after assignment.
